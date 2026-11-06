import type { ISODate, Id, Ms, SalesOrderRow, SalesOrderLineRow, VehicleClass } from "@/core/db/schema"
import { linesForRetailGoodsOut } from "@/core/ledger/rules"
import { percentOf } from "@/core/tax/vat"

import { ITEM_BY_ID, RETAIL_WEIGHTS, SERVICE_BY_ID } from "../content/catalogue"
import { CREDIT_BY_ID } from "../content/parties"
import { PL, PLANT, PTY, SVC, VEH } from "../content/seed-refs"
import type { EventQueue } from "../engine/events"
import type { World } from "../engine/world"
import { dhakaAt, dhakaDate, isoAddDays, isoWeekday, MINUTE } from "../time"
import type { CreditJob, CreditPlan } from "./credit-plan"
import { drawRetailPick, priceJob, type JobLine } from "./jobs"
import type { PartiesOut, PoolCustomer } from "./parties"
import {
  ADVISOR,
  CASHIER,
  invoiceLinesOf,
  MANAGER,
  payAtCounter,
  STUDIO_LOC,
  writeCounterReceipt,
  writeInvoice,
  writeOrder,
  type InvoiceLineInput,
} from "./sales-docs"
import { bayKindFor, StudioScheduler, type Placement, type Studio } from "./scheduler"
import { STUDIO_BASE, WEEKDAY_FACTOR, growthFactor } from "./volumes"

/**
 * The fully itemised window from the cutover C to yesterday (seed_data.md
 * §7.4): retail orders with the summary's volumes and mix, credit
 * customers' orders, and the planted past orders (Shahed Kabir, E12), all
 * scheduled within bay and technician capacity; QC, handover with a gate
 * pass, invoice and receipts on the day; 6% through a quotation, 4% with a
 * deposit days earlier; counter sales of retail goods to the walk-in party.
 */

type Spec = {
  id: Id
  studio: Studio
  day: ISODate
  desired: Ms
  partyId: Id
  vehicleId: Id
  cls: VehicleClass
  lines: JobLine[]
  priceListId: Id
  discountPct: number
  kind: "retail" | "credit" | "planted"
  credit?: CreditJob
  complaintNote?: string
  quoteDaysBefore?: number
  deposit?: { daysBefore: number; method: "cash" | "card" | "bkash" }
}

export type CreditOrder = { order: SalesOrderRow; lines: SalesOrderLineRow[]; job: CreditJob }

export type ItemisedOut = {
  /** Orders made from credit jobs, by job key */
  creditOrders: Map<number, CreditOrder>
  /** When the continuing job in Gulshan's D3 started yesterday (Faruk) */
  d3Start: Ms
}

function desiredTime(w: World, day: ISODate, from: string, to: string): Ms {
  const rng = w.rng("itemised")
  const a = dhakaAt(day, from)
  const b = dhakaAt(day, to)
  return a + Math.floor(rng.next() * ((b - a) / (5 * MINUTE))) * 5 * MINUTE
}

export function seedItemised(w: World, q: EventQueue, parties: PartiesOut, credit: CreditPlan): ItemisedOut {
  const rng = w.rng("itemised")
  const { C, today, yesterday, volume, small } = w.cal
  const specs: Spec[] = []
  const pool = parties.retail
  const regulars = pool.slice(0, Math.max(5, Math.floor(pool.length / 4)))
  const pickCustomer = (): PoolCustomer => (rng.bool(0.45) ? rng.pick(regulars) : rng.pick(pool))

  // Retail orders: the summary's volumes and mix, booked through the day.
  for (let day = C; day < today; day = isoAddDays(day, 1)) {
    const daysBack = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000)
    for (const studio of ["GUL", "UTT"] as Studio[]) {
      const n = Math.round(STUDIO_BASE[studio] * WEEKDAY_FACTOR[isoWeekday(day)] * rng.around(1, 0.06, 0.88, 1.12) * growthFactor(w, day) * volume)
      for (let i = 0; i < n; i++) {
        const customer = pickCustomer()
        const vehicle = rng.pick(customer.vehicles)
        const pick = drawRetailPick(rng, { allowLong: daysBack >= 6 })
        const roll = rng.next()
        const discountPct = roll < 0.03 ? 10 : roll < 0.18 ? 5 : 0
        const r2 = rng.next()
        specs.push({
          id: w.ctx.seq("so"),
          studio,
          day,
          desired: desiredTime(w, day, "09:00", "18:30"),
          partyId: customer.partyId,
          vehicleId: vehicle.id,
          cls: vehicle.cls,
          lines: priceJob(pick, vehicle.cls, PL.retail, discountPct),
          priceListId: PL.retail,
          discountPct,
          kind: "retail",
          deposit: r2 < 0.04 ? { daysBefore: rng.int(1, 4), method: rng.weighted<"cash" | "card" | "bkash">([["bkash", 50], ["cash", 25], ["card", 25]]) } : undefined,
          quoteDaysBefore: r2 < 0.02 || (r2 >= 0.04 && r2 < 0.08) ? rng.int(1, 4) : undefined,
        })
      }
    }
  }

  // Credit customers' jobs in the window become orders (mornings, fleet drop-offs).
  for (const job of credit.jobs) {
    if (job.date < C || job.date >= today) continue
    const party = CREDIT_BY_ID.get(job.partyId)!
    specs.push({
      id: w.ctx.seq("so"),
      studio: job.studio,
      day: job.date,
      desired: desiredTime(w, job.date, "09:00", "12:30"),
      partyId: job.partyId,
      vehicleId: job.vehicle.id,
      cls: job.vehicle.cls,
      lines: job.lines,
      priceListId: party.priceListId,
      discountPct: 0,
      kind: "credit",
      credit: job,
    })
  }

  // Planted: Shahed Kabir's two past orders (J1 to J6) and the E12 invoice (3 days ago).
  const o1 = isoAddDays(today, small ? -6 : -26)
  const o2 = isoAddDays(today, small ? -2 : -9)
  specs.push({
    id: PLANT.shahedOrder1, studio: "GUL", day: o1, desired: dhakaAt(o1, "10:00"), partyId: PTY.shahedKabir, vehicleId: VEH.corollaCross7731, cls: "SUV",
    lines: priceJob({ serviceIds: [SVC.WSH_PRM, SVC.PRT_WAX], addOnIds: [] }, "SUV", PL.retail, 0), priceListId: PL.retail, discountPct: 0, kind: "planted",
  })
  specs.push({
    id: PLANT.shahedOrder2, studio: "GUL", day: o2, desired: dhakaAt(o2, "09:30"), partyId: PTY.shahedKabir, vehicleId: VEH.corollaCross7731, cls: "SUV",
    lines: priceJob({ serviceIds: [SVC.WSH_EXP], addOnIds: [] }, "SUV", PL.retail, 0), priceListId: PL.retail, discountPct: 0, kind: "planted",
  })
  const e12Day = isoAddDays(today, -3)
  const e12Customer = pool.find((c) => c.vehicles.some((v) => v.cls === "SUV"))!
  const e12Vehicle = e12Customer.vehicles.find((v) => v.cls === "SUV")!
  specs.push({
    id: PLANT.e12Order, studio: "GUL", day: e12Day, desired: dhakaAt(e12Day, "09:15"), partyId: e12Customer.partyId, vehicleId: e12Vehicle.id, cls: "SUV",
    lines: priceJob({ serviceIds: [SVC.WSH_PRM, SVC.INT_DEEP], addOnIds: [] }, "SUV", PL.retail, 0), priceListId: PL.retail, discountPct: 0, kind: "planted",
    complaintNote: "Customer called the next day: a damp smell in the rear carpet after the interior clean.",
  })

  // Schedule per studio, day by day in booking order.
  const schedulers: Record<Studio, StudioScheduler> = { GUL: new StudioScheduler("GUL"), UTT: new StudioScheduler("UTT") }
  const cutoff = dhakaAt(yesterday, "21:00")
  const creditOrders = new Map<number, CreditOrder>()
  let d3Start = dhakaAt(yesterday, "11:00")
  const byDay = new Map<ISODate, Spec[]>()
  for (const s of specs) {
    const list = byDay.get(s.day) ?? []
    list.push(s)
    byDay.set(s.day, list)
  }
  for (let day = C; day < today; day = isoAddDays(day, 1)) {
    if (day === yesterday) d3Start = blockYesterday(w, schedulers)
    // Credit and planted jobs first (they never drop), then walk-ins in booking order; a walk-in that
    // cannot start by noon the next day is turned away.
    const list = (byDay.get(day) ?? []).sort((a, b) => (a.kind === "retail" ? 1 : 0) - (b.kind === "retail" ? 1 : 0) || a.desired - b.desired)
    const latestStart = dhakaAt(isoAddDays(day, 1), "12:00")
    for (const spec of list) {
      const sch = schedulers[spec.studio]
      const serviceIds = spec.lines.flatMap((l) => (l.serviceId ? [l.serviceId] : []))
      const tasks = spec.lines.map((l) => ({ minutes: l.durationMin, coating: l.serviceId ? SERVICE_BY_ID.get(l.serviceId)!.category === "protection" : false }))
      const placement = sch.plan(spec.desired, bayKindFor(serviceIds), tasks)
      if (!placement || placement.end > cutoff || (spec.kind === "retail" && placement.start > latestStart)) {
        if (spec.kind !== "retail") throw new Error(`seed: could not schedule ${spec.id} on ${spec.day}`)
        continue
      }
      sch.commit(placement)
      const written = writeHistoryOrder(w, q, spec, placement)
      if (spec.credit) creditOrders.set(spec.credit.key, { ...written, job: spec.credit })
    }
  }

  seedCounterSales(w, q)
  return { creditOrders, d3Start }
}

/**
 * Yesterday Polash could not sign in (locked), and Faruk started the
 * continuing job in Gulshan's D3 once he and the bay were free (from 11:00):
 * keep them, and D3, out of the history scheduler.
 */
function blockYesterday(w: World, schedulers: Record<Studio, StudioScheduler>): Ms {
  const gul = schedulers.GUL
  const from = Math.max(dhakaAt(w.cal.yesterday, "11:00"), gul.freeAt("bay_gul_d3"), gul.freeAt("usr_faruk"))
  const start = Math.ceil(from / (5 * MINUTE)) * 5 * MINUTE
  if (start > dhakaAt(w.cal.yesterday, "17:00")) throw new Error("seed: Gulshan D3 busy late into yesterday")
  gul.block("bay_gul_d3", start)
  gul.block("usr_faruk", start)
  schedulers.UTT.block("usr_polash", dhakaAt(w.cal.yesterday, "00:00"))
  return start
}

function writeHistoryOrder(w: World, q: EventQueue, spec: Spec, placement: Placement) {
  const rng = w.rng("itemised-life")
  const { yesterday } = w.cal
  const loc = STUDIO_LOC[spec.studio]
  const end = placement.end
  const failFirst = rng.bool(0.02)
  const qcAt = end + (failFirst ? 30 : 10) * MINUTE
  let delivered = qcAt + rng.int(10, 50) * MINUTE
  const endDay = dhakaDate(end)
  if (delivered > dhakaAt(endDay, "21:45")) {
    delivered = endDay < yesterday ? dhakaAt(isoAddDays(endDay, 1), "09:20") + rng.int(0, 60) * MINUTE : dhakaAt(endDay, "21:45")
  }
  const total = spec.lines.reduce((s, l) => s + l.netP + l.vatP, 0)
  const retail = spec.kind !== "credit"
  const advisorId = rng.bool(0.8) ? ADVISOR[spec.studio] : MANAGER[spec.studio]

  // Booking: walk-in on the day, or days earlier through a quotation or with a deposit.
  const daysBefore = Math.max(spec.deposit?.daysBefore ?? 0, spec.quoteDaysBefore ?? 0)
  const earliest = Math.round((Date.parse(spec.day) - Date.parse(w.cal.C)) / 86_400_000)
  const before = Math.min(daysBefore, earliest)
  const bookedAt =
    before > 0
      ? desiredTime(w, isoAddDays(spec.day, -before), "11:00", "19:00")
      : Math.min(spec.desired, placement.start) - rng.int(0, 20) * MINUTE

  let quotationId: Id | undefined
  if (spec.quoteDaysBefore && before > 0) quotationId = writeQuotation(w, spec, bookedAt - rng.int(2, 26) * 60 * MINUTE, advisorId)

  let discountApprovalId: Id | undefined
  if (spec.discountPct > w.limitOf(advisorId, "discount-pct")) {
    const manager = MANAGER[spec.studio]
    discountApprovalId = w.approval({
      kind: "discount-pct",
      docType: "salesOrders",
      docId: spec.id,
      docNo: () => w.ctx.bag.get("salesOrders", spec.id).orderNo,
      locationId: loc,
      pct: spec.discountPct,
      requestedBy: advisorId,
      requestedAt: bookedAt,
      status: "approved",
      decidedBy: manager,
      decidedAt: bookedAt,
      reason: "Returning customer",
      decisionReason: "Returning customer",
      inline: true,
    }).id
  }

  const deposit = spec.deposit && before > 0 ? Math.max(1000_00, Math.round((total * rng.int(20, 40)) / 100 / 500_00) * 500_00) : 0
  const advance = Math.min(deposit, total)
  const status = retail ? "closed" : "delivered"
  const { order, lines } = writeOrder(w, q, {
    id: spec.id,
    studio: spec.studio,
    partyId: spec.partyId,
    vehicleId: spec.vehicleId,
    cls: spec.cls,
    lines: spec.lines,
    priceListId: spec.priceListId,
    discountPct: spec.discountPct,
    discountApprovalId,
    advisorId,
    bookedAt,
    bayId: placement.bayId,
    tasks: placement.tasks.map((t) => ({ ...t, state: "done" as const })),
    status,
    qc: { failFirst, at: qcAt, by: MANAGER[spec.studio] },
    qcAt: end + 5 * MINUTE,
    readyAt: qcAt,
    deliveredAt: delivered,
    invoicedAt: retail ? delivered + MINUTE : undefined,
    closedAt: retail ? delivered + 2 * MINUTE : undefined,
    quotationId,
    advanceP: advance,
    complaintNote: spec.complaintNote,
  })
  if (quotationId) {
    const qt = w.ctx.bag.get("quotations", quotationId)
    qt.orderId = order.id
  }
  if (deposit > 0) {
    writeCounterReceipt(w, {
      studio: spec.studio,
      partyId: spec.partyId,
      date: dhakaDate(bookedAt),
      at: bookedAt + MINUTE,
      method: spec.deposit!.method,
      amountP: deposit,
      orderId: order.id,
      takenBy: advisorId,
      rule: "R3",
      tenderedP: spec.deposit!.method === "cash" ? deposit : undefined,
    })
  }
  if (retail) {
    const cashier = CASHIER[spec.studio]
    const invoice = writeInvoice(w, {
      id: spec.id === PLANT.e12Order ? PLANT.e12Invoice : undefined,
      loc,
      partyId: spec.partyId,
      orderIds: [order.id],
      date: dhakaDate(delivered),
      at: delivered + MINUTE,
      dueDate: dhakaDate(delivered),
      kind: "counter",
      lines: invoiceLinesOf(lines, { vehicleId: spec.vehicleId, advisorId }),
      advanceAppliedP: advance,
      issuedBy: cashier,
    })
    payAtCounter(w, spec.studio, invoice, delivered + 2 * MINUTE, cashier)
  }
  // The customer's vehicle was last serviced at the handover.
  const vehicle = w.ctx.bag.get("vehicles", spec.vehicleId)
  vehicle.lastServiceAt = Math.max(vehicle.lastServiceAt ?? 0, delivered)
  return { order, lines }
}

function writeQuotation(w: World, spec: Spec, at: Ms, advisorId: Id): Id {
  const { bag } = w.ctx
  const loc = STUDIO_LOC[spec.studio]
  let subtotal = 0
  let discount = 0
  let vat = 0
  for (const l of spec.lines) {
    subtotal += l.grossP
    discount += l.discountP
    vat += l.vatP
  }
  const date = dhakaDate(at)
  const id = w.ctx.seq("qt")
  const qt = bag.put("quotations", id, at, {
    quoteNo: "",
    locationId: loc,
    partyId: spec.partyId,
    vehicleId: spec.vehicleId,
    advisorId,
    priceListId: spec.priceListId,
    discountPct: spec.discountPct,
    status: "accepted",
    validUntil: isoAddDays(date, 7),
    inspectionNotes: "Walk-around done with the customer; paint condition noted.",
    subtotalP: subtotal,
    discountP: discount,
    vatP: vat,
    totalP: subtotal - discount + vat,
    sentAt: at + 5 * MINUTE,
  }, advisorId)
  w.number("QT", { location: loc, date }, at, (no) => {
    qt.quoteNo = no
  })
  spec.lines.forEach((l, i) => {
    bag.put("quotationLines", w.ctx.seq("qtl"), at, {
      quotationId: id,
      lineNo: i + 1,
      kind: l.kind,
      refId: l.refId,
      packageId: l.packageId,
      vehicleClass: l.cls,
      descriptionEn: l.descriptionEn,
      descriptionBn: l.descriptionBn,
      qty: 1,
      unitPriceP: l.unitPriceP,
      discountP: l.discountP,
      vatRatePct: 15,
      vatP: l.vatP,
      netP: l.netP,
      revenueTag: l.revenueTag,
    })
  })
  return id
}

/** Counter sales of retail goods to the walk-in party (about ৳2,500 a day per studio). */
function seedCounterSales(w: World, q: EventQueue) {
  const rng = w.rng("counter")
  for (let day = w.cal.C; day < w.cal.today; day = isoAddDays(day, 1)) {
    for (const studio of ["GUL", "UTT"] as Studio[]) {
      const target = rng.around(2_500_00, 700_00, 900_00, 4_500_00) * w.cal.volume
      let sum = 0
      let guard = 0
      while (sum < target && guard++ < 12) {
        const n = rng.weighted<number>([[1, 70], [2, 25], [3, 5]])
        const lines: { itemId: Id; qty: number }[] = []
        for (let k = 0; k < n; k++) {
          const itemId = rng.weighted(RETAIL_WEIGHTS)
          const existing = lines.find((l) => l.itemId === itemId)
          if (existing) existing.qty += 1
          else lines.push({ itemId, qty: rng.bool(0.15) ? 2 : 1 })
        }
        const at = desiredTime(w, day, "10:00", "20:30")
        sum += writeCounterSale(w, q, studio, day, at, lines)
      }
    }
  }
}

export function writeCounterSale(w: World, q: EventQueue, studio: Studio, day: ISODate, at: Ms, items: { itemId: Id; qty: number }[]): number {
  const loc = STUDIO_LOC[studio]
  const cashier = CASHIER[studio]
  const lines: InvoiceLineInput[] = items.map(({ itemId, qty }) => {
    const item = ITEM_BY_ID.get(itemId)!
    const unit = item.retail! * 100
    const net = unit * qty
    return {
      itemId,
      descriptionEn: item.nameEn,
      descriptionBn: item.nameBn,
      qty,
      unitPriceP: unit,
      discountP: 0,
      vatP: percentOf(net, 15),
      netP: net,
      revenueTag: "REV_PRODUCTS",
    }
  })
  const invoice = writeInvoice(w, { loc, partyId: PTY.walkIn, orderIds: [], date: day, at, dueDate: day, kind: "counter", lines, advanceAppliedP: 0, issuedBy: cashier })
  payAtCounter(w, studio, invoice, at + MINUTE, cashier)
  for (const it of items) q.need({ itemId: it.itemId, loc, qty: it.qty, at, date: day })
  q.add(at, () => {
    const ref = { docType: "salesInvoices", docId: invoice.id, docNo: () => invoice.invoiceNo }
    const valued: { itemId: Id; valueP: number }[] = []
    const moveIds: Id[] = []
    for (const it of items) {
      const res = w.stock.issue({ itemId: it.itemId, locationId: loc, qtyBase: it.qty, type: "sale-delivery", ref, at, date: day })
      valued.push({ itemId: it.itemId, valueP: res.valueP })
      moveIds.push(...res.moves.map((m) => m.moveId))
    }
    const journal = w.ledger.post({
      rule: "R5",
      date: day,
      at,
      lines: linesForRetailGoodsOut({ locationId: loc, lines: valued }),
      narration: () => `Retail goods out, ${invoice.invoiceNo}`,
      source: { app: "si", docType: "salesInvoices", docId: invoice.id, docNo: () => invoice.invoiceNo },
      preparedBy: cashier,
    })
    w.stock.linkJournal(moveIds, journal.id)
  })
  return invoice.subtotalP
}
