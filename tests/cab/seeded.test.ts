import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { defaultTaxSettings } from "@/config/rules.config"
import { decideApproval } from "@/core/approvals/decide"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { PLANT, PTY, VND } from "@/core/seed/content/seed-refs"
import { dhakaAt } from "@/core/seed/time"
import { recordBill, recordPayment } from "@/modules/ap/commands"
import { billableLines } from "@/modules/ap/queries"
import { recordReceipt } from "@/modules/ar/commands"
import { loadAging } from "@/modules/ar/queries"
import { deductionsFor, invoiceAvailableP } from "@/modules/ar/lib"
import { autoMatchStatement, completeReconciliation, importStatement, postBankCharge, updateCheque } from "@/modules/cab/commands"
import { lastMonthRange } from "@/modules/cab/lib"

import { freshDb, signedIn } from "../helpers/foundation"
import { allBalanced, gl, run, T } from "../ar/fin-helpers"

/**
 * WS-FIN against the seeded books (small profile): aging ties to the
 * control accounts, and the receipt side of E2, E5, E6, E7 and E8 work on
 * the planted states.
 */
let db: OmniflowDb
let mahbub: Actor
let farzana: Actor
const today = dhakaDate(now())

beforeAll(async () => {
  db = await freshDb("fin-seeded")
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
  mahbub = await signedIn(db, "mahbub")
  farzana = await signedIn(db, "farzana")
}, 180_000)
afterAll(async () => {
  await db.delete()
})

async function ties() {
  const ar = await loadAging(db, today, "ar")
  const ap = await loadAging(db, today, "ap")
  expect(ar.totals.total).toBe(ar.controlP)
  expect(ar.advancesP).toBe(ar.advanceGlP)
  expect(ap.totals.total).toBe(ap.controlP)
  return { ar, ap }
}

describe("seeded books (small profile)", () => {
  it("AR and AP aging tie to AR_CONTROL and AP_CONTROL; advances tie to CUSTOMER_ADVANCE", async () => {
    const { ar, ap } = await ties()
    expect(ar.totals.total).toBeGreaterThan(0)
    expect(ap.totals.total).toBeGreaterThan(0)
    expect(ar.rows.find((r) => r.partyId === PTY.orbit)?.buckets.d61_90).toBeGreaterThan(0)
  })

  it("E2 receipt side: Swift Ride pays its oldest invoice with VDS and AIT deducted (R8)", async () => {
    const inv = (await db.salesInvoices.get(PLANT.swiftInvoice70))!
    const party = (await db.parties.get(PTY.swiftRide))!
    const allocations = [{ invoiceId: inv.id, amountP: invoiceAvailableP(inv) }]
    const d = deductionsFor(party, allocations, new Map([[inv.id, inv]]), defaultTaxSettings)
    expect(d.vdsP).toBeGreaterThan(0)
    expect(d.aitP).toBeGreaterThan(0)
    const before = await gl(db, "AR_CONTROL", PTY.swiftRide)
    const r = await run(
      db,
      recordReceipt,
      {
        partyId: party.id,
        method: "bank-transfer",
        cashBankAccountId: "cba_brac",
        amountP: allocations[0].amountP - d.vdsP - d.aitP,
        allocations,
        vdsDeductedP: d.vdsP,
        aitDeductedP: d.aitP,
        certificateNo: "6.6/SR/001",
        idempotencyKey: "seeded-e2",
      },
      mahbub
    )
    expect(r.status).toBe("posted")
    expect(await gl(db, "AR_CONTROL", PTY.swiftRide)).toBe(before - allocations[0].amountP)
    expect((await db.salesInvoices.get(inv.id))?.status).toBe("paid")
    await ties()
  })

  it("E8: Metro's post-dated cheque is deposited and bounces; the invoice is outstanding again with a notice", async () => {
    const cheque = (await db.cheques.get(PLANT.e8Cheque))!
    expect(cheque).toMatchObject({ status: "in-hand", chequeDate: today })
    const receipt = (await db.receipts.get(PLANT.e8Receipt))!
    const invoiceId = receipt.allocations[0]?.invoiceId
    const reservedBefore = invoiceId ? (await db.salesInvoices.get(invoiceId))!.reservedP : 0
    await run(db, updateCheque, { chequeId: cheque.id, action: "deposit", expectedVersion: cheque.version }, mahbub)
    const deposited = (await db.cheques.get(cheque.id))!
    await run(db, updateCheque, { chequeId: cheque.id, action: "bounce", expectedVersion: deposited.version, reason: "Insufficient funds" }, mahbub)
    expect((await db.receipts.get(receipt.id))?.status).toBe("bounced")
    if (invoiceId) {
      expect((await db.salesInvoices.get(invoiceId))!.reservedP).toBe(reservedBefore - receipt.allocations[0].amountP)
    }
    expect((await db.sms.toArray()).some((s) => s.templateId === "cheque-bounced" && s.partyId === PTY.metroFleet)).toBe(true)
    await ties()
  })

  it("E5: the bill on hold is released by Farzana and posts R13 with the difference to PPV", async () => {
    const bill = (await db.vendorBills.get(PLANT.heldBill))!
    expect(bill.status).toBe("on-hold")
    const approval = (await db.approvals.get(PLANT.heldBillApproval))!
    const ppvBefore = await gl(db, "PPV")
    await run(db, decideApproval, { approvalId: approval.id, decision: "approve", expectedVersion: approval.version }, farzana)
    const posted = (await db.vendorBills.get(bill.id))!
    expect(posted.status).toBe("posted")
    expect((await db.journals.get(posted.journalId!))?.rule).toBe("R13")
    expect(await gl(db, "PPV")).toBeGreaterThan(ppvBefore)
    await ties()
  })

  it("E5 by hand: a Bengal Detail bill 6% over the PO is routed to Farzana and Rashed", async () => {
    const lines = await billableLines(db, VND.bengalDetail)
    const line = lines.find((l) => l.availableQty > 0)!
    const r = await run(
      db,
      recordBill,
      {
        kind: "goods",
        partyId: VND.bengalDetail,
        vendorRef: "BDS/E5/T1",
        hasMushak63: true,
        goodsLines: [{ grnLineId: line.grnLine.id, qty: line.availableQty, unitPriceP: Math.round(line.grnLine.unitCostP * 1.06) }],
        idempotencyKey: "seeded-e5b",
      },
      mahbub
    )
    expect(r.status).toBe("on-hold")
    const approval = (await db.approvals.get(r.approvalId!))!
    expect(approval.routedTo).toEqual(expect.arrayContaining(["usr_farzana", "usr_rashed"]))
  })

  it("E6: Prime Guard ৳60,000 + VAT ৳9,000 paid by cheque: AIT ৳6,000, VDS ৳9,000, ৳54,000 paid after Farzana approves", async () => {
    const bill = (await db.vendorBills.get(PLANT.e6Bill))!
    expect(bill).toMatchObject({ partyId: VND.primeGuard, totalP: T(69_000), status: "posted" })
    const r = await run(
      db,
      recordPayment,
      { partyId: VND.primeGuard, method: "cheque", cashBankAccountId: "cba_brac", chequeNo: "9911001", allocations: [{ billId: bill.id, amountP: T(69_000) }], idempotencyKey: "seeded-e6" },
      mahbub
    )
    expect(r.status).toBe("pending-approval")
    const payment = (await db.vendorPayments.get(r.paymentId))!
    expect(payment).toMatchObject({ aitP: T(6_000), vdsP: T(9_000), netPaidP: T(54_000) })
    const approval = (await db.approvals.get(payment.approvalId!))!
    await run(db, decideApproval, { approvalId: approval.id, decision: "approve", expectedVersion: approval.version }, farzana)
    const posted = (await db.vendorPayments.get(r.paymentId))!
    expect(posted.status).toBe("posted")
    expect(posted.vdsCertificateNo).toMatch(/^VDS-/)
    await ties()
  })

  it("E7: last month's BRAC statement auto-matches everything but the ৳575 charge, which posts (R23), then completes", async () => {
    const { from, to } = lastMonthRange(today)
    const imp = await run(db, importStatement, { cashBankAccountId: "cba_brac", fromDate: from, toDate: to }, mahbub)
    const auto = await run(db, autoMatchStatement, { statementId: imp.statementId }, mahbub)
    expect(auto.open).toBe(1)
    const st = (await db.bankStatements.get(imp.statementId))!
    const open = st.lines.find((l) => !l.matchedJournalLineIds.length)!
    expect(open.amountP).toBe(-T(575))
    const charge = await run(db, postBankCharge, { statementId: st.id, lineId: open.lineId }, mahbub)
    expect((await db.journals.get(charge.journalId))?.date).toBe(to)
    await run(db, completeReconciliation, { statementId: st.id }, mahbub)
    expect((await db.bankStatements.get(st.id))?.status).toBe("reconciled")
    expect(await allBalanced(db)).toBe(true)
  })
})
