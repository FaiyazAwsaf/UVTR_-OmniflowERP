import { z } from "zod"

import { requireApproval } from "@/core/approvals/approvals"
import { createReceipt, invoiceAvailable, postPendingReceipt, releasePendingReceipt } from "@/core/ar/receipt"
import { dhakaDate } from "@/core/clock/dates"
import type { Id, SalesOrderRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"

import {
  closeOrdersIfPaid,
  counterItemLines,
  creditLines,
  issueInvoiceTx,
  linesOfOrder,
  postCreditNote,
  type InvoiceLineDraft,
} from "./invoice"

/**
 * SI Sale Invoice commands (plan §6.2): invoices from delivered orders,
 * consolidated monthly invoices, counter checkout with mixed tenders, MFS
 * confirmation and timeout, credit notes.
 */

const INLINE = z.object({ approverId: z.string(), pin: z.string(), reason: z.string().min(1) })
const CREDIT_SEGMENTS = new Set(["fleet", "dealer", "corporate"])

/** Delivered orders of one party at one location, ready to invoice. */
async function deliveredOrders(tx: Tx, orderIds: Id[]): Promise<SalesOrderRow[]> {
  const orders: SalesOrderRow[] = []
  for (const id of [...new Set(orderIds)]) {
    const order = await tx.get("salesOrders", id)
    if (order.status !== "delivered") tx.reject("SI_ORDER_NOT_DELIVERED", { no: order.orderNo })
    orders.push(order)
  }
  if (new Set(orders.map((o) => o.partyId)).size > 1) tx.reject("SI_MIXED_PARTIES")
  if (new Set(orders.map((o) => o.locationId)).size > 1) tx.reject("SI_MIXED_LOCATIONS")
  return orders
}

async function orderLines(tx: Tx, orders: SalesOrderRow[]): Promise<InvoiceLineDraft[]> {
  const out: InvoiceLineDraft[] = []
  for (const order of orders) out.push(...linesOfOrder(order, await tx.list("salesOrderLines", "orderId", order.id)))
  return out
}

/**
 * A Mushak 6.3 invoice from delivered orders (R6, advance applied). Credit
 * parties (with terms or a credit segment) get a credit invoice due on their
 * terms and the credit check (INV-10: inline override when on hold or over
 * the limit); others a counter invoice due today.
 */
export const issueInvoice = defineCommand({
  name: "si.issueInvoice",
  permission: "si.invoice.issue",
  input: z.object({ orderIds: z.array(z.string()).min(1), inline: INLINE.optional(), idempotencyKey: z.string().min(8) }),
  async run(tx, input) {
    const orders = await deliveredOrders(tx, input.orderIds)
    const locationId = orders[0].locationId
    tx.requireLocation(locationId)
    const party = await tx.get("parties", orders[0].partyId)
    const credit = party.paymentTermsDays > 0 || CREDIT_SEGMENTS.has(party.segment)
    const invoice = await issueInvoiceTx(tx, {
      locationId,
      party,
      kind: credit ? "credit" : "counter",
      orders,
      lines: await orderLines(tx, orders),
      inline: input.inline,
    })
    await closeOrdersIfPaid(tx, invoice.id)
    return { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo }
  },
})

/**
 * One consolidated invoice for a fleet or dealer covering its delivered,
 * unbilled orders at one studio delivered in a period (lines per vehicle and
 * service).
 */
export const issueConsolidatedInvoice = defineCommand({
  name: "si.issueConsolidatedInvoice",
  permission: "si.invoice.issue",
  input: z.object({
    partyId: z.string(),
    locationId: z.string(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    inline: INLINE.optional(),
    idempotencyKey: z.string().min(8),
  }),
  async run(tx, input) {
    tx.requireLocation(input.locationId)
    const party = await tx.get("parties", input.partyId)
    if (!CREDIT_SEGMENTS.has(party.segment)) tx.reject("SI_NOT_CREDIT_PARTY", { party: party.nameEn })
    const orders = (await tx.list("salesOrders", "partyId", party.id))
      .filter((o) => o.locationId === input.locationId && o.status === "delivered" && o.deliveredAt)
      .filter((o) => {
        const day = dhakaDate(o.deliveredAt!)
        return day >= input.from && day <= input.to
      })
      .sort((a, b) => a.deliveredAt! - b.deliveredAt!)
    if (!orders.length) tx.reject("SI_NOTHING_TO_INVOICE")
    const invoice = await issueInvoiceTx(tx, {
      locationId: input.locationId,
      party,
      kind: "consolidated",
      orders,
      lines: await orderLines(tx, orders),
      inline: input.inline,
    })
    return { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, orderCount: orders.length }
  },
})

const TENDER = z.object({
  method: z.enum(["cash", "card", "bkash", "nagad"]),
  /** Amount applied to the invoice (cash: net of change) */
  amountP: z.number().int().positive(),
  /** Cash handed over (change = tendered − amount) */
  tenderedP: z.number().int().optional(),
  /** Card authorisation code or MFS wallet number (simulated) */
  ref: z.string().optional(),
})

/**
 * Counter checkout (plan §6.2): the invoice for delivered orders and/or
 * retail items sold without an order (party defaults to the walk-in
 * customer; goods out FEFO with R5), the advance applied (R6), then one
 * receipt per tender: cash and card post at once (R7); bKash and Nagad stay
 * pending and reserve their share until confirmed (R9) or timed out. With
 * `invoiceId` it collects the balance of an existing invoice instead.
 */
export const checkout = defineCommand({
  name: "si.checkout",
  permission: "si.counter.checkout",
  input: z.object({
    locationId: z.string().optional(),
    partyId: z.string().optional(),
    orderIds: z.array(z.string()).default([]),
    items: z.array(z.object({ itemId: z.string(), qty: z.number().positive() })).default([]),
    /** Collect the open balance of this invoice instead of issuing one */
    invoiceId: z.string().optional(),
    tenders: z.array(TENDER),
    idempotencyKey: z.string().min(8),
  }),
  async run(tx, input) {
    let invoiceId: Id
    let locationId: Id
    let partyId: Id
    if (input.invoiceId) {
      const existing = await tx.get("salesInvoices", input.invoiceId)
      invoiceId = existing.id
      locationId = existing.locationId
      partyId = existing.partyId
      tx.requireLocation(locationId)
      if (!input.tenders.length) tx.reject("SI_NO_TENDER")
    } else {
      const orders = input.orderIds.length ? await deliveredOrders(tx, input.orderIds) : []
      locationId = orders[0]?.locationId ?? input.locationId ?? tx.actor.locationId ?? ""
      if (!locationId) tx.reject("STL_NO_LOCATION")
      tx.requireLocation(locationId)
      partyId = orders[0]?.partyId ?? input.partyId ?? "pty_walk_in"
      if (orders.length && input.partyId && input.partyId !== partyId) tx.reject("SI_MIXED_PARTIES")
      const party = await tx.get("parties", partyId)
      const items = await counterItemLines(tx, party, input.items)
      const invoice = await issueInvoiceTx(tx, {
        locationId,
        party,
        kind: "counter",
        orders,
        lines: [...(await orderLines(tx, orders)), ...items],
        counterItems: input.items,
      })
      invoiceId = invoice.id
    }
    const invoice = await tx.get("salesInvoices", invoiceId)
    const due = invoiceAvailable(invoice)
    const paying = input.tenders.reduce((s, t) => s + t.amountP, 0)
    if (paying !== due) tx.reject("SI_TENDER_MISMATCH", { dueP: due, payingP: paying })
    for (const t of input.tenders) {
      if (t.method === "cash" && t.tenderedP !== undefined && t.tenderedP < t.amountP) tx.reject("SI_CASH_SHORT")
    }

    const receipts: { receiptId: Id; receiptNo: string; method: string; status: string }[] = []
    let postedP = 0
    for (const [i, t] of input.tenders.entries()) {
      const mfs = t.method === "bkash" || t.method === "nagad"
      const receipt = await createReceipt(tx, {
        partyId,
        locationId,
        method: t.method,
        amountP: t.amountP,
        allocations: [{ invoiceId, amountP: t.amountP }],
        ref: t.ref,
        confirmed: false,
        idempotencyKey: `${input.idempotencyKey}:${i}`,
        tenderedP: t.method === "cash" ? (t.tenderedP ?? t.amountP) : undefined,
        changeP: t.method === "cash" ? (t.tenderedP ?? t.amountP) - t.amountP : undefined,
        rule: "R7",
      })
      receipts.push({ receiptId: receipt.id, receiptNo: receipt.receiptNo, method: t.method, status: receipt.status })
      if (mfs) {
        tx.emit("PaymentPending", {
          refs: { invoiceId, receiptId: receipt.id, partyId },
          params: { method: t.method === "bkash" ? "bKash" : "Nagad", no: invoice.invoiceNo, amount: t.amountP / 100 },
          locationId,
        })
      } else postedP += t.amountP
    }
    if (postedP > 0) {
      tx.emit("CounterPaid", { refs: { invoiceId, partyId }, params: { no: invoice.invoiceNo, amount: postedP / 100 }, locationId })
    }
    await closeOrdersIfPaid(tx, invoiceId)
    const after = await tx.get("salesInvoices", invoiceId)
    return { invoiceId, invoiceNo: after.invoiceNo, status: after.status, receipts }
  },
})

/** The customer approved the bKash/Nagad push: the pending receipt posts R9 (exactly what it reserved). */
export const confirmMfs = defineCommand({
  name: "si.confirmMfs",
  permission: ["si.counter.checkout", "stl.order.create"],
  input: z.object({ receiptId: z.string(), ref: z.string().optional() }),
  async run(tx, input) {
    const pending = await tx.get("receipts", input.receiptId)
    tx.requireLocation(pending.locationId)
    if (pending.method !== "bkash" && pending.method !== "nagad") tx.reject("RECEIPT_NOT_PENDING", { no: pending.receiptNo })
    const receipt = await postPendingReceipt(tx, pending.id, { rule: "R9" })
    let no = receipt.receiptNo
    for (const a of receipt.allocations) {
      await closeOrdersIfPaid(tx, a.invoiceId)
      no = (await tx.get("salesInvoices", a.invoiceId)).invoiceNo
    }
    tx.emit("PaymentConfirmed", {
      refs: { receiptId: receipt.id, invoiceId: receipt.allocations[0]?.invoiceId, partyId: receipt.partyId },
      params: { method: receipt.method === "bkash" ? "bKash" : "Nagad", no, amount: receipt.amountP / 100 },
      locationId: receipt.locationId,
    })
    return { receiptId: receipt.id, receiptNo: receipt.receiptNo }
  },
})

/** si.mfsTimeout: pending bKash/Nagad receipts past the timeout are released; nothing posts. */
export const timeoutMfs = defineCommand({
  name: "si.timeoutMfs",
  permission: "system",
  input: z.object({ receiptIds: z.array(z.string()).min(1) }),
  async run(tx, input) {
    for (const id of input.receiptIds) {
      const receipt = await tx.get("receipts", id)
      if (receipt.status !== "pending") continue
      await releasePendingReceipt(tx, id, "timed-out")
      const invoiceId = receipt.allocations[0]?.invoiceId
      const no = invoiceId ? (await tx.get("salesInvoices", invoiceId)).invoiceNo : receipt.receiptNo
      tx.emit("PaymentTimedOut", {
        refs: { receiptId: id, invoiceId, partyId: receipt.partyId },
        params: { method: receipt.method === "bkash" ? "bKash" : "Nagad", no, amount: receipt.amountP / 100 },
        locationId: receipt.locationId,
      })
    }
    return { count: input.receiptIds.length }
  },
})

/**
 * A Mushak 6.7 credit note against invoice lines (R11). Within the maker's
 * `credit-note` limit it posts at once; above it an approver confirms
 * inline, or it waits pending-approval in the approvers' inbox (the
 * creditNotes handler posts it). Returned goods can be restocked.
 */
export const createCreditNote = defineCommand({
  name: "si.createCreditNote",
  permission: "si.creditnote.create",
  input: z.object({
    invoiceId: z.string(),
    lines: z.array(z.object({ invoiceLineId: z.string(), qty: z.number().positive().optional() })).min(1),
    reason: z.string().trim().min(3),
    restock: z.boolean().default(false),
    inline: INLINE.optional(),
    /** Above the limit without an inline approver: queue it for approval */
    queue: z.boolean().default(false),
    idempotencyKey: z.string().min(8),
  }),
  async run(tx, input) {
    const invoice = await tx.get("salesInvoices", input.invoiceId)
    tx.requireLocation(invoice.locationId)
    if (invoice.kind === "opening") tx.reject("SI_CREDIT_OPENING")
    const lines = await creditLines(tx, invoice, input.lines)
    const totalP = lines.reduce((s, l) => s + l.netP + l.vatP, 0)
    if (totalP <= 0) tx.reject("SI_CREDIT_EMPTY")
    const date = tx.today()
    const creditNoteNo = await nextDocNo(tx, "CRN", { date })
    const cn = tx.insert("creditNotes", {
      creditNoteNo,
      invoiceId: invoice.id,
      partyId: invoice.partyId,
      locationId: invoice.locationId,
      date,
      reason: input.reason,
      lines,
      totalP,
      restock: input.restock,
      status: "pending-approval",
    })
    const overLimit = totalP > tx.limit("credit-note")
    if (overLimit && !input.inline && !input.queue) tx.reject("APPROVAL_LIMIT", { kind: "credit-note", amount: totalP })
    const outcome = await requireApproval(tx, {
      kind: "credit-note",
      docType: "creditNotes",
      docId: cn.id,
      docNo: creditNoteNo,
      locationId: invoice.locationId,
      amountP: totalP,
      reason: input.reason,
      inline: input.inline,
    })
    tx.auditContext({ reason: input.reason })
    if (outcome.status === "pending") {
      await tx.update("creditNotes", cn.id, { approvalId: outcome.approvalId })
      return { creditNoteId: cn.id, creditNoteNo, status: "pending-approval" as const }
    }
    const approvalId = outcome.status === "approved" ? outcome.approvalId : undefined
    if (approvalId) await tx.update("creditNotes", cn.id, { approvalId })
    await postCreditNote(tx, cn.id, { approvalId })
    return { creditNoteId: cn.id, creditNoteNo, status: "posted" as const }
  },
})
