import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { createReceipt, postPendingReceipt, releasePendingReceipt } from "@/core/ar/receipt"
import type { OmniflowDb } from "@/core/db/database"
import { formatDocNo, nextDocNo } from "@/core/docs/numbering"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForSalesInvoice } from "@/core/ledger/rules"
import { balanceOf } from "@/core/ledger/statements"

import { foundationDb } from "../helpers/foundation"
import { asSystem, partyData } from "../helpers/fixtures"

let db: OmniflowDb
beforeEach(async () => {
  db = await foundationDb("receipts")
  await asSystem(db, async (tx) => {
    tx.insert("parties", { id: "pty_c", ...partyData("C-000001") })
  })
})
afterEach(async () => {
  await db.delete()
})

/** A posted invoice of ৳11,500 (10,000 + VAT 1,500) at Gulshan, through R6. */
async function invoice(tx: Tx) {
  const date = tx.today()
  const invoiceNo = await nextDocNo(tx, "INV", { location: "loc_gul" })
  const inv = tx.insert("salesInvoices", {
    invoiceNo,
    locationId: "loc_gul",
    partyId: "pty_c",
    orderIds: [],
    date,
    issuedAt: tx.now(),
    dueDate: date,
    kind: "counter",
    buyerNameEn: "Party",
    subtotalP: 10_000_00,
    discountP: 0,
    vatP: 1_500_00,
    totalP: 11_500_00,
    advanceAppliedP: 0,
    paidP: 0,
    reservedP: 0,
    creditedP: 0,
    status: "posted",
    journalId: "pending",
    printCount: 0,
    issuedBy: tx.actor.userId,
  })
  const journal = await postJournal(tx, {
    voucherType: "SV",
    date,
    source: { app: "si", docType: "salesInvoices", docId: inv.id, docNo: invoiceNo },
    narration: invoiceNo,
    lines: linesForSalesInvoice({
      partyId: "pty_c",
      locationId: "loc_gul",
      lines: [{ revenueTag: "REV_WASH", grossP: 10_000_00, discountP: 0, vatP: 1_500_00 }],
      advanceAppliedP: 0,
    }),
    rule: "R6",
  })
  await tx.update("salesInvoices", inv.id, { journalId: journal.id })
  return inv.id
}

const arBalance = async () => {
  const ar = await db.journalLines.where("accountId").equals("acc_1150").toArray()
  return balanceOf(ar)
}

describe("numbering (accounting_rules.md §5)", () => {
  it("formats every document type", () => {
    expect(formatDocNo("INV", 2981, { location: "loc_gul", date: "2026-11-07" })).toBe("INV-GUL-2627-002981")
    expect(formatDocNo("PO", 42, { date: "2026-11-07" })).toBe("PO-2627-0042")
    expect(formatDocNo("JV", 417, { date: "2027-06-30" })).toBe("JV-2627-000417")
    expect(formatDocNo("JV", 1, { date: "2027-07-01" })).toBe("JV-2728-000001")
    expect(formatDocNo("CNT", 4, { location: "GUL", date: "2026-11-07" })).toBe("CNT-GUL-2627-004")
    expect(formatDocNo("C", 231, {})).toBe("C-000231")
    expect(formatDocNo("MR", 1207, { location: "loc_utt", date: "2026-08-01" })).toBe("MR-UTT-2627-001207")
  })
})

describe("createReceipt (plan P1.8)", () => {
  it("posts cash at once and settles the invoice", async () => {
    const invId = await asSystem(db, invoice)
    const receipt = await asSystem(db, (tx) =>
      createReceipt(tx, {
        partyId: "pty_c",
        locationId: "loc_gul",
        method: "cash",
        amountP: 11_500_00,
        allocations: [{ invoiceId: invId, amountP: 11_500_00 }],
        idempotencyKey: "k1",
        rule: "R7",
      })
    )
    expect(receipt.receiptNo).toMatch(/^MR-GUL-\d{4}-000001$/)
    expect(receipt.status).toBe("posted")
    expect(await db.salesInvoices.get(invId)).toMatchObject({ paidP: 11_500_00, status: "paid" })
    expect(await arBalance()).toBe(0)
  })

  it("keeps bKash pending and reserved until confirmed (R9), or releases it on timeout", async () => {
    const invId = await asSystem(db, invoice)
    const pending = await asSystem(db, (tx) =>
      createReceipt(tx, {
        partyId: "pty_c",
        locationId: "loc_gul",
        method: "bkash",
        amountP: 6_000_00,
        allocations: [{ invoiceId: invId, amountP: 6_000_00 }],
        idempotencyKey: "k2",
      })
    )
    expect(pending.status).toBe("pending")
    expect(await db.salesInvoices.get(invId)).toMatchObject({ reservedP: 6_000_00, paidP: 0, status: "posted" })
    await expect(
      asSystem(db, (tx) =>
        createReceipt(tx, {
          partyId: "pty_c",
          locationId: "loc_gul",
          method: "cash",
          amountP: 6_000_00,
          allocations: [{ invoiceId: invId, amountP: 6_000_00 }],
          idempotencyKey: "k3",
        })
      )
    ).rejects.toMatchObject({ code: "OVER_ALLOCATION" })
    await asSystem(db, (tx) => postPendingReceipt(tx, pending.id, { rule: "R9" }))
    expect(await db.salesInvoices.get(invId)).toMatchObject({ reservedP: 0, paidP: 6_000_00, status: "partially-paid" })
    expect(await arBalance()).toBe(5_500_00)

    const second = await asSystem(db, (tx) =>
      createReceipt(tx, {
        partyId: "pty_c",
        locationId: "loc_gul",
        method: "nagad",
        amountP: 5_500_00,
        allocations: [{ invoiceId: invId, amountP: 5_500_00 }],
        idempotencyKey: "k4",
      })
    )
    await asSystem(db, (tx) => releasePendingReceipt(tx, second.id, "timed-out"))
    expect(await db.salesInvoices.get(invId)).toMatchObject({ reservedP: 0, paidP: 6_000_00 })
  })

  it("holds a post-dated cheque in hand and posts on clearing (R10)", async () => {
    const invId = await asSystem(db, invoice)
    const today = dhakaDate(now())
    const receipt = await asSystem(db, (tx) =>
      createReceipt(tx, {
        partyId: "pty_c",
        locationId: "loc_hq",
        method: "cheque",
        amountP: 11_500_00,
        allocations: [{ invoiceId: invId, amountP: 11_500_00 }],
        cheque: { chequeNo: "445566", bankName: "City Bank", chequeDate: "2999-01-01" },
        idempotencyKey: "k5",
      })
    )
    const cheque = await db.cheques.get(receipt.chequeId!)
    expect(cheque).toMatchObject({ status: "in-hand", isPdc: true, direction: "received" })
    await asSystem(db, (tx) => postPendingReceipt(tx, receipt.id, { rule: "R10", date: today }))
    expect(await db.salesInvoices.get(invId)).toMatchObject({ paidP: 11_500_00, status: "paid" })
    expect(await arBalance()).toBe(0)
  })

  it("holds an unallocated deposit as a customer advance (R3)", async () => {
    const receipt = await asSystem(db, (tx) =>
      createReceipt(tx, {
        partyId: "pty_c",
        locationId: "loc_gul",
        method: "bkash",
        confirmed: true,
        amountP: 10_000_00,
        allocations: [],
        orderId: "so_x",
        idempotencyKey: "k6",
      })
    )
    expect(receipt).toMatchObject({ status: "posted", advanceP: 10_000_00 })
    const adv = await db.journalLines.where("accountId").equals("acc_2130").toArray()
    expect(balanceOf(adv)).toBe(-10_000_00)
  })
})
