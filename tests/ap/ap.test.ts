import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { decideApproval } from "@/core/approvals/decide"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { PermissionDenied } from "@/core/engine/errors"
import type { Actor } from "@/core/engine/types"
import { recordBill, recordPayment } from "@/modules/ap/commands"
import { goodsLineValues, matchLine, priceDiffPct } from "@/modules/ap/lib"
import { apOpenItems } from "@/modules/ar/queries"

import { signedIn } from "../helpers/foundation"
import { allBalanced, finDb, gl, receiveGoods, run, T } from "../ar/fin-helpers"

let db: OmniflowDb
let mahbub: Actor
let farzana: Actor
beforeEach(async () => {
  db = await finDb("ap")
  mahbub = await signedIn(db, "mahbub")
  farzana = await signedIn(db, "farzana")
})
afterEach(async () => {
  await db.delete()
})

describe("three-way match helpers", () => {
  it("flags quantity off the GRN and price beyond the tolerance", () => {
    expect(priceDiffPct(T(6_500), T(6_890))).toBe(6)
    expect(matchLine({ availableQty: 20, poPriceP: T(6_500), billQty: 20, billPriceP: T(6_600) }, 2)).toEqual([])
    const diffs = matchLine({ availableQty: 20, poPriceP: T(6_500), billQty: 18, billPriceP: T(6_890) }, 2)
    expect(diffs.map((d) => d.field)).toEqual(["qty", "price"])
    expect(goodsLineValues(18, T(6_890), T(6_500), 15)).toEqual({ netP: T(1_24_020), vatP: T(18_603), grniP: T(1_17_000), ppvP: T(7_020) })
  })
})

describe("ap.recordBill", () => {
  it("posts a matched goods bill (R13): GRNI cleared at the PO price, input VAT, AP credited", async () => {
    const { grnLineId } = await receiveGoods(db, { vendorId: "pty_goods", qty: 10, unitCostP: T(6_500) })
    const r = await run(db, recordBill, { kind: "goods", partyId: "pty_goods", vendorRef: "TCS/1101", hasMushak63: true, goodsLines: [{ grnLineId, qty: 10, unitPriceP: T(6_550) }], idempotencyKey: "bl-1" }, mahbub)
    expect(r).toMatchObject({ status: "posted", matchStatus: "matched" })
    const bill = (await db.vendorBills.get(r.billId))!
    expect(bill).toMatchObject({ subtotalP: T(65_500), inputVatP: T(9_825), totalP: T(75_325) })
    expect((await db.journals.get(bill.journalId!))?.rule).toBe("R13")
    expect(await gl(db, "GRNI", "pty_goods")).toBe(0)
    expect(await gl(db, "PPV")).toBe(T(500))
    expect(await gl(db, "AP_CONTROL", "pty_goods")).toBe(-T(75_325))
    expect((await db.grnLines.get(grnLineId))?.qtyBilled).toBe(10)
    await expect(run(db, recordBill, { kind: "goods", partyId: "pty_goods", vendorRef: "TCS/1101", hasMushak63: true, goodsLines: [{ grnLineId, qty: 1, unitPriceP: T(6_500) }], idempotencyKey: "bl-2" }, mahbub)).rejects.toMatchObject({
      code: "DUPLICATE_VENDOR_REF",
    })
    expect(await allBalanced(db)).toBe(true)
  })

  it("holds a bill priced 6% over the PO with a queued purchase approval; the release posts R13 with the difference to PPV (E5)", async () => {
    const { grnLineId } = await receiveGoods(db, { vendorId: "pty_goods", qty: 20, unitCostP: T(6_500) })
    const r = await run(db, recordBill, { kind: "goods", partyId: "pty_goods", vendorRef: "TCS/1102", hasMushak63: true, goodsLines: [{ grnLineId, qty: 20, unitPriceP: T(6_890) }], idempotencyKey: "bl-3" }, mahbub)
    expect(r).toMatchObject({ status: "on-hold", matchStatus: "mismatch" })
    const bill = (await db.vendorBills.get(r.billId))!
    expect(bill.matchDiffs[0]).toMatchObject({ field: "price", diffPct: 6 })
    expect(bill.journalId).toBeUndefined()
    expect(await gl(db, "GRNI", "pty_goods")).toBe(-T(1_30_000))
    const approval = (await db.approvals.get(r.approvalId!))!
    expect(approval).toMatchObject({ kind: "purchase", approveKey: "ap.bill.approve", status: "pending", amountP: bill.totalP })
    expect(approval.routedTo).toContain("usr_farzana")
    // The same GRN quantity can't be billed twice while it is held.
    await expect(run(db, recordBill, { kind: "goods", partyId: "pty_goods", vendorRef: "TCS/1103", hasMushak63: true, goodsLines: [{ grnLineId, qty: 1, unitPriceP: T(6_500) }], idempotencyKey: "bl-4" }, mahbub)).rejects.toMatchObject({ code: "BILL_QTY_EXCEEDS" })
    // Maker never approves; Farzana releases.
    await expect(run(db, decideApproval, { approvalId: approval.id, decision: "approve", expectedVersion: approval.version }, mahbub)).rejects.toMatchObject({ code: "SELF_APPROVAL" })
    await run(db, decideApproval, { approvalId: approval.id, decision: "approve", reason: "Price increase confirmed", expectedVersion: approval.version }, farzana)
    const posted = (await db.vendorBills.get(r.billId))!
    expect(posted.status).toBe("posted")
    const journal = (await db.journals.get(posted.journalId!))!
    expect(journal).toMatchObject({ rule: "R13", approvalId: approval.id, preparedBy: "usr_mahbub", postedBy: "usr_farzana" })
    expect(await gl(db, "GRNI", "pty_goods")).toBe(0)
    expect(await gl(db, "PPV")).toBe(T(7_800))
    expect((await db.events.toArray()).map((e) => e.type)).toEqual(expect.arrayContaining(["BillOnHold", "BillReleased"]))
    expect(await allBalanced(db)).toBe(true)
  })

  it("posts an expense bill (R14) and refuses a nusrat-made bill (no ap.bill.create)", async () => {
    const r = await run(
      db,
      recordBill,
      { kind: "expense", partyId: "pty_guard", vendorRef: "PG/NOV", hasMushak63: true, expenseLines: [{ expenseTag: "SECURITY", description: "Guards, November", netP: T(60_000), vatRatePct: 15, locationId: "loc_hq" }], idempotencyKey: "bl-5" },
      mahbub
    )
    expect(r.status).toBe("posted")
    const bill = (await db.vendorBills.get(r.billId))!
    expect(bill.totalP).toBe(T(69_000))
    expect((await db.journals.get(bill.journalId!))?.rule).toBe("R14")
    const nusrat = await signedIn(db, "nusrat")
    await expect(
      run(db, recordBill, { kind: "expense", partyId: "pty_guard", vendorRef: "PG/DEC", hasMushak63: true, expenseLines: [{ expenseTag: "SECURITY", description: "x x", netP: T(1), vatRatePct: 0 }], idempotencyKey: "bl-6" }, nusrat)
    ).rejects.toBeInstanceOf(PermissionDenied)
  })
})

describe("ap.recordPayment (R15)", () => {
  async function e6Bill() {
    const r = await run(
      db,
      recordBill,
      { kind: "expense", partyId: "pty_guard", vendorRef: `PG/${Math.random().toString(36).slice(2, 7)}`, hasMushak63: true, expenseLines: [{ expenseTag: "SECURITY", description: "Guards", netP: T(60_000), vatRatePct: 15 }], idempotencyKey: `bl-${Math.random()}` },
      mahbub
    )
    return r.billId
  }

  it("withholds AIT 6,000 and VDS 9,000 on 69,000, waits for approval above Mahbub's limit, posts on Farzana's approval with the cheque and certificates (E6)", async () => {
    const billId = await e6Bill()
    const r = await run(db, recordPayment, { partyId: "pty_guard", method: "cheque", cashBankAccountId: "cba_brac", chequeNo: "7300999", allocations: [{ billId, amountP: T(69_000) }], idempotencyKey: "vp-1" }, mahbub)
    expect(r.status).toBe("pending-approval")
    const pending = (await db.vendorPayments.get(r.paymentId))!
    expect(pending).toMatchObject({ grossP: T(69_000), aitP: T(6_000), vdsP: T(9_000), netPaidP: T(54_000) })
    expect(pending.journalId).toBeUndefined()
    // A second payment can't take the amount the pending one reserves.
    await expect(run(db, recordPayment, { partyId: "pty_guard", method: "bank-transfer", cashBankAccountId: "cba_brac", allocations: [{ billId, amountP: T(1_000) }], idempotencyKey: "vp-2" }, mahbub)).rejects.toMatchObject({
      code: "OVER_ALLOCATION",
    })
    const approval = (await db.approvals.get(pending.approvalId!))!
    expect(approval).toMatchObject({ kind: "payment", approveKey: "ap.payment.approve", amountP: T(69_000) })
    await run(db, decideApproval, { approvalId: approval.id, decision: "approve", expectedVersion: approval.version }, farzana)
    const posted = (await db.vendorPayments.get(r.paymentId))!
    expect(posted.status).toBe("posted")
    expect(posted.vdsCertificateNo).toMatch(/^VDS-\d{4}-\d{4}$/)
    expect(posted.aitCertificateNo).toMatch(/^TDS-\d{4}-\d{4}$/)
    expect((await db.journals.get(posted.journalId!))?.rule).toBe("R15")
    expect(await db.cheques.get(posted.chequeId!)).toMatchObject({ direction: "issued", chequeNo: "7300999", amountP: T(54_000), status: "issued" })
    expect(await gl(db, "AIT_PAYABLE")).toBe(-T(6_000))
    expect(await gl(db, "VDS_PAYABLE")).toBe(-T(9_000))
    expect(await gl(db, "AP_CONTROL", "pty_guard")).toBe(0)
    expect(await db.vendorBills.get(billId)).toMatchObject({ paidP: T(69_000), status: "paid" })
    expect(await allBalanced(db)).toBe(true)
  })

  it("posts at once within the preparer's limit, and a rejection posts nothing", async () => {
    const billId = await e6Bill()
    const r = await run(db, recordPayment, { partyId: "pty_guard", method: "bank-transfer", cashBankAccountId: "cba_brac", allocations: [{ billId, amountP: T(23_000) }], idempotencyKey: "vp-3" }, farzana)
    expect(r.status).toBe("posted")
    const second = await run(db, recordPayment, { partyId: "pty_guard", method: "bank-transfer", cashBankAccountId: "cba_brac", allocations: [{ billId, amountP: T(10_000) }], idempotencyKey: "vp-4" }, mahbub)
    const approval = (await db.approvals.get(second.approvalId!))!
    await run(db, decideApproval, { approvalId: approval.id, decision: "reject", reason: "Hold until next week", expectedVersion: approval.version }, farzana)
    expect((await db.vendorPayments.get(second.paymentId))?.status).toBe("rejected")
    const open = await apOpenItems(db, dhakaDate(now()))
    expect(open.find((i) => i.bill.id === billId)?.openP).toBe(T(46_000))
    expect(open.reduce((s, i) => s + i.openP, 0)).toBe(-(await gl(db, "AP_CONTROL")))
  })

  it("is refused without ap.payment.create", async () => {
    const billId = await e6Bill()
    const nusrat = await signedIn(db, "nusrat")
    await expect(run(db, recordPayment, { partyId: "pty_guard", method: "bank-transfer", cashBankAccountId: "cba_brac", allocations: [{ billId, amountP: T(1_000) }], idempotencyKey: "vp-5" }, nusrat)).rejects.toBeInstanceOf(PermissionDenied)
  })
})
