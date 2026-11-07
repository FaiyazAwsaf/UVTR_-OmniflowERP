import type {
  ISODate,
  Id,
  Ms,
  ReceiptMethod,
  ReceiptRow,
  SalesInvoiceRow,
  SalesOrderLineRow,
  SalesOrderRow,
  SalesOrderStatus,
  VehicleClass,
} from "@/core/db/schema"
import { invoiceStatus } from "@/core/ar/receipt"
import {
  linesForCounterTenders,
  linesForDeposit,
  linesForJobConsumption,
  linesForMfsConfirmation,
  linesForSalesInvoice,
  type RuleCode,
} from "@/core/ledger/rules"

import { ITEM_BY_ID, TAG_OF_KIND } from "../content/catalogue"
import { CBA, LOC, USR } from "../content/seed-refs"
import type { EventQueue } from "../engine/events"
import type { World } from "../engine/world"
import { dhakaDate, MINUTE } from "../time"
import { recipeFor, VAT_PCT, type JobLine } from "./jobs"
import type { PlacedTask, Studio } from "./scheduler"

/**
 * Writers for the sales documents of an order's lifecycle (plan §6.1):
 * order and lines, tasks, consumption at task finish (R4), QC, handover
 * with a gate pass, the Mushak 6.3 invoice (R6, deposits applied), counter
 * tenders (R7) and confirmed MFS receipts (R9), booking deposits (R3) and
 * quotations. Every journal comes from its rule.
 */

export const STUDIO_LOC: Record<Studio, Id> = { GUL: LOC.GUL, UTT: LOC.UTT }
export const CASHIER: Record<Studio, Id> = { GUL: USR.tania, UTT: USR.sabbir }
export const MANAGER: Record<Studio, Id> = { GUL: USR.shahriar, UTT: USR.arif }
export const ADVISOR: Record<Studio, Id> = { GUL: USR.nayeem, UTT: USR.shuvo }
export const TILL: Record<Studio, Id> = { GUL: CBA.TILL_GUL, UTT: CBA.TILL_UTT }
export const TILL_TAG = { GUL: "CASH_TILL_GUL", UTT: "CASH_TILL_UTT" } as const

export const METHOD_ACCOUNT: Record<
  Exclude<ReceiptMethod, "cash">,
  {
    id: Id
    tag:
      | "CARD_CLEARING"
      | "MFS_BKASH"
      | "MFS_NAGAD"
      | "BANK_MAIN"
      | "BANK_COLLECTION"
  }
> = {
  card: { id: CBA.CARD, tag: "CARD_CLEARING" },
  bkash: { id: CBA.BKASH, tag: "MFS_BKASH" },
  nagad: { id: CBA.NAGAD, tag: "MFS_NAGAD" },
  "bank-transfer": { id: CBA.BRAC, tag: "BANK_MAIN" },
  cheque: { id: CBA.DBBL, tag: "BANK_COLLECTION" },
}

export type TaskState = "done" | "in-progress" | "queued"

export type OrderInput = {
  id: Id
  studio: Studio
  partyId: Id
  vehicleId: Id
  cls: VehicleClass
  lines: JobLine[]
  priceListId: Id
  discountPct: number
  discountApprovalId?: Id
  advisorId: Id
  bookedAt: Ms
  bayId: Id
  tasks: (PlacedTask & { state: TaskState; startedAt?: Ms })[]
  status: SalesOrderStatus
  qc?: { failFirst: boolean; at: Ms; by: Id }
  qcAt?: Ms
  readyAt?: Ms
  deliveredAt?: Ms
  invoicedAt?: Ms
  closedAt?: Ms
  quotationId?: Id
  advanceP?: number
  complaintNote?: string
  conditionNotes?: string
  kind?: "service" | "b2b"
}

export type WrittenOrder = { order: SalesOrderRow; lines: SalesOrderLineRow[] }

const CHECKLIST = ["exterior", "interior", "glass", "wheels", "belongings"]

/** Order, lines, tasks, QC rows and the handover (when delivered); consumption events for done tasks. */
export function writeOrder(
  w: World,
  q: EventQueue,
  input: OrderInput
): WrittenOrder {
  const { bag } = w.ctx
  const rng = w.rng("orders")
  const loc = STUDIO_LOC[input.studio]
  const bookedOn = dhakaDate(input.bookedAt)
  let subtotal = 0
  let discount = 0
  let vat = 0
  for (const l of input.lines) {
    subtotal += l.grossP
    discount += l.discountP
    vat += l.vatP
  }
  const startedAt =
    input.tasks.find((t) => t.state !== "queued")?.startedAt ??
    input.tasks.find((t) => t.state !== "queued")?.start
  const plannedEnd = input.tasks[input.tasks.length - 1]?.end ?? input.bookedAt
  const order = bag.put(
    "salesOrders",
    input.id,
    input.bookedAt,
    {
      orderNo: "",
      kind: input.kind ?? "service",
      locationId: loc,
      partyId: input.partyId,
      vehicleId: input.vehicleId,
      quotationId: input.quotationId,
      advisorId: input.advisorId,
      priceListId: input.priceListId,
      status: input.status,
      bookedOn,
      scheduledAt: input.tasks[0]?.start ?? input.bookedAt,
      bayId: input.bayId,
      promisedAt: plannedEnd + 30 * MINUTE,
      discountPct: input.discountPct,
      discountApprovalId: input.discountApprovalId,
      advanceP: input.advanceP ?? 0,
      odometerKm: rng.int(8_000, 160_000),
      conditionNotes:
        input.conditionNotes ??
        rng.pick([
          "No visible damage.",
          "Light swirl marks on the bonnet.",
          "Small scratch on the rear bumper.",
          "Stone chips on the front bumper.",
          "Water spots on the glass.",
        ]),
      complaintNote: input.complaintNote,
      photoCount: rng.int(4, 8),
      subtotalP: subtotal,
      discountP: discount,
      vatP: vat,
      totalP: subtotal - discount + vat,
      startedAt,
      qcAt: input.qcAt,
      readyAt: input.readyAt,
      deliveredAt: input.deliveredAt,
      invoicedAt: input.invoicedAt,
      closedAt: input.closedAt,
    },
    input.advisorId
  )
  order.updatedAt = Math.max(
    order.updatedAt,
    input.closedAt ??
      input.invoicedAt ??
      input.deliveredAt ??
      input.readyAt ??
      startedAt ??
      input.bookedAt
  )
  w.number("SO", { location: loc, date: bookedOn }, input.bookedAt, (no) => {
    order.orderNo = no
  })
  const orderNo = () => order.orderNo

  const delivered =
    input.status === "delivered" ||
    input.status === "invoiced" ||
    input.status === "closed"
  const lines = input.lines.map((l, i) => {
    const done = input.tasks[i]?.state === "done"
    return bag.put("salesOrderLines", w.ctx.seq("sol"), input.bookedAt, {
      orderId: order.id,
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
      vatRatePct: VAT_PCT,
      vatP: l.vatP,
      netP: l.netP,
      revenueTag: l.revenueTag,
      status: done ? "done" : "open",
      qtyDelivered: delivered ? 1 : 0,
      qtyInvoiced:
        input.status === "invoiced" || input.status === "closed" ? 1 : 0,
    })
  })

  input.tasks.forEach((t, i) => {
    const line = input.lines[i]
    const task = bag.put(
      "jobTasks",
      w.ctx.seq("tsk"),
      input.bookedAt,
      {
        orderId: order.id,
        orderLineId: lines[i].id,
        locationId: loc,
        serviceId: line.serviceId,
        technicianId: t.techId,
        bayId: input.bayId,
        plannedStart: t.start,
        plannedMinutes: t.minutes,
        status: t.state,
        startedAt: t.state === "queued" ? undefined : (t.startedAt ?? t.start),
        finishedAt: t.state === "done" ? t.end : undefined,
        minutes: t.state === "done" ? t.minutes : undefined,
      },
      MANAGER[input.studio]
    )
    if (t.state !== "queued")
      task.updatedAt = t.state === "done" ? t.end : (t.startedAt ?? t.start)
    if (t.state === "done" && line.serviceId) {
      const recipe = recipeFor(line.serviceId, line.cls)
      const date = dhakaDate(t.end)
      // The stock plan (transfers, purchases) must cover what is actually used, recipe plus variance.
      for (const r of recipe)
        q.need({
          itemId: r.itemId,
          loc,
          qty: actualQty(task.id, r.itemId, t.techId, r.qty),
          at: t.end,
          date,
        })
      q.add(t.end, () =>
        consume(w, {
          orderId: order.id,
          orderNo,
          orderLineId: lines[i].id,
          taskId: task.id,
          loc,
          at: t.end,
          by: t.techId,
          recipe,
        })
      )
    }
  })

  if (input.qc) {
    const items = (ok: boolean) => [
      { key: "finish", ok },
      { key: "interior", ok: true },
      { key: "glass", ok: true },
      { key: "wheels", ok: true },
    ]
    if (input.qc.failFirst) {
      bag.put(
        "qcChecks",
        w.ctx.seq("qc"),
        input.qc.at - 20 * MINUTE,
        {
          orderId: order.id,
          items: items(false).map((it) =>
            it.ok ? it : { ...it, note: "Haze left on the bonnet; rework" }
          ),
          result: "fail",
          checkedBy: input.qc.by,
          at: input.qc.at - 20 * MINUTE,
        },
        input.qc.by
      )
    }
    bag.put(
      "qcChecks",
      w.ctx.seq("qc"),
      input.qc.at,
      {
        orderId: order.id,
        items: items(true),
        result: "pass",
        checkedBy: input.qc.by,
        at: input.qc.at,
      },
      input.qc.by
    )
  }

  if (delivered && input.deliveredAt) {
    const date = dhakaDate(input.deliveredAt)
    const by = rng.bool(0.7) ? input.advisorId : MANAGER[input.studio]
    const party = bag.get("parties", input.partyId)
    const dn = bag.put(
      "deliveries",
      w.ctx.seq("dn"),
      input.deliveredAt,
      {
        deliveryNo: "",
        orderId: order.id,
        kind: "vehicle-handover",
        locationId: loc,
        status: "delivered",
        checklist: CHECKLIST.map((key) => ({ key, ok: true })),
        signatureName:
          party.type === "company"
            ? (party.contacts[0]?.name ?? party.nameEn)
            : party.nameEn,
        signedAt: input.deliveredAt,
        gatePassNo: "",
        deliveredBy: by,
        deliveredAt: input.deliveredAt,
      },
      by
    )
    w.number("DN", { location: loc, date }, input.deliveredAt, (no) => {
      dn.deliveryNo = no
    })
    w.number("GP", { location: loc, date }, input.deliveredAt, (no) => {
      dn.gatePassNo = no
    })
  }
  return { order, lines }
}

/** A stable number in [0, 1) from a string (FNV-1a), for per-task variation that never changes between seeds. */
function unit01(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h / 2 ** 32
}

/** Technicians whose jobs habitually use more chemical than the recipe (seed_data: consumption variance story). */
const HEAVY_HANDED = new Set(["usr_sajib", "usr_polash"])

/**
 * The chemical actually used on a task: technicians are not machines, so the
 * consumption variance report (IC) has a story. Two habitually use 6 to 14%
 * more on most jobs; everyone else is on the recipe, with now and then a
 * little more or a little less. Counted consumables (pads, towels) and the
 * ceramic coating kits stay exact.
 */
function actualQty(
  taskId: string,
  itemId: string,
  by: string,
  standard: number
): number {
  // Ceramic coating kits are dosed by the millilitre (and their levels are planted for J1 and E3).
  if (
    ITEM_BY_ID.get(itemId)?.kind !== "chemical" ||
    itemId.startsWith("itm_cc")
  )
    return standard
  const r = unit01(`${taskId}:${itemId}`)
  let factor = 1
  if (HEAVY_HANDED.has(by)) factor = r < 0.7 ? 1.06 + r * 0.11 : 1
  else if (r < 0.16) factor = 1.03 + r * 0.4
  else if (r > 0.92) factor = 0.95 + (r - 0.92) * 0.5
  return Math.max(0, Math.round(standard * factor))
}

/** R4: the line's recipe issued FEFO at the studio's average cost when the task finishes (the actual quantity used). */
function consume(
  w: World,
  input: {
    orderId: Id
    orderNo: () => string
    orderLineId: Id
    taskId: Id
    loc: Id
    at: Ms
    by: Id
    recipe: { itemId: Id; qty: number }[]
  }
) {
  const date = dhakaDate(input.at)
  const ref = {
    docType: "salesOrders",
    docId: input.orderId,
    docNo: input.orderNo,
  }
  const valued: {
    itemId: Id
    tag: "INV_CHEMICAL" | "INV_CONSUMABLE" | "INV_RETAIL"
    valueP: number
  }[] = []
  const moveIds: Id[] = []
  for (const r of input.recipe) {
    const used = actualQty(input.taskId, r.itemId, input.by, r.qty)
    const res = w.stock.issue({
      itemId: r.itemId,
      locationId: input.loc,
      qtyBase: used,
      type: "issue-job",
      ref,
      at: input.at,
      date,
    })
    valued.push({
      itemId: r.itemId,
      tag: TAG_OF_KIND[ITEM_BY_ID.get(r.itemId)!.kind],
      valueP: res.valueP,
    })
    moveIds.push(...res.moves.map((m) => m.moveId))
    w.ctx.bag.put(
      "jobConsumptions",
      w.ctx.seq("jcn"),
      input.at,
      {
        orderId: input.orderId,
        orderLineId: input.orderLineId,
        taskId: input.taskId,
        itemId: r.itemId,
        locationId: input.loc,
        standardQty: r.qty,
        actualQty: used,
        kind: "recipe",
        valueP: res.valueP,
        stockMoveIds: res.moves.map((m) => m.moveId),
        at: input.at,
        by: input.by,
      },
      input.by
    )
  }
  if (!valued.some((v) => v.valueP > 0)) return
  const journal = w.ledger.post({
    rule: "R4",
    date,
    at: input.at,
    lines: linesForJobConsumption({ locationId: input.loc, lines: valued }),
    narration: () => `Consumables used, ${input.orderNo()}`,
    source: {
      app: "stl",
      docType: "salesOrders",
      docId: input.orderId,
      docNo: input.orderNo,
    },
    preparedBy: input.by,
  })
  w.stock.linkJournal(moveIds, journal.id)
}

export type InvoiceLineInput = {
  orderLineId?: Id
  serviceId?: Id
  itemId?: Id
  addOnId?: Id
  vehicleId?: Id
  vehicleClass?: VehicleClass
  descriptionEn: string
  descriptionBn: string
  qty: number
  unitPriceP: number
  discountP: number
  vatP: number
  netP: number
  revenueTag: JobLine["revenueTag"]
  advisorId?: Id
}

/** A Mushak 6.3 invoice with its lines and R6 journal (advance applied in the same voucher). */
export function writeInvoice(
  w: World,
  input: {
    id?: Id
    loc: Id
    partyId: Id
    orderIds: Id[]
    date: ISODate
    at: Ms
    dueDate: ISODate
    kind: SalesInvoiceRow["kind"]
    lines: InvoiceLineInput[]
    advanceAppliedP: number
    issuedBy: Id
    creditOverrideApprovalId?: Id
  }
): SalesInvoiceRow {
  const { bag } = w.ctx
  const party = bag.get("parties", input.partyId)
  let subtotal = 0
  let discount = 0
  let vat = 0
  for (const l of input.lines) {
    subtotal += Math.round(l.qty * l.unitPriceP)
    discount += l.discountP
    vat += l.vatP
  }
  const total = subtotal - discount + vat
  const id = input.id ?? w.ctx.seq("inv")
  const invoice = bag.put(
    "salesInvoices",
    id,
    input.at,
    {
      invoiceNo: "",
      locationId: input.loc,
      partyId: input.partyId,
      orderIds: input.orderIds,
      date: input.date,
      issuedAt: input.at,
      dueDate: input.dueDate,
      kind: input.kind,
      buyerNameEn: party.nameEn,
      buyerBin: party.bin,
      subtotalP: subtotal,
      discountP: discount,
      vatP: vat,
      totalP: total,
      advanceAppliedP: input.advanceAppliedP,
      paidP: 0,
      reservedP: 0,
      creditedP: 0,
      status: "posted",
      creditOverrideApprovalId: input.creditOverrideApprovalId,
      journalId: "",
      printCount: 1,
      issuedBy: input.issuedBy,
    },
    input.issuedBy
  )
  invoice.status = invoiceStatus(invoice)
  w.number("INV", { location: input.loc, date: input.date }, input.at, (no) => {
    invoice.invoiceNo = no
  })
  input.lines.forEach((l, i) => {
    bag.put(
      "salesInvoiceLines",
      w.ctx.seq("invl"),
      input.at,
      {
        invoiceId: id,
        lineNo: i + 1,
        orderLineId: l.orderLineId,
        serviceId: l.serviceId,
        itemId: l.itemId,
        addOnId: l.addOnId,
        vehicleId: l.vehicleId,
        vehicleClass: l.vehicleClass,
        descriptionEn: l.descriptionEn,
        descriptionBn: l.descriptionBn,
        qty: l.qty,
        unitPriceP: l.unitPriceP,
        discountP: l.discountP,
        vatRatePct: VAT_PCT,
        vatP: l.vatP,
        netP: l.netP,
        revenueTag: l.revenueTag,
        date: input.date,
        locationId: input.loc,
        partyId: input.partyId,
        advisorId: l.advisorId,
      },
      input.issuedBy
    )
  })
  const journal = w.ledger.post({
    rule: "R6",
    date: input.date,
    at: input.at,
    lines: linesForSalesInvoice({
      partyId: input.partyId,
      locationId: input.loc,
      lines: input.lines.map((l) => ({
        revenueTag: l.revenueTag,
        grossP: Math.round(l.qty * l.unitPriceP),
        discountP: l.discountP,
        vatP: l.vatP,
      })),
      advanceAppliedP: input.advanceAppliedP,
    }),
    narration: () => `Sales invoice ${invoice.invoiceNo}`,
    source: {
      app: "si",
      docType: "salesInvoices",
      docId: id,
      docNo: () => invoice.invoiceNo,
    },
    preparedBy: input.issuedBy,
  })
  invoice.journalId = journal.id
  return invoice
}

/** Lines of an order (for its invoice). */
export function invoiceLinesOf(
  lines: SalesOrderLineRow[],
  extra: { vehicleId?: Id; advisorId?: Id } = {}
): InvoiceLineInput[] {
  return lines.map((l) => ({
    orderLineId: l.id,
    serviceId: l.kind === "service" ? l.refId : undefined,
    addOnId: l.kind === "add-on" ? l.refId : undefined,
    vehicleId: extra.vehicleId,
    vehicleClass: l.vehicleClass,
    descriptionEn: l.descriptionEn,
    descriptionBn: l.descriptionBn,
    qty: l.qty,
    unitPriceP: l.unitPriceP,
    discountP: l.discountP,
    vatP: l.vatP,
    netP: l.netP,
    revenueTag: l.revenueTag,
    advisorId: extra.advisorId,
  }))
}

/**
 * A customer receipt that posts at once: R3 deposit, R7 counter tender (cash
 * net of change, card), R9 confirmed bKash/Nagad. Allocations update the
 * invoices' paid amount and status.
 */
export function writeCounterReceipt(
  w: World,
  input: {
    id?: Id
    studio: Studio
    partyId: Id
    date: ISODate
    at: Ms
    method: "cash" | "card" | "bkash" | "nagad"
    amountP: number
    invoice?: SalesInvoiceRow
    orderId?: Id
    takenBy: Id
    rule: Extract<RuleCode, "R3" | "R7" | "R9">
    tenderedP?: number
  }
): ReceiptRow {
  const { bag } = w.ctx
  const loc = STUDIO_LOC[input.studio]
  const account =
    input.method === "cash"
      ? { id: TILL[input.studio], tag: TILL_TAG[input.studio] }
      : METHOD_ACCOUNT[input.method]
  const allocations = input.invoice
    ? [{ invoiceId: input.invoice.id, amountP: input.amountP }]
    : []
  const id = input.id ?? w.ctx.seq("mr")
  const receipt = bag.put(
    "receipts",
    id,
    input.at,
    {
      receiptNo: "",
      locationId: loc,
      partyId: input.partyId,
      date: input.date,
      method: input.method,
      cashBankAccountId: account.id,
      amountP: input.amountP,
      ref:
        input.method === "bkash" || input.method === "nagad"
          ? `TX${w.rng("orders").int(10_000_000, 99_999_999)}`
          : undefined,
      status: "posted",
      allocations,
      advanceP: input.invoice ? 0 : input.amountP,
      vdsDeductedP: 0,
      aitDeductedP: 0,
      orderId: input.orderId,
      journalId: "",
      idempotencyKey: `seed:${id}`,
      at: input.at,
      tenderedP: input.tenderedP,
      changeP:
        input.tenderedP !== undefined
          ? input.tenderedP - input.amountP
          : undefined,
      takenBy: input.takenBy,
    },
    input.takenBy
  )
  w.number("MR", { location: loc, date: input.date }, input.at, (no) => {
    receipt.receiptNo = no
  })
  const lines =
    input.rule === "R3"
      ? linesForDeposit({
          cashTag: account.tag,
          amountP: input.amountP,
          partyId: input.partyId,
          locationId: loc,
        })
      : input.rule === "R7"
        ? linesForCounterTenders({
            partyId: input.partyId,
            locationId: loc,
            tenders: [{ cashTag: account.tag, amountP: input.amountP }],
          })
        : linesForMfsConfirmation({
            partyId: input.partyId,
            locationId: loc,
            cashTag: account.tag,
            amountP: input.amountP,
            allocatedP: input.invoice ? input.amountP : 0,
            advanceP: input.invoice ? 0 : input.amountP,
          })
  const journal = w.ledger.post({
    rule: input.rule,
    date: input.date,
    at: input.at,
    lines,
    narration: () => `Receipt ${receipt.receiptNo}`,
    source: {
      app: "ar",
      docType: "receipts",
      docId: id,
      docNo: () => receipt.receiptNo,
    },
    preparedBy: input.takenBy,
  })
  receipt.journalId = journal.id
  if (input.invoice) {
    input.invoice.paidP += input.amountP
    input.invoice.status = invoiceStatus(input.invoice)
    input.invoice.updatedAt = Math.max(input.invoice.updatedAt, input.at)
  }
  return receipt
}

/** Tender mix at the counter (seed_data.md §7.1): cash 34%, card 28%, bKash 30%, Nagad 8%. */
export function drawTender(rng: {
  weighted: <T>(e: readonly [T, number][]) => T
}): "cash" | "card" | "bkash" | "nagad" {
  return rng.weighted<"cash" | "card" | "bkash" | "nagad">([
    ["cash", 34],
    ["card", 28],
    ["bkash", 30],
    ["nagad", 8],
  ])
}

/** Cash tendered: rounded up to the next ৳100, ৳500 or ৳1,000 note. */
export function tendered(
  amountP: number,
  rng: { pick: <T>(a: readonly T[]) => T }
): number {
  const step = rng.pick([100_00, 500_00, 1000_00])
  return Math.ceil(amountP / step) * step
}

/** Pay an invoice at the counter: one tender (or card and cash for some), R7 or R9. */
export function payAtCounter(
  w: World,
  studio: Studio,
  invoice: SalesInvoiceRow,
  at: Ms,
  takenBy: Id
): void {
  const rng = w.rng("tenders")
  const due = invoice.totalP - invoice.advanceAppliedP - invoice.paidP
  if (due <= 0) return
  const date = dhakaDate(at)
  if (due > 20_000_00 && rng.bool(0.3)) {
    const card = Math.round((due * rng.int(50, 80)) / 100 / 100_00) * 100_00
    writeCounterReceipt(w, {
      studio,
      partyId: invoice.partyId,
      date,
      at,
      method: "card",
      amountP: card,
      invoice,
      takenBy,
      rule: "R7",
    })
    const rest = due - card
    writeCounterReceipt(w, {
      studio,
      partyId: invoice.partyId,
      date,
      at: at + MINUTE,
      method: "cash",
      amountP: rest,
      invoice,
      takenBy,
      rule: "R7",
      tenderedP: tendered(rest, rng),
    })
    return
  }
  const method = drawTender(rng)
  writeCounterReceipt(w, {
    studio,
    partyId: invoice.partyId,
    date,
    at,
    method,
    amountP: due,
    invoice,
    takenBy,
    rule: method === "cash" || method === "card" ? "R7" : "R9",
    tenderedP: method === "cash" ? tendered(due, rng) : undefined,
  })
}

export { CBA }
