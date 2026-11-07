import { z } from "zod"

import { rules } from "@/config/rules.config"
import { createReceipt } from "@/core/ar/receipt"
import { queueSms } from "@/core/comms/sms"
import { dhakaTime } from "@/core/clock/dates"
import type { DocRef, Id, ItemRow, JobTaskRow, PartyRow, Poisha, SalesOrderLineRow, SalesOrderRow, VehicleRow } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForJobConsumption, RULE_VOUCHER, type ValuedItemLine } from "@/core/ledger/rules"
import { grantAllows, resolveSecurity } from "@/core/security/resolve"
import { inventoryTagOf, issueStock, receiveStock } from "@/core/stock/moves"
import { formatDmy, formatMoney } from "@/lib/i18n/format"
import { loadCatalogue } from "@/modules/pc/catalogue"
import { priceRequests, serviceDuration, type Catalogue, type LineRequest, type PricedDraft, type PricingResult } from "@/modules/pc/pricing"

/**
 * STL helpers shared by the commands (plan §6.1): pricing a request for a
 * party and vehicle, writing order lines, deposits (R3), task timing and
 * double-booking checks, recipe consumption (R4).
 */

export const MINUTE = 60_000

export const LINE_REQUEST = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("service"), serviceId: z.string() }),
  z.object({ kind: z.literal("package"), packageId: z.string() }),
  z.object({ kind: z.literal("add-on"), addOnId: z.string(), qty: z.number().int().positive().optional() }),
  z.object({ kind: z.literal("item"), itemId: z.string(), qty: z.number().positive() }),
])

export const INLINE = z.object({ approverId: z.string(), pin: z.string(), reason: z.string().min(1) })

export const DEPOSIT = z.object({
  method: z.enum(["cash", "card", "bkash", "nagad"]),
  amountP: z.number().int().positive(),
  /** Card authorisation code or MFS transaction reference (simulated) */
  ref: z.string().optional(),
  /** bKash/Nagad: the customer approved the push in the simulated dialog */
  confirmed: z.boolean().default(true),
  tenderedP: z.number().int().optional(),
})
export type DepositInput = z.infer<typeof DEPOSIT>

export const orderRef = (order: Pick<SalesOrderRow, "id" | "orderNo">): DocRef => ({
  docType: "salesOrders",
  docId: order.id,
  docNo: order.orderNo,
})

/** Lines that become tasks (services and add-ons that are not cancelled). */
export const isTaskLine = (line: Pick<SalesOrderLineRow, "kind" | "status">) =>
  (line.kind === "service" || line.kind === "add-on") && line.status !== "cancelled"

/** Statuses in which a task still occupies its bay and technician. */
const BUSY_ORDER = new Set(["booked", "in-progress", "qc"])

export type PricedForParty = PricingResult & { party: PartyRow; vehicle?: VehicleRow; priceListId: Id; catalogue: Catalogue }

/** Price requested lines for a party (its price list) and vehicle (its class), on today. */
export async function priceForParty(
  tx: Tx,
  input: { partyId: Id; vehicleId?: Id | null; requests: LineRequest[]; discountPct: number; promotionId?: Id | null }
): Promise<PricedForParty> {
  const party = await tx.get("parties", input.partyId)
  if (!party.isCustomer) tx.reject("STL_NOT_CUSTOMER", { party: party.nameEn })
  const vehicle = input.vehicleId ? await tx.get("vehicles", input.vehicleId) : undefined
  if (vehicle && vehicle.partyId !== party.id) tx.reject("STL_VEHICLE_PARTY", { regNo: vehicle.regNo })
  const catalogue = await loadCatalogue(tx)
  const needsClass = input.requests.some((r) => r.kind === "service" || r.kind === "package")
  if (needsClass && !vehicle) tx.reject("STL_VEHICLE_REQUIRED")
  if (!input.requests.length) tx.reject("STL_NO_LINES")
  const result = priceRequests(catalogue, {
    priceListId: party.priceListId,
    date: tx.today(),
    vehicleClass: vehicle?.vehicleClass,
    requests: input.requests,
    discountPct: input.discountPct,
    promotionId: input.promotionId,
  })
  if (result.problems.length) tx.reject("STL_PRICING", { problem: result.problems[0] })
  if (!result.list) tx.reject("STL_NO_PRICE_LIST")
  return { ...result, party, vehicle, priceListId: result.list.id, catalogue }
}

/** Write priced lines as order lines. */
export function insertOrderLines(tx: Tx, orderId: Id, lines: PricedDraft[]): SalesOrderLineRow[] {
  return lines.map((l, i) =>
    tx.insert("salesOrderLines", {
      orderId,
      lineNo: i + 1,
      kind: l.kind,
      refId: l.refId,
      packageId: l.packageId,
      vehicleClass: l.vehicleClass,
      descriptionEn: l.descriptionEn,
      descriptionBn: l.descriptionBn,
      qty: l.qty,
      unitPriceP: l.unitPriceP,
      discountP: l.discountP,
      vatRatePct: l.vatRatePct,
      vatP: l.vatP,
      netP: l.netP,
      revenueTag: l.revenueTag,
      status: "open",
      qtyDelivered: 0,
      qtyInvoiced: 0,
    })
  )
}

/** Order kind: goods only is a product order; services for fleets, dealers and corporates are B2B. */
export function orderKindFor(party: PartyRow, lines: Pick<PricedDraft, "kind">[]): SalesOrderRow["kind"] {
  if (!lines.some((l) => l.kind !== "item")) return "product"
  return party.segment === "fleet" || party.segment === "dealer" || party.segment === "corporate" ? "b2b" : "service"
}

/** Money and dates for SMS text (templates carry numbers, dates and amounts only). */
export const smsMoney = (p: Poisha) => formatMoney(p, "en")
export const smsDate = (ms: number | string) => formatDmy(ms, "en")

/**
 * Take a booking deposit through createReceipt (R3, held as customer
 * advance); the simulated card or MFS approval ran in the dialog before the
 * commit. Returns the posted receipt.
 */
export async function takeDeposit(
  tx: Tx,
  order: SalesOrderRow,
  deposit: DepositInput,
  idempotencyKey: string
) {
  if (deposit.amountP > order.totalP) tx.reject("STL_DEPOSIT_TOO_LARGE")
  if ((deposit.method === "bkash" || deposit.method === "nagad") && !deposit.confirmed) tx.reject("STL_DEPOSIT_NOT_CONFIRMED")
  const receipt = await createReceipt(tx, {
    partyId: order.partyId,
    locationId: order.locationId,
    method: deposit.method,
    amountP: deposit.amountP,
    allocations: [],
    orderId: order.id,
    ref: deposit.ref,
    confirmed: true,
    idempotencyKey: `${idempotencyKey}:deposit`,
    tenderedP: deposit.method === "cash" ? (deposit.tenderedP ?? deposit.amountP) : undefined,
    changeP: deposit.method === "cash" && deposit.tenderedP ? deposit.tenderedP - deposit.amountP : undefined,
    rule: "R3",
  })
  await tx.update("salesOrders", order.id, { advanceP: order.advanceP + deposit.amountP })
  tx.emit("DepositReceived", {
    refs: { orderId: order.id, receiptId: receipt.id, partyId: order.partyId },
    params: { no: order.orderNo, amount: deposit.amountP / 100 },
    locationId: order.locationId,
  })
  return receipt
}

/** The booking SMS (document number, date, time and the deposit when one was taken). */
export async function sendBookingSms(tx: Tx, order: SalesOrderRow, depositP: Poisha) {
  const party = await tx.get("parties", order.partyId)
  if (!party.smsConsent || !party.phone) return
  const when = { orderNo: order.orderNo, date: smsDate(order.scheduledAt), time: dhakaTime(order.scheduledAt) }
  queueSms(tx, {
    to: party.phone,
    partyId: party.id,
    lang: "en",
    ...(depositP > 0
      ? { templateId: "booking-confirmed", params: { ...when, amount: smsMoney(depositP) } }
      : { templateId: "booking-booked", params: when }),
  })
}

/* ================================================================== *
 * Scheduling
 * ================================================================== */

/** Minutes a line takes for its class (services) or per add-on. */
export function lineMinutes(cat: Catalogue, line: Pick<SalesOrderLineRow, "kind" | "refId" | "vehicleClass" | "qty">): number {
  if (line.kind === "service") return serviceDuration(cat, line.refId, line.vehicleClass ?? "SD")
  if (line.kind === "add-on") return (cat.addOns.get(line.refId)?.durationMin ?? 30) * line.qty
  return 0
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

/** A task's planned interval. */
export const taskInterval = (t: Pick<JobTaskRow, "plannedStart" | "plannedMinutes">) => ({
  start: t.plannedStart,
  end: t.plannedStart + t.plannedMinutes * MINUTE,
})

/**
 * Refuse a planned task that overlaps another live task in the same bay
 * (BAY_BUSY) or of the same technician (TECHNICIAN_BUSY). Tasks of the same
 * order, finished tasks and tasks of closed or cancelled orders don't count.
 */
export async function assertFree(
  tx: Tx,
  task: { orderId: Id; bayId: Id; technicianId: Id; start: number; end: number; ignoreTaskIds?: Set<Id> }
) {
  const orderStatus = new Map<Id, string>()
  const live = async (t: JobTaskRow) => {
    if (t.orderId === task.orderId || t.status === "done" || task.ignoreTaskIds?.has(t.id)) return false
    if (!orderStatus.has(t.orderId)) orderStatus.set(t.orderId, (await tx.find("salesOrders", t.orderId))?.status ?? "cancelled")
    return BUSY_ORDER.has(orderStatus.get(t.orderId)!)
  }
  for (const other of await tx.list("jobTasks", "bayId", task.bayId)) {
    const iv = taskInterval(other)
    if ((await live(other)) && overlaps(task.start, task.end, iv.start, iv.end)) {
      const bay = await tx.get("bays", task.bayId)
      tx.reject("BAY_BUSY", { bay: bay.code, time: dhakaTime(iv.start) })
    }
  }
  for (const other of await tx.list("jobTasks", "technicianId", task.technicianId)) {
    const iv = taskInterval(other)
    if ((await live(other)) && overlaps(task.start, task.end, iv.start, iv.end)) {
      const user = await tx.get("users", task.technicianId)
      tx.reject("TECHNICIAN_BUSY", { name: user.nameEn, time: dhakaTime(iv.start) })
    }
  }
}

/** The technician must be active, work at the location and hold stl.job.work there. */
export async function assertTechnician(tx: Tx, technicianId: Id, locationId: Id) {
  const user = await tx.find("users", technicianId)
  if (!user || user.status !== "active" || !user.locationIds.includes(locationId)) {
    tx.reject("STL_NOT_TECHNICIAN", { name: user?.nameEn ?? technicianId })
  }
  const security = await resolveSecurity(tx.db, user.id)
  if (!grantAllows(security, "stl.job.work", user.locationIds, locationId)) tx.reject("STL_NOT_TECHNICIAN", { name: user.nameEn })
}

/**
 * Technicians act only on their own tasks; a studio manager (who also edits
 * orders) may act on any task at the studio.
 */
export function assertOwnTask(tx: Tx, task: Pick<JobTaskRow, "technicianId" | "locationId">) {
  if (task.technicianId === tx.actor.userId) return
  if (tx.can("stl.order.edit", task.locationId) || tx.can("stl.qc.check", task.locationId)) return
  tx.reject("STL_NOT_YOUR_TASK", {}, { audit: true })
}

/* ================================================================== *
 * Consumption (R4)
 * ================================================================== */

export type IssueLine = { itemId: Id; qtyBase: number; standardQty: number }

/**
 * Issue items FEFO at the studio's average cost for an order and post R4 in
 * the same commit; one jobConsumptions row per item. Returns the value.
 */
export async function issueToJob(
  tx: Tx,
  input: {
    order: SalesOrderRow
    orderLineId?: Id
    taskId?: Id
    locationId: Id
    lines: IssueLine[]
    kind: "recipe" | "extra"
    by: Id
    narration: string
  }
): Promise<Poisha> {
  const ref = orderRef(input.order)
  const valued: ValuedItemLine[] = []
  const moveIds: Id[] = []
  for (const line of input.lines) {
    if (line.qtyBase <= 0) continue
    const item = await tx.get("items", line.itemId)
    const out = await issueStock(tx, { itemId: item.id, locationId: input.locationId, qtyBase: line.qtyBase, type: "issue-job", ref })
    const tag = await inventoryTagOf(tx, item)
    valued.push({ itemId: item.id, tag, valueP: out.valueP })
    moveIds.push(...out.moves.map((m) => m.moveId))
    tx.insert("jobConsumptions", {
      orderId: input.order.id,
      orderLineId: input.orderLineId,
      taskId: input.taskId,
      itemId: item.id,
      locationId: input.locationId,
      standardQty: line.standardQty,
      actualQty: line.qtyBase,
      kind: input.kind,
      valueP: out.valueP,
      stockMoveIds: out.moves.map((m) => m.moveId),
      at: tx.now(),
      by: input.by,
    })
  }
  const total = valued.reduce((s, v) => s + v.valueP, 0)
  if (total > 0) {
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R4,
      date: tx.today(),
      source: { app: "stl", ...ref },
      narration: input.narration,
      lines: linesForJobConsumption({ locationId: input.locationId, lines: valued.filter((v) => v.valueP > 0) }),
      rule: "R4",
    })
    for (const id of moveIds) await tx.update("stockMoves", id, { journalId: journal.id })
  }
  return total
}

/**
 * Return unused stock from a job to the studio shelf at the value it carried
 * (the order's average issue value of that item), reversing R4.
 */
export async function returnFromJob(
  tx: Tx,
  input: { order: SalesOrderRow; orderLineId?: Id; taskId?: Id; locationId: Id; item: ItemRow; qtyBase: number; by: Id; narration: string }
): Promise<Poisha> {
  const ref = orderRef(input.order)
  const rows = (await tx.list("jobConsumptions", "orderId", input.order.id)).filter((c) => c.itemId === input.item.id)
  const netQty = rows.reduce((s, c) => s + c.actualQty, 0)
  const netValue = rows.reduce((s, c) => s + c.valueP, 0)
  if (input.qtyBase > netQty + 1e-9) tx.reject("STL_RETURN_EXCEEDS", { item: input.item.sku, issued: netQty })
  const valueP = input.qtyBase >= netQty - 1e-9 ? netValue : Math.round((input.qtyBase * netValue) / netQty)
  // Back into the batch of the latest issue to this job, when known.
  const lastMoveId = [...rows].reverse().find((c) => c.kind !== "return" && c.stockMoveIds.length)?.stockMoveIds.at(-1)
  const batchId = lastMoveId ? (await tx.find("stockMoves", lastMoveId))?.batchId : undefined
  const out = await receiveStock(tx, { itemId: input.item.id, locationId: input.locationId, qtyBase: input.qtyBase, valueP, type: "issue-job", ref, batchId })
  tx.insert("jobConsumptions", {
    orderId: input.order.id,
    orderLineId: input.orderLineId,
    taskId: input.taskId,
    itemId: input.item.id,
    locationId: input.locationId,
    standardQty: 0,
    actualQty: -input.qtyBase,
    kind: "return",
    valueP: -valueP,
    stockMoveIds: out.moves.map((m) => m.moveId),
    at: tx.now(),
    by: input.by,
  })
  if (valueP > 0) {
    const tag = await inventoryTagOf(tx, input.item)
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R4,
      date: tx.today(),
      source: { app: "stl", ...ref },
      narration: input.narration,
      lines: linesForJobConsumption({ locationId: input.locationId, lines: [{ itemId: input.item.id, tag, valueP }], reverse: true }),
      rule: "R4",
    })
    for (const m of out.moves) await tx.update("stockMoves", m.moveId, { journalId: journal.id })
  }
  return valueP
}

export const QUOTE_VALIDITY_DAYS = rules.quoteValidityDays
