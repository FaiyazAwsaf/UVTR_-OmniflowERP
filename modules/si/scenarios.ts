import { invoiceAvailable } from "@/core/ar/receipt"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { Id, PartyRow, SalesOrderRow, VehicleRow } from "@/core/db/schema"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { LOC, PLANT, PTY, SVC, USR } from "@/core/seed/content/seed-refs"
import { readCatalogue } from "@/modules/pc/catalogue"
import { priceRequests, serviceDuration, type Catalogue, type LineRequest } from "@/modules/pc/pricing"
import { updateOrder } from "@/modules/stl/commands"
import { deliverOrder, ensureStock, findPastSlot } from "@/modules/stl/scenario-support"
import { recipeNeeds } from "@/modules/stl/stock-check"

import { readPartyAdvance, readPartyExposure } from "./balances"
import { checkout, issueInvoice } from "./commands"

/**
 * SI scenario launchers (implementation_plan.md §10).
 *
 * E2 Fleet over credit limit: Swift Ride Rentals (limit ৳3,50,000; ৳3,12,000
 * open in the seed) gets 18 fresh fleet jobs at Gulshan, booked, worked, QC'd
 * and handed over through the real commands, so the consolidated invoice
 * Shahriar is about to issue takes it over the limit (INV-10). When earlier
 * receipts brought the account down so far that it would stay within the
 * limit, the setup first bills extra fleet work today until it would not.
 *
 * E12 Credit note: a fresh paid counter invoice at Gulshan (premium wash and
 * interior deep cleaning on an SUV) with the customer's complaint on its
 * order; Tania (credit note limit 0) issues a partial Mushak 6.7 credit note
 * for the interior line, Shahriar approves inline, and since the invoice is
 * paid the credit is kept as the customer's advance.
 */

/* ================================================================== *
 * Shared
 * ================================================================== */

const key = (kit: ScenarioKit, label: string) => `${kit.runId}:${label}`

/** Fleet jobs for one service each, on rotating vehicles. */
type Job = { vehicle: VehicleRow; serviceId: Id }

const jobRequests = (job: Job): LineRequest[] => [{ kind: "service", serviceId: job.serviceId }]

/** Recipe needs of jobs (one service line each). */
const jobNeeds = (catalogue: Catalogue, jobs: Job[]) =>
  recipeNeeds(
    catalogue,
    jobs.map((j) => ({ kind: "service" as const, refId: j.serviceId, vehicleClass: j.vehicle.vehicleClass, qty: 1 }))
  )

/** Book, work, QC and hand over jobs at Gulshan through the commands; returns the order ids. */
async function deliverJobs(kit: ScenarioKit, party: PartyRow, jobs: Job[], label: string): Promise<Id[]> {
  const catalogue = await readCatalogue(kit.db)
  await ensureStock(kit, LOC.GUL, jobNeeds(catalogue, jobs))
  const minutes = Math.max(...jobs.map((j) => serviceDuration(catalogue, j.serviceId, j.vehicle.vehicleClass)))
  // Each job is done before the next is scheduled, so one free slot serves them all.
  const slot = await findPastSlot(kit.db, { locationId: LOC.GUL, minutes, today: kit.today(), kinds: ["wash", "detailing", "coating"] })
  const ids: Id[] = []
  for (const [i, job] of jobs.entries()) {
    const { orderId } = await deliverOrder(kit, {
      locationId: LOC.GUL,
      partyId: party.id,
      vehicleId: job.vehicle.id,
      requests: jobRequests(job),
      slot,
      advisor: "nayeem",
      manager: "shahriar",
      key: `${label}:${i}`,
    })
    ids.push(orderId)
  }
  return ids
}

/* ================================================================== *
 * E2 Fleet over credit limit
 * ================================================================== */

/** Fresh delivered, unbilled fleet jobs each run (plan §10) */
export const E2_FRESH_ORDERS = 18
/** What Mahbub records from Swift Ride in the cue's last step (bank transfer) */
export const E2_RECEIPT_P = 1_00_000_00
/** The consolidated tab's default period (si/components/invoice-new.tsx) */
const E2_PERIOD_DAYS = 30

/** Swift Ride's delivered, unbilled orders at Gulshan in the consolidated tab's period. */
async function swiftPending(kit: ScenarioKit): Promise<SalesOrderRow[]> {
  const from = addDaysISO(kit.today(), -E2_PERIOD_DAYS)
  const to = kit.today()
  return (await kit.db.salesOrders.where("partyId").equals(PTY.swiftRide).toArray()).filter((o) => {
    if (o.locationId !== LOC.GUL || o.status !== "delivered" || !o.deliveredAt) return false
    const day = dhakaDate(o.deliveredAt)
    return day >= from && day <= to
  })
}

const e2: ScenarioDef = {
  id: "E2",
  kind: "scenario",
  module: "si",
  titleKey: "si.scenarios.e2.title",
  summaryKey: "si.scenarios.e2.summary",
  user: "shahriar",
  async setup(kit) {
    const db = kit.db
    const party = await db.parties.get(PTY.swiftRide)
    if (!party) throw new Error("E2: Swift Ride Rentals is missing")
    const fleet = (await db.vehicles.where("partyId").equals(party.id).toArray()).filter((v) => v.active).sort((a, b) => a.regNo.localeCompare(b.regNo))
    if (!fleet.length) throw new Error("E2: Swift Ride has no vehicles")

    // 18 fresh jobs: premium washes, every third an interior deep clean.
    const fresh: Job[] = Array.from({ length: E2_FRESH_ORDERS }, (_, i) => ({
      vehicle: fleet[i % fleet.length],
      serviceId: i % 3 === 2 ? SVC.INT_DEEP : SVC.WSH_PRM,
    }))
    await deliverJobs(kit, party, fresh, "e2")

    // Still within the limit with them (receipts paid it down)? Bill extra
    // fleet work today, so the consolidated invoice goes over (re-run rule).
    const limitP = party.creditLimitP
    const pendingTotal = async () => (await swiftPending(kit)).reduce((s, o) => s + o.totalP, 0)
    const thisInvoice = async () => {
      const total = await pendingTotal()
      return total - Math.min(total, Math.max(0, await readPartyAdvance(db, party.id)))
    }
    let extraInvoiceId: Id | undefined
    const gap = limitP - (await readPartyExposure(db, party.id)) - (await thisInvoice())
    if (gap >= 0) {
      const catalogue = await readCatalogue(db)
      const value = (v: VehicleRow) => priceRequests(catalogue, { priceListId: party.priceListId, date: kit.today(), vehicleClass: v.vehicleClass, requests: [{ kind: "service", serviceId: SVC.PRT_CC5 }], discountPct: 0 }).totalP
      // Ceramic coating on the biggest vans, until the bill covers the gap.
      const vans = [...fleet].sort((a, b) => value(b) - value(a) || a.regNo.localeCompare(b.regNo))
      const extra: Job[] = []
      for (let sum = 0; sum <= gap; sum += value(extra[extra.length - 1].vehicle)) {
        extra.push({ vehicle: vans[extra.length % vans.length], serviceId: SVC.PRT_CC5 })
      }
      const orderIds = await deliverJobs(kit, party, extra, "e2x")
      // The pending fresh orders stay out of this invoice: bill only the extra work.
      const extraTotal = (await db.salesOrders.bulkGet(orderIds)).reduce((s, o) => s + (o?.totalP ?? 0), 0)
      const status = (await db.parties.get(party.id))?.status ?? party.status
      const needsOverride = status !== "active" || (await readPartyExposure(db, party.id)) + extraTotal > limitP
      const out = await kit.run(
        issueInvoice,
        {
          orderIds,
          inline: needsOverride ? { approverId: USR.farzana, pin: "1234", reason: "Fleet coating work billed as agreed" } : undefined,
          idempotencyKey: key(kit, "e2x:invoice"),
        },
        "shahriar"
      )
      extraInvoiceId = out.invoiceId
    }

    const pending = await swiftPending(kit)
    const invoiceP = pending.reduce((s, o) => s + o.totalP, 0)
    const outstandingP = await readPartyExposure(db, party.id)
    const thisP = await thisInvoice()
    return {
      refs: { partyId: party.id, locationId: LOC.GUL, invoiceId: extraInvoiceId },
      params: {
        count: pending.length,
        fresh: E2_FRESH_ORDERS,
        limitP,
        outstandingP,
        invoiceP,
        afterP: outstandingP + thisP,
        overP: outstandingP + thisP - limitP,
        receiptP: E2_RECEIPT_P,
      },
    }
  },
  route: () => `/si/new?mode=consolidated&party=${PTY.swiftRide}`,
  cueKeys: ["si.scenarios.e2.cue1", "si.scenarios.e2.cue2", "si.scenarios.e2.cue3", "si.scenarios.e2.cue4", "si.scenarios.e2.cue5"],
  companion: { user: "mahbub", route: () => `/ar/receipts/new?party=${PTY.swiftRide}` },
}

/* ================================================================== *
 * E12 Credit note
 * ================================================================== */

/** What the customer said after the interior clean (kept on the order, never in an SMS). */
export const E12_COMPLAINT = "Customer called back: a damp smell in the rear carpet after the interior clean."

/**
 * The E12 customer: the seeded E12 invoice's customer and SUV, or (when an
 * earlier run left that customer with an advance, which the next invoice
 * would absorb) the first retail customer with an SUV and no advance.
 */
async function e12Customer(kit: ScenarioKit): Promise<{ party: PartyRow; vehicle: VehicleRow }> {
  const db = kit.db
  const ok = async (partyId: Id, vehicleId?: Id) => {
    const party = await db.parties.get(partyId)
    if (!party || party.status !== "active" || party.segment !== "retail" || party.id === PTY.shahedKabir) return undefined
    if ((await readPartyAdvance(db, party.id)) > 0) return undefined
    const vehicles = (await db.vehicles.where("partyId").equals(party.id).toArray()).filter((v) => v.active && v.vehicleClass === "SUV")
    const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles.sort((a, b) => a.regNo.localeCompare(b.regNo))[0]
    return vehicle ? { party, vehicle } : undefined
  }
  const planted = await db.salesOrders.get(PLANT.e12Order)
  const first = planted ? await ok(planted.partyId, planted.vehicleId) : undefined
  if (first) return first
  const suvs = await db.vehicles.where("vehicleClass").equals("SUV").toArray()
  const parties = (await db.parties.bulkGet([...new Set(suvs.map((v) => v.partyId))]))
    .filter((p): p is PartyRow => !!p && p.segment === "retail")
    .sort((a, b) => a.code.localeCompare(b.code))
  for (const p of parties) {
    const found = await ok(p.id)
    if (found) return found
  }
  throw new Error("E12: no retail customer with an SUV and no advance")
}

const e12: ScenarioDef = {
  id: "E12",
  kind: "scenario",
  module: "si",
  titleKey: "si.scenarios.e12.title",
  summaryKey: "si.scenarios.e12.summary",
  user: "tania",
  async setup(kit) {
    const db = kit.db
    const { party, vehicle } = await e12Customer(kit)
    const services = [SVC.WSH_PRM, SVC.INT_DEEP]
    const requests: LineRequest[] = services.map((serviceId) => ({ kind: "service", serviceId }))
    const catalogue = await readCatalogue(db)
    await ensureStock(kit, LOC.GUL, recipeNeeds(catalogue, services.map((refId) => ({ kind: "service", refId, vehicleClass: vehicle.vehicleClass, qty: 1 }))))
    const minutes = services.reduce((s, id) => s + serviceDuration(catalogue, id, vehicle.vehicleClass), 0)
    const slot = await findPastSlot(db, { locationId: LOC.GUL, minutes, today: kit.today(), kinds: ["detailing", "wash"] })
    const { orderId, orderNo } = await deliverOrder(kit, {
      locationId: LOC.GUL,
      partyId: party.id,
      vehicleId: vehicle.id,
      requests,
      slot,
      advisor: "nayeem",
      manager: "shahriar",
      key: "e12",
    })
    // Tania invoices and takes the card; the customer calls back later.
    const { invoiceId, invoiceNo } = await kit.run(issueInvoice, { orderIds: [orderId], idempotencyKey: key(kit, "e12:invoice") }, "tania")
    const issued = await db.salesInvoices.get(invoiceId)
    const due = issued ? invoiceAvailable(issued) : 0
    if (due > 0) {
      await kit.run(
        checkout,
        { invoiceId, tenders: [{ method: "card", amountP: due, ref: "E12CARD" }], idempotencyKey: key(kit, "e12:pay") },
        "tania"
      )
    }
    await kit.run(updateOrder, { orderId, complaintNote: E12_COMPLAINT }, "nayeem")

    const invoice = await db.salesInvoices.get(invoiceId)
    const lines = await db.salesInvoiceLines.where("invoiceId").equals(invoiceId).toArray()
    const interior = lines.find((l) => l.serviceId === SVC.INT_DEEP)
    if (!invoice || !interior) throw new Error("E12: the invoice or its interior line is missing")
    return {
      refs: { invoiceId, orderId, partyId: party.id, vehicleId: vehicle.id },
      params: {
        invoiceNo,
        orderNo,
        regNo: vehicle.regNo,
        nameEn: party.nameEn,
        nameBn: party.nameBn,
        totalP: invoice.totalP,
        creditP: interior.netP + interior.vatP,
        vatP: interior.vatP,
      },
    }
  },
  route: (outcome) => `/si/${outcome.refs?.invoiceId ?? ""}`,
  cueKeys: ["si.scenarios.e12.cue1", "si.scenarios.e12.cue2", "si.scenarios.e12.cue3", "si.scenarios.e12.cue4", "si.scenarios.e12.cue5"],
}

export const siScenarios: ScenarioDef[] = [e2, e12]
