import { atDhaka, dhakaTime } from "@/core/clock/dates"
import type { Id, ISODate, Ms, SalesOrderRow } from "@/core/db/schema"
import { RuleViolation } from "@/core/engine/errors"
import { setStockLevel } from "@/core/scenarios/helpers"
import type { ScenarioKit } from "@/core/scenarios/types"
import { BAY, ITM, PTY, SVC, USR, VEH } from "@/core/seed/content/seed-refs"
import { recordRefund } from "@/modules/ar/commands"
import { handover, HANDOVER_KEYS } from "@/modules/sd/commands"
import { checkout } from "@/modules/si/commands"
import { acceptQuotation, cancelOrder, finishTask, qcCheck, QC_KEYS, saveQuotation, scheduleOrder, startTask } from "@/modules/stl/commands"

/**
 * The main journey (plan §10 J1 to J6): Shahed Kabir's Toyota Corolla Cross
 * at Gulshan, ceramic coating 2-year and interior deep clean, a ৳10,000
 * bKash deposit, bay C1 with Rakib, QC and handover by Shahriar, the balance
 * by card and cash at Tania's counter. The jump launchers J2 to J6 bring the
 * journey forward from wherever it stands (never undoing live work); J1 starts
 * it over. Every step is a real command as the person who does it.
 */
export const JOURNEY = {
  partyId: PTY.shahedKabir,
  vehicleId: VEH.corollaCross7731,
  locationId: "loc_gul",
  bayId: BAY.GUL_C1,
  advisor: "nayeem",
  technician: "rakib",
  technicianId: USR.rakib,
  manager: "shahriar",
  cashier: "tania",
  services: [SVC.PRT_CC2, SVC.INT_DEEP],
  depositP: 10_000_00,
  /** Ceramic coating 2-year kit: the SUV recipe needs 38 ml; Gulshan keeps at least 100 ml. */
  itemId: ITM.cc2Kit,
  minStock: 100,
  /** Card part of the balance at the counter; the rest is cash. */
  cardP: 20_000_00,
  firstSlot: "11:00",
} as const

/** How far a journey order has got (0 none, then booked, scheduled, QC, delivered, paid). */
export const STAGE = { none: 0, booked: 1, scheduled: 2, qc: 3, delivered: 4, paid: 5 } as const
export type Stage = (typeof STAGE)[keyof typeof STAGE]

/** Today's journey order: the latest non-cancelled order today for the Corolla Cross at Gulshan. */
export async function journeyOrder(kit: ScenarioKit): Promise<SalesOrderRow | undefined> {
  const start = atDhaka(kit.today(), "00:00")
  const orders = await kit.db.salesOrders.where("vehicleId").equals(JOURNEY.vehicleId).toArray()
  return orders
    .filter((o) => o.locationId === JOURNEY.locationId && o.status !== "cancelled" && o.createdAt >= start)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
}

export async function stageOf(kit: ScenarioKit, order: SalesOrderRow | undefined): Promise<Stage> {
  if (!order) return STAGE.none
  switch (order.status) {
    case "booked": {
      const tasks = await kit.db.jobTasks.where("orderId").equals(order.id).count()
      return tasks > 0 ? STAGE.scheduled : STAGE.booked
    }
    case "in-progress":
      return STAGE.scheduled
    case "qc":
    case "ready":
      return STAGE.qc
    case "delivered":
      return STAGE.delivered
    default:
      return STAGE.paid
  }
}

/** A draft quotation today for the journey vehicle (the presenter may have saved one in J1). */
async function draftQuote(kit: ScenarioKit): Promise<Id | undefined> {
  const start = atDhaka(kit.today(), "00:00")
  const quotes = await kit.db.quotations.where("vehicleId").equals(JOURNEY.vehicleId).toArray()
  return quotes
    .filter((q) => q.locationId === JOURNEY.locationId && (q.status === "draft" || q.status === "sent") && q.createdAt >= start)
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.id
}

/** The customer's open advance (CUSTOMER_ADVANCE subledger, credit balance): what the next invoice applies. */
export async function advanceOf(kit: ScenarioKit, partyId: Id = JOURNEY.partyId): Promise<number> {
  const map = (await kit.db.settings.get("postingAccounts"))?.value as Record<string, Id> | undefined
  const account = map?.CUSTOMER_ADVANCE
  if (!account) return 0
  const lines = await kit.db.journalLines.where("partyId").equals(partyId).toArray()
  return lines.filter((l) => l.accountId === account).reduce((s, l) => s + l.creditP - l.debitP, 0)
}

/** Orders that hold bay C1 and Rakib (the scheduler's busy states). */
const BUSY = new Set(["booked", "in-progress", "qc"])

async function refund(kit: ScenarioKit, amountP: number, key: string): Promise<void> {
  const advance = Math.min(amountP, await advanceOf(kit))
  if (advance <= 0) return
  await kit.run(
    recordRefund,
    {
      partyId: JOURNEY.partyId,
      locationId: JOURNEY.locationId,
      method: "bkash",
      cashBankAccountId: "cba_bkash",
      amountP: advance,
      source: "deposit",
      reason: "Demo re-run: the deposit of a cleared journey booking returned",
      idempotencyKey: `${kit.runId}:${key}`,
    },
    JOURNEY.manager
  )
}

/**
 * Clears an earlier journey booking out of the way (plan §10 re-run rule:
 * "cancel the previous run's open order in a bay before booking it"): the
 * order is cancelled with a reason and its deposit returned, so the next
 * invoice applies exactly the new journey's deposit. `statuses` are the
 * order states to clear.
 */
async function clearOrder(kit: ScenarioKit, statuses: Set<string>): Promise<void> {
  const open = await journeyOrder(kit)
  if (!open || !statuses.has(open.status)) return
  await kit.run(cancelOrder, { orderId: open.id, reason: "Demo re-run: the previous journey's booking is cleared" }, JOURNEY.manager)
  await refund(kit, open.advanceP, `refund-${open.id}`)
}

/** J1: start the journey over: clear an open journey order (and any leftover advance), top up the kit. */
export async function clearJourney(kit: ScenarioKit): Promise<void> {
  await clearOrder(kit, new Set([...BUSY, "ready"]))
  await refund(kit, Number.MAX_SAFE_INTEGER, "refund-left")
  await setStockLevel(kit, { itemId: JOURNEY.itemId, locationId: JOURNEY.locationId, qtyBase: JOURNEY.minStock, mode: "at-least" })
}

/** First 15-minute slot from `firstSlot` (or now) where bay C1 and Rakib are both free. */
async function schedule(kit: ScenarioKit, order: SalesOrderRow): Promise<Ms> {
  const lines = (await kit.db.salesOrderLines.where("orderId").equals(order.id).sortBy("lineNo")).filter(
    (l) => l.kind === "service" || l.kind === "add-on"
  )
  const today: ISODate = kit.today()
  const step = 15 * 60_000
  const first = Math.max(atDhaka(today, JOURNEY.firstSlot), Math.ceil(kit.now() / step) * step)
  const last = atDhaka(today, "20:00")
  for (let start = first; start <= last; start += step) {
    try {
      await kit.run(
        scheduleOrder,
        {
          orderId: order.id,
          bayId: JOURNEY.bayId,
          start,
          assignments: lines.map((l) => ({ orderLineId: l.id, technicianId: JOURNEY.technicianId })),
        },
        JOURNEY.advisor
      )
      return start
    } catch (error) {
      if (error instanceof RuleViolation && (error.code === "BAY_BUSY" || error.code === "TECHNICIAN_BUSY")) continue
      throw error
    }
  }
  throw new RuleViolation("BAY_BUSY", { bay: "C1", time: dhakaTime(last) })
}

/**
 * Brings the journey to `target` and returns its order (J2 to J6): starts a
 * fresh journey when there is none, or when the current one is already past
 * the target (the presenter's work stays as it is), then performs each
 * missing step as the person who does it.
 */
export async function bringJourneyTo(kit: ScenarioKit, target: Stage): Promise<SalesOrderRow> {
  await setStockLevel(kit, { itemId: JOURNEY.itemId, locationId: JOURNEY.locationId, qtyBase: JOURNEY.minStock, mode: "at-least" })
  let order = await journeyOrder(kit)
  let stage = await stageOf(kit, order)
  if (!order || stage > target) {
    // A fresh journey. An earlier one that has finished its bay work stays as
    // it is; one still holding bay C1 is cleared first (re-run rule).
    if (order) await clearOrder(kit, BUSY)
    const quotationId =
      (await draftQuote(kit)) ??
      (
        await kit.run(
          saveQuotation,
          {
            locationId: JOURNEY.locationId,
            partyId: JOURNEY.partyId,
            vehicleId: JOURNEY.vehicleId,
            requests: JOURNEY.services.map((serviceId) => ({ kind: "service" as const, serviceId })),
            inspectionNotes: "Light swirl marks on the bonnet; interior: coffee stain on the rear seat",
          },
          JOURNEY.advisor
        )
      ).quotationId
    const accepted = await kit.run(
      acceptQuotation,
      {
        quotationId,
        deposit: { method: "bkash", amountP: JOURNEY.depositP, ref: `BK${kit.runId.slice(-8).toUpperCase()}`, confirmed: true },
        idempotencyKey: `${kit.runId}:accept`,
      },
      JOURNEY.advisor
    )
    order = (await kit.db.salesOrders.get(accepted.orderId))!
    stage = STAGE.booked
  }
  if (stage < STAGE.scheduled && target >= STAGE.scheduled) {
    await schedule(kit, order)
    stage = STAGE.scheduled
  }
  if (stage < STAGE.qc && target >= STAGE.qc) {
    const tasks = await kit.db.jobTasks.where("orderId").equals(order.id).sortBy("plannedStart")
    for (const task of tasks) {
      if (task.status === "queued") await kit.run(startTask, { taskId: task.id }, JOURNEY.technician)
      if (task.status !== "done") await kit.run(finishTask, { taskId: task.id }, JOURNEY.technician)
    }
    stage = STAGE.qc
  }
  if (stage < STAGE.delivered && target >= STAGE.delivered) {
    const current = (await kit.db.salesOrders.get(order.id))!
    if (current.status === "qc") {
      await kit.run(qcCheck, { orderId: order.id, items: QC_KEYS.map((key) => ({ key, ok: true })) }, JOURNEY.manager)
    }
    await kit.run(
      handover,
      {
        orderId: order.id,
        checklist: HANDOVER_KEYS.map((key) => ({ key, ok: true })),
        signatureName: "Shahed Kabir",
        signatureSvg: "M10 40 C 30 10, 50 70, 70 30 S 110 50, 130 20",
      },
      JOURNEY.manager
    )
    stage = STAGE.delivered
  }
  if (stage < STAGE.paid && target >= STAGE.paid) {
    const current = (await kit.db.salesOrders.get(order.id))!
    const due = current.totalP - Math.min(current.totalP, await advanceOf(kit, JOURNEY.partyId))
    const card = Math.min(JOURNEY.cardP, due)
    const tenders = [
      ...(card > 0 ? [{ method: "card" as const, amountP: card, ref: `AUTH${kit.runId.slice(-6).toUpperCase()}` }] : []),
      ...(due - card > 0 ? [{ method: "cash" as const, amountP: due - card, tenderedP: due - card }] : []),
    ]
    await kit.run(checkout, { orderIds: [order.id], tenders, idempotencyKey: `${kit.runId}:checkout` }, JOURNEY.cashier)
  }
  return (await kit.db.salesOrders.get(order.id))!
}

/** The journey's invoice (after J4's checkout or the presenter's). */
export async function journeyInvoice(kit: ScenarioKit, orderId: Id) {
  const invoices = await kit.db.salesInvoices.where("partyId").equals(JOURNEY.partyId).toArray()
  return invoices.filter((i) => i.orderIds.includes(orderId)).sort((a, b) => b.createdAt - a.createdAt)[0]
}
