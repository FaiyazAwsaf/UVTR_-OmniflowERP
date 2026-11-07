import { z } from "zod"

import { rules } from "@/config/rules.config"
import { newId } from "@/core/db/ids"
import { getSetting } from "@/core/db/settings"
import type { ExpenseTag, Id, MatchDiff, PayMethod, VendorBillRow, VendorPaymentRow } from "@/core/db/schema"
import { requireApproval } from "@/core/approvals/approvals"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { NewRow, Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForExpenseBill, linesForGoodsBill, linesForVendorPayment, RULE_VOUCHER } from "@/core/ledger/rules"
import { percentOf } from "@/core/tax/vat"
import { withholdingFor } from "@/core/tax/withholding"

import { requireFunds } from "@/modules/ar/ledger"
import { billOpenP, taka } from "@/modules/ar/lib"

import { goodsLineValues, matchLine } from "./lib"

/**
 * AP Accounts Payable commands (plan §6.2): vendor bills with the
 * three-way match (R13, or on hold with a queued `purchase` approval),
 * expense bills (R14), and vendor payments with AIT and VDS withheld
 * (R15; above the preparer's `payment` limit they wait for approval).
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const HQ = "loc_hq"

export const EXPENSE_TAGS: ExpenseTag[] = [
  "RENT",
  "UTILITIES",
  "TELECOM",
  "SECURITY",
  "REPAIRS",
  "PROFESSIONAL",
  "MARKETING",
  "OFFICE",
  "CONVEYANCE",
  "WELFARE",
  "BANK_CHARGES",
  "PREPAID",
  "ACCRUED_EXP",
]

/** Quantity of a GRN line held on other bills that are on hold (awaiting release). */
export async function heldQty(tx: Pick<Tx, "list" | "find">, grnLineId: Id, exceptBillId?: Id): Promise<number> {
  const lines = await tx.list("vendorBillLines", "grnLineId", grnLineId)
  let held = 0
  for (const l of lines) {
    if (l.billId === exceptBillId) continue
    const bill = await tx.find("vendorBills", l.billId)
    if (!bill || bill.status !== "on-hold") continue
    if (bill.holdApprovalId) {
      const approval = await tx.find("approvals", bill.holdApprovalId)
      if (approval && approval.status === "rejected") continue
    }
    held += l.qty
  }
  return held
}

/**
 * Post a bill (R13 goods at the bill price with the difference to PPV, or
 * R14 expense) and mark it posted; goods lines count as billed on their GRN
 * and PO lines. Used by `ap.recordBill` and the hold release (approval).
 */
export async function postBill(tx: Tx, billId: Id, opts: { approvalId?: Id; preparedBy?: Id } = {}): Promise<VendorBillRow> {
  const bill = await tx.get("vendorBills", billId)
  const lines = (await tx.list("vendorBillLines", "billId", bill.id)).sort((a, b) => a.lineNo - b.lineNo)
  const fiscal = await tx.fiscal(bill.date)
  const date = fiscal.period?.status === "open" && fiscal.year?.status !== "closed" ? bill.date : tx.today()
  let journalLines
  let rule: "R13" | "R14"
  if (bill.kind === "goods") {
    rule = "R13"
    const parts: { grniP: number; ppvP: number; vatP: number }[] = []
    for (const l of lines) {
      const grnLine = await tx.get("grnLines", l.grnLineId!)
      const v = goodsLineValues(l.qty, l.unitPriceP, grnLine.unitCostP, l.vatRatePct)
      parts.push({ grniP: v.grniP, ppvP: l.netP - v.grniP, vatP: l.vatP })
      await tx.update("grnLines", grnLine.id, { qtyBilled: grnLine.qtyBilled + l.qty })
      if (l.poLineId) {
        const poLine = await tx.get("poLines", l.poLineId)
        await tx.update("poLines", poLine.id, { qtyBilled: poLine.qtyBilled + l.qty })
      }
    }
    journalLines = linesForGoodsBill({ partyId: bill.partyId, locationId: bill.locationId, lines: parts, hasMushak63: bill.hasMushak63 })
  } else {
    rule = "R14"
    const centres = new Map((await tx.all("costCentres")).map((c) => [c.id, c]))
    journalLines = linesForExpenseBill({
      partyId: bill.partyId,
      locationId: bill.locationId,
      hasMushak63: bill.hasMushak63,
      lines: lines.map((l) => ({
        expenseTag: l.expenseTag ?? "OFFICE",
        netP: l.netP,
        vatP: l.vatP,
        costCentreId: l.costCentreId,
        locationId: (l.costCentreId ? centres.get(l.costCentreId)?.locationId : undefined) ?? bill.locationId,
      })),
    })
  }
  const vendor = await tx.get("parties", bill.partyId)
  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER[rule],
    date,
    source: { app: "ap", docType: "vendorBills", docId: bill.id, docNo: bill.billNo },
    narration: `Vendor bill ${bill.billNo}, ${vendor.nameEn} (${bill.vendorRef})`,
    lines: journalLines,
    rule,
    approvalId: opts.approvalId,
    preparedBy: opts.preparedBy,
  })
  return tx.update("vendorBills", bill.id, { status: "posted", journalId: journal.id })
}

const goodsLine = z.object({ grnLineId: z.string(), qty: z.number().positive(), unitPriceP: z.number().int().positive() })
const expenseLine = z.object({
  expenseTag: z.enum(EXPENSE_TAGS as [ExpenseTag, ...ExpenseTag[]]),
  description: z.string().trim().min(2),
  netP: z.number().int().positive(),
  vatRatePct: z.number().min(0).max(100).default(0),
  locationId: z.string().optional(),
  costCentreId: z.string().optional(),
})

export const recordBillInput = z
  .object({
    kind: z.enum(["goods", "expense"]),
    partyId: z.string(),
    vendorRef: z.string().trim().min(2),
    date: isoDay.optional(),
    dueDate: isoDay.optional(),
    hasMushak63: z.boolean(),
    locationId: z.string().optional(),
    goodsLines: z.array(goodsLine).default([]),
    expenseLines: z.array(expenseLine).default([]),
    reason: z.string().trim().default(""),
    idempotencyKey: z.string().min(4),
  })
  .refine((b) => (b.kind === "goods" ? b.goodsLines.length > 0 : b.expenseLines.length > 0), { message: "lines", path: ["goodsLines"] })

/**
 * `ap.recordBill`: a goods bill from GRNs with the three-way match (matched:
 * posted R13; mismatch: on hold with the diffs and a queued `purchase`
 * approval on the bill total, released with `ap.bill.approve`), or an
 * expense bill posted at once (R14). The vendor's reference is unique per
 * vendor (INV-12).
 */
export const recordBill = defineCommand({
  name: "ap.recordBill",
  permission: "ap.bill.create",
  input: recordBillInput,
  async run(tx, input) {
    const vendor = await tx.get("parties", input.partyId)
    if (!vendor.isVendor) tx.reject("NOT_A_VENDOR", { party: vendor.nameEn })
    const date = input.date ?? tx.today()
    if (date > tx.today()) tx.reject("FUTURE_DATE", { date })
    const dup = await tx.list("vendorBills", "[partyId+vendorRef]", [vendor.id, input.vendorRef])
    if (dup.length) tx.reject("DUPLICATE_VENDOR_REF", { ref: input.vendorRef })
    const billId = newId("bl")
    const billNo = await nextDocNo(tx, "BL", { date })
    const dueDate = input.dueDate ?? addDays(date, vendor.paymentTermsDays || 30)

    type LineRow = Omit<NewRow<"vendorBillLines">, "billId" | "lineNo">
    const lineRows: LineRow[] = []
    const diffs: MatchDiff[] = []
    const grnIds = new Set<string>()
    let poId: string | undefined
    let locationId = input.locationId ?? HQ

    if (input.kind === "goods") {
      const seen = new Set<string>()
      for (const gl of input.goodsLines) {
        if (seen.has(gl.grnLineId)) tx.reject("DUPLICATE_ALLOCATION")
        seen.add(gl.grnLineId)
        const grnLine = await tx.get("grnLines", gl.grnLineId)
        const grn = await tx.get("grns", grnLine.grnId)
        if (grn.vendorId !== vendor.id) tx.reject("GRN_VENDOR_MISMATCH", { grn: grn.grnNo })
        const poLine = await tx.get("poLines", grnLine.poLineId)
        const item = await tx.get("items", grnLine.itemId)
        const available = Math.max(0, grnLine.qtyAccepted - grnLine.qtyReturned - grnLine.qtyBilled - (await heldQty(tx, grnLine.id)))
        if (gl.qty > available + 1e-9) tx.reject("BILL_QTY_EXCEEDS", { item: item.sku, qty: gl.qty, available })
        diffs.push(
          ...matchLine(
            { poLineId: poLine.id, itemId: item.id, availableQty: available, poPriceP: grnLine.unitCostP, billQty: gl.qty, billPriceP: gl.unitPriceP },
            rules.threeWayMatch.priceTolerancePct
          )
        )
        const v = goodsLineValues(gl.qty, gl.unitPriceP, grnLine.unitCostP, poLine.vatRatePct)
        grnIds.add(grn.id)
        poId = poId ?? grn.poId
        locationId = grn.locationId
        lineRows.push({
          poLineId: poLine.id,
          grnLineId: grnLine.id,
          itemId: item.id,
          description: item.nameEn,
          qty: gl.qty,
          unitPriceP: gl.unitPriceP,
          vatRatePct: poLine.vatRatePct,
          vatP: v.vatP,
          netP: v.netP,
        })
      }
    } else {
      for (const el of input.expenseLines) {
        const vatRatePct = el.vatRatePct ?? 0
        const lineLocation = el.locationId ? await tx.find("locations", el.locationId) : undefined
        lineRows.push({
          expenseTag: el.expenseTag,
          description: el.description,
          qty: 1,
          unitPriceP: el.netP,
          vatRatePct,
          vatP: percentOf(el.netP, vatRatePct),
          netP: el.netP,
          costCentreId: el.costCentreId ?? lineLocation?.costCentreId,
        })
      }
    }
    const subtotalP = lineRows.reduce((s, l) => s + l.netP, 0)
    const inputVatP = lineRows.reduce((s, l) => s + l.vatP, 0)
    const mismatch = diffs.length > 0
    tx.insert("vendorBills", {
      id: billId,
      billNo,
      vendorRef: input.vendorRef,
      partyId: vendor.id,
      locationId,
      date,
      dueDate,
      kind: input.kind,
      poId,
      grnIds: [...grnIds],
      hasMushak63: input.hasMushak63,
      subtotalP,
      inputVatP,
      totalP: subtotalP + inputVatP,
      paidP: 0,
      debitedP: 0,
      status: "on-hold",
      matchStatus: input.kind === "goods" ? (mismatch ? "mismatch" : "matched") : "n-a",
      matchDiffs: diffs,
    })
    lineRows.forEach((l, i) => tx.insert("vendorBillLines", { ...l, billId, lineNo: i + 1 }))

    let status: VendorBillRow["status"] = "posted"
    let approvalId: string | undefined
    if (mismatch) {
      const outcome = await requireApproval(tx, {
        kind: "purchase",
        docType: "vendorBills",
        docId: billId,
        docNo: billNo,
        locationId,
        amountP: subtotalP + inputVatP,
        reason: input.reason || diffs.map((d) => (d.field === "price" ? `price ${d.diffPct}%` : `qty ${d.actual}/${d.expected}`)).join(", "),
      })
      if (outcome.status === "pending") {
        status = "on-hold"
        approvalId = outcome.approvalId
        await tx.update("vendorBills", billId, { holdApprovalId: approvalId })
      } else if (outcome.status === "approved") {
        approvalId = outcome.approvalId
        await tx.update("vendorBills", billId, { holdApprovalId: approvalId })
      }
    }
    if (status === "posted") await postBill(tx, billId, { approvalId })
    const total = subtotalP + inputVatP
    tx.emit(status === "posted" ? "BillRecorded" : "BillOnHold", {
      refs: { billId, partyId: vendor.id, ...(approvalId ? { approvalId } : {}), ...(poId ? { poId } : {}) },
      params: { no: billNo, amount: taka(total), vendor: vendor.nameEn },
      locationId,
    })
    return { billId, billNo, status, matchStatus: mismatch ? "mismatch" : input.kind === "goods" ? "matched" : "n-a", approvalId }
  },
})

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The kinds of account a vendor payment method may draw on. */
export function payAccountFits(kind: string, tag: string, method: PayMethod): boolean {
  if (method === "bank-transfer" || method === "cheque") return kind === "bank"
  if (method === "cash") return kind === "cash-till" || kind === "petty-cash"
  return tag === "MFS_BKASH"
}

/** Allocations reserved by other payments still waiting for approval. */
export async function reservedOnBill(tx: Pick<Tx, "list">, partyId: Id, billId: Id, exceptPaymentId?: Id): Promise<number> {
  const pending = (await tx.list("vendorPayments", "partyId", partyId)).filter(
    (p) => p.status === "pending-approval" && p.id !== exceptPaymentId
  )
  return pending.reduce((s, p) => s + p.allocations.filter((a) => a.billId === billId).reduce((x, a) => x + a.amountP, 0), 0)
}

/**
 * Post a vendor payment (R15): withholding as computed, the issued cheque
 * row, VDS (Mushak 6.6) and TDS certificates numbered, bills paid. Used by
 * `ap.recordPayment` within limit and by the payment approval.
 */
export async function postPayment(tx: Tx, paymentId: Id, opts: { approvalId?: Id } = {}): Promise<VendorPaymentRow> {
  const payment = await tx.get("vendorPayments", paymentId)
  if (payment.status !== "pending-approval") tx.reject("PAYMENT_NOT_PENDING", { no: payment.paymentNo })
  const account = await tx.get("cashBankAccounts", payment.cashBankAccountId)
  const vendor = await tx.get("parties", payment.partyId)
  await requireFunds(tx, account, payment.netPaidP)
  const fiscal = await tx.fiscal(payment.date)
  const date = fiscal.period?.status === "open" && fiscal.year?.status !== "closed" ? payment.date : tx.today()
  for (const a of payment.allocations) {
    const bill = await tx.get("vendorBills", a.billId)
    if (a.amountP > billOpenP(bill)) tx.reject("OVER_ALLOCATION", { doc: bill.billNo })
    const paidP = bill.paidP + a.amountP
    const open = bill.totalP - paidP - bill.debitedP
    await tx.update("vendorBills", bill.id, { paidP, status: open <= 0 ? "paid" : "partially-paid" })
  }
  const vdsCertificateNo = payment.vdsP > 0 ? await nextDocNo(tx, "VDS", { date }) : undefined
  const aitCertificateNo = payment.aitP > 0 ? await nextDocNo(tx, "TDS", { date }) : undefined
  let chequeId: string | undefined
  if (payment.method === "cheque") {
    const chequeNo = payment.chequeNo ?? ""
    const dup = (await tx.list("cheques", "[cashBankAccountId+chequeNo]", [account.id, chequeNo])).filter((c) => c.direction === "issued")
    if (dup.length) tx.reject("DUPLICATE_CHEQUE", { no: chequeNo })
    const cheque = tx.insert("cheques", {
      direction: "issued",
      chequeNo,
      bankName: account.bankName ?? account.nameEn,
      cashBankAccountId: account.id,
      partyId: vendor.id,
      amountP: payment.netPaidP,
      chequeDate: date,
      isPdc: false,
      status: "issued",
      paymentId: payment.id,
      history: [{ status: "issued", at: tx.now(), by: tx.actor.userId }],
    })
    chequeId = cheque.id
  }
  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER.R15,
    date,
    source: { app: "ap", docType: "vendorPayments", docId: payment.id, docNo: payment.paymentNo },
    narration: `Vendor payment ${payment.paymentNo}, ${vendor.nameEn}`,
    lines: linesForVendorPayment({
      partyId: vendor.id,
      cashTag: account.accountTag,
      grossP: payment.grossP,
      aitP: payment.aitP,
      vdsP: payment.vdsP,
      locationId: HQ,
    }),
    rule: "R15",
    approvalId: opts.approvalId,
    preparedBy: payment.preparedBy,
  })
  const posted = await tx.update("vendorPayments", payment.id, {
    status: "posted",
    date,
    journalId: journal.id,
    vdsCertificateNo,
    aitCertificateNo,
    chequeId,
    approvalId: opts.approvalId ?? payment.approvalId,
  })
  tx.emit("VendorPaid", {
    refs: { paymentId: payment.id, partyId: vendor.id, journalId: journal.id, ...(chequeId ? { chequeId } : {}) },
    params: { no: payment.paymentNo, amount: taka(payment.netPaidP), vendor: vendor.nameEn },
    locationId: HQ,
  })
  return posted
}

export const recordPaymentInput = z.object({
  partyId: z.string(),
  date: isoDay.optional(),
  method: z.enum(["bank-transfer", "cheque", "cash", "bkash"]),
  cashBankAccountId: z.string(),
  allocations: z.array(z.object({ billId: z.string(), amountP: z.number().int().positive() })).min(1),
  chequeNo: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  reason: z.string().trim().default(""),
  idempotencyKey: z.string().min(4),
})

/**
 * `ap.recordPayment`: AIT and VDS from the vendor's tax category
 * (`withholdingFor`); within the preparer's `payment` limit it posts R15 at
 * once, otherwise it waits for approval (`ap.payment.approve`).
 */
export const recordPayment = defineCommand({
  name: "ap.recordPayment",
  permission: "ap.payment.create",
  input: recordPaymentInput,
  async run(tx, input) {
    const vendor = await tx.get("parties", input.partyId)
    if (!vendor.isVendor) tx.reject("NOT_A_VENDOR", { party: vendor.nameEn })
    const date = input.date ?? tx.today()
    if (date > tx.today()) tx.reject("FUTURE_DATE", { date })
    const account = await tx.get("cashBankAccounts", input.cashBankAccountId)
    if (!payAccountFits(account.kind, account.accountTag, input.method)) tx.reject("ACCOUNT_METHOD_MISMATCH", { account: account.nameEn })
    if (input.method === "cheque" && !input.chequeNo) tx.reject("CHEQUE_DETAILS_REQUIRED")
    if (input.method === "cheque") {
      const dup = (await tx.list("cheques", "[cashBankAccountId+chequeNo]", [account.id, input.chequeNo!])).filter((c) => c.direction === "issued")
      if (dup.length) tx.reject("DUPLICATE_CHEQUE", { no: input.chequeNo! })
    }
    const tax = await getSetting(tx, "tax")
    const shares = []
    const seen = new Set<string>()
    for (const a of input.allocations) {
      if (seen.has(a.billId)) tx.reject("DUPLICATE_ALLOCATION")
      seen.add(a.billId)
      const bill = await tx.get("vendorBills", a.billId)
      if (bill.partyId !== vendor.id) tx.reject("OVER_ALLOCATION", { doc: bill.billNo })
      if (bill.status === "on-hold") tx.reject("BILL_ON_HOLD", { no: bill.billNo })
      const available = billOpenP(bill) - (await reservedOnBill(tx, vendor.id, bill.id))
      if (a.amountP > available) tx.reject("OVER_ALLOCATION", { doc: bill.billNo })
      shares.push({ allocatedP: a.amountP, billNetP: bill.subtotalP, billVatP: bill.inputVatP, billTotalP: bill.totalP })
    }
    const wh = withholdingFor(vendor.vendorTaxCategory, shares, tax)
    const grossP = input.allocations.reduce((s, a) => s + a.amountP, 0)
    const paymentNo = await nextDocNo(tx, "VP", { date })
    const payment = tx.insert("vendorPayments", {
      paymentNo,
      partyId: vendor.id,
      date,
      method: input.method,
      cashBankAccountId: account.id,
      grossP,
      aitP: wh.aitP,
      vdsP: wh.vdsP,
      netPaidP: wh.netPaidP,
      allocations: input.allocations,
      chequeNo: input.chequeNo,
      status: "pending-approval",
      preparedBy: tx.actor.userId,
    })
    const outcome = await requireApproval(tx, {
      kind: "payment",
      docType: "vendorPayments",
      docId: payment.id,
      docNo: paymentNo,
      locationId: HQ,
      amountP: grossP,
      reason: input.reason || `${vendor.nameEn}: ${input.allocations.length} bill(s)`,
    })
    if (outcome.status === "pending") {
      await tx.update("vendorPayments", payment.id, { approvalId: outcome.approvalId })
      tx.emit("PaymentSubmitted", {
        refs: { paymentId: payment.id, partyId: vendor.id, approvalId: outcome.approvalId },
        params: { no: paymentNo, amount: taka(grossP), vendor: vendor.nameEn },
        locationId: HQ,
      })
      return { paymentId: payment.id, paymentNo, status: "pending-approval" as const, approvalId: outcome.approvalId }
    }
    const approvalId = outcome.status === "approved" ? outcome.approvalId : undefined
    await postPayment(tx, payment.id, { approvalId })
    return { paymentId: payment.id, paymentNo, status: "posted" as const, approvalId }
  },
})
