import { requireApproval, type InlineApproval } from "@/core/approvals/approvals"
import { invoiceOpen, invoiceStatus } from "@/core/ar/receipt"
import { addDaysISO } from "@/core/clock/dates"
import type {
  CreditNoteLine,
  CreditNoteRow,
  Id,
  PartyRow,
  Poisha,
  RevenueTag,
  SalesInvoiceRow,
  SalesOrderLineRow,
  SalesOrderRow,
  VehicleClass,
} from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import type { Tx } from "@/core/engine/types"
import { acct, postJournal } from "@/core/ledger/post"
import { linesForCreditNote, linesForRetailGoodsOut, linesForSalesInvoice, RULE_VOUCHER, type ValuedItemLine } from "@/core/ledger/rules"
import { inventoryTagOf, issueStock, onHand, receiveStock } from "@/core/stock/moves"
import { roundQty, standardValue } from "@/core/stock/value"
import { percentOf } from "@/core/tax/vat"
import { loadCatalogue } from "@/modules/pc/catalogue"
import { priceRequests } from "@/modules/pc/pricing"

/**
 * SI posting helpers (plan §6.2): the Mushak 6.3 invoice with R6 and the
 * advance applied in the same voucher, the credit check (INV-10), counter
 * items issued FEFO with R5, and credit notes with R11.
 */

export type InvoiceLineDraft = {
  orderLineId?: Id
  serviceId?: Id
  itemId?: Id
  addOnId?: Id
  vehicleId?: Id
  vehicleClass?: VehicleClass
  descriptionEn: string
  descriptionBn: string
  qty: number
  unitPriceP: Poisha
  discountP: Poisha
  vatRatePct: number
  vatP: Poisha
  netP: Poisha
  revenueTag: RevenueTag
  advisorId?: Id
}

/** Open customer advance of a party: the CUSTOMER_ADVANCE subledger (credit balance). */
export async function partyAdvance(tx: Tx, partyId: Id): Promise<Poisha> {
  const account = await acct(tx, "CUSTOMER_ADVANCE")
  const lines = await tx.list("journalLines", "partyId", partyId)
  return lines.filter((l) => l.accountId === account).reduce((s, l) => s + l.creditP - l.debitP, 0)
}

/** What a party owes on its open invoices (total − advance applied − paid − credited). */
export async function partyExposure(tx: Tx, partyId: Id): Promise<Poisha> {
  const invoices = await tx.list("salesInvoices", "partyId", partyId)
  return invoices.reduce((s, i) => s + invoiceOpen(i), 0)
}

/** Credit check (INV-10): a credit party on hold, or going over its limit with this amount. */
export function creditCheck(party: PartyRow, exposureP: Poisha, addP: Poisha) {
  const afterP = exposureP + addP
  const onHold = party.status !== "active"
  const over = party.creditLimitP > 0 && afterP > party.creditLimitP
  return { onHold, over, afterP, needsOverride: onHold || over }
}

/** Invoice lines of order lines (full quantities not yet invoiced). */
export function linesOfOrder(order: SalesOrderRow, lines: SalesOrderLineRow[]): InvoiceLineDraft[] {
  return lines
    .filter((l) => l.status !== "cancelled" && l.qtyInvoiced < l.qty)
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => ({
      orderLineId: l.id,
      serviceId: l.kind === "service" ? l.refId : undefined,
      addOnId: l.kind === "add-on" ? l.refId : undefined,
      itemId: l.kind === "item" ? l.refId : undefined,
      vehicleId: order.vehicleId,
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
      advisorId: order.advisorId,
    }))
}

/** Retail items sold at the counter without an order, priced on the party's list. */
export async function counterItemLines(tx: Tx, party: PartyRow, items: { itemId: Id; qty: number }[]): Promise<InvoiceLineDraft[]> {
  if (!items.length) return []
  const catalogue = await loadCatalogue(tx)
  for (const i of items) {
    const item = catalogue.items.get(i.itemId)
    if (!item || item.kind !== "retail" || item.status !== "active") tx.reject("SI_NOT_RETAIL_ITEM", { item: item?.sku ?? i.itemId })
  }
  const priced = priceRequests(catalogue, {
    priceListId: party.priceListId,
    date: tx.today(),
    requests: items.map((i) => ({ kind: "item" as const, itemId: i.itemId, qty: i.qty })),
    discountPct: 0,
  })
  return priced.lines.map((l) => ({
    itemId: l.refId,
    descriptionEn: l.descriptionEn,
    descriptionBn: l.descriptionBn,
    qty: l.qty,
    unitPriceP: l.unitPriceP,
    discountP: l.discountP,
    vatRatePct: l.vatRatePct,
    vatP: l.vatP,
    netP: l.netP,
    revenueTag: l.revenueTag,
  }))
}

export type IssueInput = {
  locationId: Id
  party: PartyRow
  kind: SalesInvoiceRow["kind"]
  orders: SalesOrderRow[]
  lines: InvoiceLineDraft[]
  /** Counter items without an order: issued FEFO at the studio (R5) */
  counterItems?: { itemId: Id; qty: number }[]
  inline?: InlineApproval
}

/**
 * Issue a Mushak 6.3 invoice in the current commit: lines, totals, the
 * credit check with its inline override (INV-10), the customer advance
 * applied (R6 in the same voucher), counter goods out (R5), orders invoiced.
 */
export async function issueInvoiceTx(tx: Tx, input: IssueInput): Promise<SalesInvoiceRow> {
  const { party } = input
  if (!input.lines.length) tx.reject("SI_NOTHING_TO_INVOICE")
  const date = tx.today()
  const subtotalP = input.lines.reduce((s, l) => s + Math.round(l.qty * l.unitPriceP), 0)
  const discountP = input.lines.reduce((s, l) => s + l.discountP, 0)
  const vatP = input.lines.reduce((s, l) => s + l.vatP, 0)
  const totalP = subtotalP - discountP + vatP
  const advance = Math.max(0, await partyAdvance(tx, party.id))
  const advanceAppliedP = Math.min(totalP, advance)
  const invoiceNo = await nextDocNo(tx, "INV", { location: input.locationId, date })
  const credit = input.kind === "credit" || input.kind === "consolidated"
  const dueDate = credit ? addDaysISO(date, party.paymentTermsDays) : date

  let invoice = tx.insert("salesInvoices", {
    invoiceNo,
    locationId: input.locationId,
    partyId: party.id,
    orderIds: input.orders.map((o) => o.id),
    date,
    issuedAt: tx.now(),
    dueDate,
    kind: input.kind,
    buyerNameEn: party.nameEn,
    buyerBin: party.bin,
    subtotalP,
    discountP,
    vatP,
    totalP,
    advanceAppliedP,
    paidP: 0,
    reservedP: 0,
    creditedP: 0,
    status: "posted",
    journalId: "",
    printCount: 0,
    issuedBy: tx.actor.userId,
  })

  if (credit) {
    const check = creditCheck(party, await partyExposure(tx, party.id), 0)
    if (check.needsOverride) {
      if (!input.inline) tx.reject("CREDIT_OVERRIDE_REQUIRED", { party: party.nameEn }, { audit: true })
      const outcome = await requireApproval(tx, {
        kind: "credit-override",
        docType: "salesInvoices",
        docId: invoice.id,
        docNo: invoiceNo,
        locationId: input.locationId,
        amountP: totalP,
        reason: input.inline.reason,
        inline: input.inline,
      })
      if (outcome.status !== "approved") tx.reject("CREDIT_OVERRIDE_REQUIRED", { party: party.nameEn })
      invoice = await tx.update("salesInvoices", invoice.id, { creditOverrideApprovalId: outcome.approvalId })
      tx.emit("CreditOverrideApproved", { refs: { partyId: party.id, invoiceId: invoice.id, approvalId: outcome.approvalId }, params: { party: party.nameEn } })
    }
  }

  input.lines.forEach((l, i) =>
    tx.insert("salesInvoiceLines", {
      invoiceId: invoice.id,
      lineNo: i + 1,
      ...l,
      date,
      locationId: input.locationId,
      partyId: party.id,
    })
  )

  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER.R6,
    date,
    source: { app: "si", docType: "salesInvoices", docId: invoice.id, docNo: invoiceNo },
    narration: `Sales invoice ${invoiceNo}`,
    lines: linesForSalesInvoice({
      partyId: party.id,
      locationId: input.locationId,
      lines: input.lines.map((l) => ({ revenueTag: l.revenueTag, grossP: Math.round(l.qty * l.unitPriceP), discountP: l.discountP, vatP: l.vatP })),
      advanceAppliedP,
    }),
    rule: "R6",
  })
  invoice = await tx.update("salesInvoices", invoice.id, { journalId: journal.id, status: invoiceStatus(invoice) })

  // Counter goods without an order leave the studio shelf FEFO (R5).
  if (input.counterItems?.length) {
    const ref = { docType: "salesInvoices", docId: invoice.id, docNo: invoiceNo }
    const valued: { itemId: Id; valueP: number }[] = []
    const moveIds: Id[] = []
    for (const c of input.counterItems) {
      const item = await tx.get("items", c.itemId)
      const out = await issueStock(tx, { itemId: item.id, locationId: input.locationId, qtyBase: roundQty(c.qty * (item.salesFactor ?? 1)), type: "sale-delivery", ref })
      valued.push({ itemId: item.id, valueP: out.valueP })
      moveIds.push(...out.moves.map((m) => m.moveId))
    }
    if (valued.some((v) => v.valueP > 0)) {
      const goods = await postJournal(tx, {
        voucherType: RULE_VOUCHER.R5,
        date,
        source: { app: "si", ...ref },
        narration: `Counter goods sold, ${invoiceNo}`,
        lines: linesForRetailGoodsOut({ locationId: input.locationId, lines: valued.filter((v) => v.valueP > 0) }),
        rule: "R5",
      })
      for (const id of moveIds) await tx.update("stockMoves", id, { journalId: goods.id })
    }
  }

  // Orders and their lines are invoiced.
  const now = tx.now()
  for (const order of input.orders) {
    for (const line of await tx.list("salesOrderLines", "orderId", order.id)) {
      if (line.status !== "cancelled") await tx.update("salesOrderLines", line.id, { qtyInvoiced: line.qty })
    }
    await tx.update("salesOrders", order.id, { status: "invoiced", invoicedAt: now })
  }

  const kindEvent = input.kind === "consolidated" ? "ConsolidatedInvoiceIssued" : "InvoiceIssued"
  tx.emit(kindEvent, {
    refs: { invoiceId: invoice.id, partyId: party.id, orderId: input.orders[0]?.id },
    params: { no: invoiceNo, amount: totalP / 100 },
    locationId: input.locationId,
  })
  if (advanceAppliedP > 0) {
    tx.emit("AdvanceApplied", { refs: { invoiceId: invoice.id, partyId: party.id }, params: { no: invoiceNo, amount: advanceAppliedP / 100 }, locationId: input.locationId })
  }
  return invoice
}

/** Close the invoice's orders once it is paid (no pending tender left). */
export async function closeOrdersIfPaid(tx: Tx, invoiceId: Id) {
  const invoice = await tx.get("salesInvoices", invoiceId)
  if (invoice.status !== "paid" || invoice.reservedP > 0) return
  for (const orderId of invoice.orderIds) {
    const order = await tx.find("salesOrders", orderId)
    if (order && order.status === "invoiced") await tx.update("salesOrders", order.id, { status: "closed", closedAt: tx.now() })
  }
}

/* ================================================================== *
 * Credit notes (R11)
 * ================================================================== */

export type CreditRequest = { invoiceLineId: Id; qty?: number }

/** Quantities already credited per invoice line (posted and pending credit notes). */
export async function creditedQty(tx: Tx, invoiceId: Id): Promise<Map<Id, number>> {
  const out = new Map<Id, number>()
  for (const cn of await tx.list("creditNotes", "invoiceId", invoiceId)) {
    if (cn.status === "rejected") continue
    for (const l of cn.lines) out.set(l.invoiceLineId, (out.get(l.invoiceLineId) ?? 0) + (l.qty ?? 0))
  }
  return out
}

/** Credit note lines from the request: full lines exactly, partial quantities pro rata. */
export async function creditLines(tx: Tx, invoice: SalesInvoiceRow, requests: CreditRequest[]): Promise<CreditNoteLine[]> {
  const lines = await tx.list("salesInvoiceLines", "invoiceId", invoice.id)
  const done = await creditedQty(tx, invoice.id)
  const out: CreditNoteLine[] = []
  for (const req of requests) {
    const line = lines.find((l) => l.id === req.invoiceLineId)
    if (!line) tx.reject("SI_CREDIT_LINE")
    const remaining = roundQty(line.qty - (done.get(line.id) ?? 0))
    const qty = req.qty ?? remaining
    if (qty <= 0 || qty > remaining + 1e-9) tx.reject("SI_CREDIT_EXCEEDS", { line: line.descriptionEn, remaining })
    if (qty === line.qty) {
      out.push({ invoiceLineId: line.id, qty, grossP: Math.round(line.qty * line.unitPriceP), discountP: line.discountP, netP: line.netP, vatP: line.vatP })
      continue
    }
    const grossP = Math.round(qty * line.unitPriceP)
    const discountP = Math.round((line.discountP * qty) / line.qty)
    const netP = grossP - discountP
    out.push({ invoiceLineId: line.id, qty, grossP, discountP, netP, vatP: percentOf(netP, line.vatRatePct) })
  }
  return out
}

/**
 * Post a credit note (R11): revenue, discount and VAT reversed per line; Cr
 * AR up to the invoice's open amount (net of reservations), the rest to
 * customer advance; returned goods restocked at the studio's average cost.
 */
export async function postCreditNote(tx: Tx, creditNoteId: Id, opts: { approvalId?: Id; preparedBy?: Id } = {}): Promise<CreditNoteRow> {
  const cn = await tx.get("creditNotes", creditNoteId)
  const invoice = await tx.get("salesInvoices", cn.invoiceId)
  const invLines = await tx.list("salesInvoiceLines", "invoiceId", invoice.id)
  const open = Math.max(0, invoiceOpen(invoice) - invoice.reservedP)
  const toInvoiceP = Math.min(cn.totalP, open)
  const toAdvanceP = cn.totalP - toInvoiceP
  const ref = { docType: "creditNotes", docId: cn.id, docNo: cn.creditNoteNo }

  const restock: ValuedItemLine[] = []
  if (cn.restock) {
    for (const l of cn.lines) {
      const line = invLines.find((x) => x.id === l.invoiceLineId)
      if (!line?.itemId) continue
      const item = await tx.get("items", line.itemId)
      const qtyBase = roundQty((l.qty ?? line.qty) * (item.salesFactor ?? 1))
      const held = await onHand(tx, item.id, cn.locationId)
      const valueP = held.qtyBase > 0 ? Math.round((qtyBase * held.valueP) / held.qtyBase) : standardValue(item, qtyBase)
      await receiveStock(tx, { itemId: item.id, locationId: cn.locationId, qtyBase, valueP, type: "return-customer", ref })
      restock.push({ itemId: item.id, tag: await inventoryTagOf(tx, item), valueP })
    }
  }

  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER.R11,
    date: tx.today(),
    source: { app: "si", ...ref },
    narration: `Credit note ${cn.creditNoteNo} against ${invoice.invoiceNo}`,
    lines: linesForCreditNote({
      partyId: cn.partyId,
      locationId: cn.locationId,
      lines: cn.lines.map((l) => {
        const line = invLines.find((x) => x.id === l.invoiceLineId)!
        return { revenueTag: line.revenueTag, grossP: l.grossP, discountP: l.discountP, vatP: l.vatP }
      }),
      toInvoiceP,
      toAdvanceP,
      restock: restock.filter((r) => r.valueP > 0),
    }),
    rule: "R11",
    preparedBy: opts.preparedBy,
    approvalId: opts.approvalId,
  })
  const next = { ...invoice, creditedP: invoice.creditedP + toInvoiceP }
  await tx.update("salesInvoices", invoice.id, { creditedP: next.creditedP, status: invoiceStatus(next) })
  const posted = await tx.update("creditNotes", cn.id, {
    status: "posted",
    journalId: journal.id,
    toInvoiceP,
    toAdvanceP,
    approvalId: opts.approvalId ?? cn.approvalId,
  })
  tx.emit("CreditNoteIssued", {
    refs: { creditNoteId: cn.id, invoiceId: invoice.id, partyId: cn.partyId },
    params: { no: cn.creditNoteNo, amount: cn.totalP / 100 },
    locationId: cn.locationId,
  })
  return posted
}
