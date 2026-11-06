import { defaultTaxSettings } from "@/config/rules.config"
import type { ISODate, VendorBillRow } from "@/core/db/schema"
import { linesForVendorPayment } from "@/core/ledger/rules"
import { withholdingFor } from "@/core/tax/withholding"

import { VENDOR_BY_ID } from "../content/parties"
import { CBA, LOC, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { dhakaAt, isoAddDays, MINUTE } from "../time"
import type { PayHint } from "./expenses"

/**
 * Vendor payments (seed_data.md §6, §7.1, §7.4; R15): every posted bill is
 * paid on its terms by Mahbub (bank transfer, rent by cheque), approved by
 * Farzana (Rashed above her ৳5,00,000), with AIT and VDS withheld for the
 * vendor's tax category; opening bills in the first month, summary bills the
 * next month. Bills not yet due stay open (the E6 bill always does).
 */

export function seedPayments(w: World, input: { opening: VendorBillRow[]; summary: VendorBillRow[]; goods: VendorBillRow[]; hints: PayHint[] }): void {
  const rng = w.rng("payments")
  const { F, now } = w.cal
  const plan: { bill: VendorBillRow; on: ISODate; method: "bank-transfer" | "cheque" }[] = []
  for (const bill of input.opening) plan.push({ bill, on: isoAddDays(F, rng.int(3, 25)), method: "bank-transfer" })
  for (const bill of input.summary) plan.push({ bill, on: isoAddDays(bill.dueDate, -rng.int(0, 4)), method: "bank-transfer" })
  for (const bill of input.goods) {
    if (bill.status !== "posted") continue
    const earliest = isoAddDays(bill.date, 3)
    const due = isoAddDays(bill.dueDate, -rng.int(0, 4))
    plan.push({ bill, on: due < earliest ? earliest : due, method: "bank-transfer" })
  }
  for (const h of input.hints) if (!h.never) plan.push({ bill: h.bill, on: h.payOn, method: h.method })
  plan.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.bill.id < b.bill.id ? -1 : 1))

  let chequeNo = 7_300_000
  for (const p of plan) {
    const at = dhakaAt(p.on, "13:00")
    if (at > now) continue
    const bill = p.bill
    const vendor = VENDOR_BY_ID.get(bill.partyId)!
    const gross = bill.totalP - bill.paidP - bill.debitedP
    if (gross <= 0) continue
    const wh = withholdingFor(vendor.category, [{ allocatedP: gross, billNetP: bill.subtotalP, billVatP: bill.inputVatP, billTotalP: bill.totalP }], defaultTaxSettings)
    const approver = gross <= w.limitOf(USR.farzana, "payment") ? USR.farzana : USR.rashed
    const id = w.ctx.seq("vp")
    const payment = w.ctx.bag.put("vendorPayments", id, at - 90 * MINUTE, {
      paymentNo: "",
      partyId: bill.partyId,
      date: p.on,
      method: p.method,
      cashBankAccountId: CBA.BRAC,
      grossP: gross,
      aitP: wh.aitP,
      vdsP: wh.vdsP,
      netPaidP: wh.netPaidP,
      allocations: [{ billId: bill.id, amountP: gross }],
      status: "posted",
      preparedBy: USR.mahbub,
    }, USR.mahbub)
    payment.updatedAt = at
    payment.updatedBy = approver
    w.number("VP", { date: p.on }, at, (no) => {
      payment.paymentNo = no
    })
    if (wh.aitP > 0) w.number("TDS", { date: p.on }, at, (no) => {
      payment.aitCertificateNo = no
    })
    if (wh.vdsP > 0) w.number("VDS", { date: p.on }, at, (no) => {
      payment.vdsCertificateNo = no
    })
    if (p.method === "cheque") {
      chequeNo += rng.int(1, 3)
      const no = String(chequeNo)
      const cleared = dhakaAt(isoAddDays(p.on, 1), "14:00")
      const chq = w.ctx.bag.put("cheques", w.ctx.seq("chq"), at, {
        direction: "issued",
        chequeNo: no,
        bankName: "BRAC Bank",
        cashBankAccountId: CBA.BRAC,
        partyId: bill.partyId,
        amountP: wh.netPaidP,
        chequeDate: p.on,
        isPdc: false,
        status: cleared <= now ? "cleared" : "issued",
        paymentId: id,
        history: cleared <= now
          ? [{ status: "issued", at, by: USR.mahbub }, { status: "presented", at: cleared - 120 * MINUTE, by: USR.mahbub }, { status: "cleared", at: cleared, by: USR.mahbub }]
          : [{ status: "issued", at, by: USR.mahbub }],
      }, USR.mahbub)
      payment.chequeId = chq.id
      payment.chequeNo = no
    }
    payment.approvalId = w.approval({
      kind: "payment",
      docType: "vendorPayments",
      docId: id,
      docNo: () => payment.paymentNo,
      locationId: LOC.HQ,
      amountP: gross,
      requestedBy: USR.mahbub,
      requestedAt: at - 90 * MINUTE,
      status: "approved",
      decidedBy: approver,
      decidedAt: at,
    }).id
    const journal = w.ledger.post({
      rule: "R15",
      date: p.on,
      at,
      lines: linesForVendorPayment({ partyId: bill.partyId, cashTag: "BANK_MAIN", grossP: gross, aitP: wh.aitP, vdsP: wh.vdsP, locationId: LOC.HQ }),
      narration: () => `Vendor payment ${payment.paymentNo}, ${vendor.nameEn}`,
      source: { app: "ap", docType: "vendorPayments", docId: id, docNo: () => payment.paymentNo },
      preparedBy: USR.mahbub,
      postedBy: approver,
      approvalId: payment.approvalId,
    })
    payment.journalId = journal.id
    bill.paidP += gross
    bill.status = "paid"
    bill.updatedAt = Math.max(bill.updatedAt, at)
  }
}
