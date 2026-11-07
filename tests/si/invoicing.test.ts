import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { decideApproval } from "@/core/approvals/decide"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import type { OmniflowDb } from "@/core/db/database"
import {
  BAY,
  ITM,
  LOC,
  PLANT,
  PTY,
  SVC,
  USR,
  VEH,
} from "@/core/seed/content/seed-refs"
import { recordReceipt } from "@/modules/ar/commands"
import {
  checkout,
  confirmMfs,
  createCreditNote,
  issueConsolidatedInvoice,
  issueInvoice,
  timeoutMfs,
} from "@/modules/si/commands"
import { siJobs } from "@/modules/si/jobs"

import { orderThrough } from "../stl/flow"
import {
  actors,
  balance,
  booksTie,
  inventoryTies,
  journalsOf,
  key,
  refusal,
  run,
  seededDb,
  todayAt,
} from "../stl/helpers"

/**
 * SI on the small seed: counter checkout with the deposit applied and card
 * plus cash (R6, R7), walk-in goods with bKash pending then confirmed (R9)
 * or timed out, the consolidated fleet invoice over its limit (INV-10, E2),
 * and credit notes inline and queued (R11, E12).
 */

let db: OmniflowDb
let as: ReturnType<typeof actors>
beforeAll(async () => {
  db = await seededDb("si")
  as = actors(db)
}, 120_000)
afterAll(async () => {
  await db.delete()
})

describe("counter checkout (J4)", () => {
  it("applies the order's deposit, then takes card and cash (R6 with advance, R7)", async () => {
    const orderId = await orderThrough(db, as, {
      partyId: PTY.shahedKabir,
      vehicleId: VEH.corollaCross7731,
      requests: [
        { kind: "service", serviceId: SVC.WSH_PRM },
        { kind: "service", serviceId: SVC.INT_DEEP },
      ],
      bayId: BAY.GUL_C1,
      start: todayAt("11:00"),
      technician: "rakib",
      technicianId: USR.rakib,
      deposit: { method: "bkash", amountP: 2_000_00 },
      until: "delivered",
    })
    const order = (await db.salesOrders.get(orderId))!
    const tania = await as("tania")
    const due = order.totalP - 2_000_00
    expect(
      await refusal(db, await as("rakib"), checkout, {
        orderIds: [orderId],
        tenders: [{ method: "card", amountP: due }],
        idempotencyKey: key("x"),
      })
    ).toBe("denied")
    expect(
      await refusal(db, tania, checkout, {
        orderIds: [orderId],
        tenders: [{ method: "card", amountP: due - 100 }],
        idempotencyKey: key("short"),
      })
    ).toBe("SI_TENDER_MISMATCH")
    const card = 5_000_00
    const out = await run(db, tania, checkout, {
      orderIds: [orderId],
      tenders: [
        { method: "card", amountP: card, ref: "A1B2C3" },
        {
          method: "cash",
          amountP: due - card,
          tenderedP: Math.ceil((due - card) / 500_00) * 500_00,
        },
      ],
      idempotencyKey: key("checkout"),
    })
    expect(out.status).toBe("paid")
    const invoice = (await db.salesInvoices.get(out.invoiceId))!
    expect(invoice.invoiceNo).toMatch(/^INV-GUL-\d{4}-\d{6}$/)
    expect(invoice).toMatchObject({
      kind: "counter",
      advanceAppliedP: 2_000_00,
      paidP: due,
      totalP: order.totalP,
    })
    expect((await db.salesOrders.get(orderId))?.status).toBe("closed")
    const [sv] = await journalsOf(db, invoice.id)
    expect(sv).toMatchObject({ rule: "R6", voucherType: "SV" })
    const receipts = out.receipts
    expect(receipts.map((r) => r.status)).toEqual(["posted", "posted"])
    for (const r of receipts)
      expect((await journalsOf(db, r.receiptId))[0]?.rule).toBe("R7")
    const cash = await db.receipts.get(receipts[1].receiptId)
    expect(cash?.changeP).toBeGreaterThanOrEqual(0)
  })

  it("sells retail goods to the walk-in customer: R5 out, bKash pending until confirmed (R9)", async () => {
    const tania = await as("tania")
    const before = await db.stockValues.get(`sv:${ITM.rtTyreShine}:${LOC.GUL}`)
    const out = await run(db, tania, checkout, {
      items: [{ itemId: ITM.rtTyreShine, qty: 2 }],
      tenders: [
        { method: "bkash", amountP: 2 * 850_00 + 255_00, ref: "01711000111" },
      ],
      idempotencyKey: key("walkin"),
    })
    const invoice = (await db.salesInvoices.get(out.invoiceId))!
    expect(invoice.partyId).toBe(PTY.walkIn)
    expect(invoice.totalP).toBe(1_955_00)
    expect(invoice.status).toBe("posted")
    expect(invoice.reservedP).toBe(1_955_00)
    const after = await db.stockValues.get(`sv:${ITM.rtTyreShine}:${LOC.GUL}`)
    expect(before!.qtyBase - after!.qtyBase).toBe(2)
    expect(
      (await journalsOf(db, invoice.id)).map((j) => j.rule).sort()
    ).toEqual(["R5", "R6"])
    const receipt = (await db.receipts.get(out.receipts[0].receiptId))!
    expect(receipt.status).toBe("pending")
    expect(await journalsOf(db, receipt.id)).toEqual([])
    await run(db, tania, confirmMfs, { receiptId: receipt.id })
    expect((await db.receipts.get(receipt.id))?.status).toBe("posted")
    expect((await journalsOf(db, receipt.id))[0]?.rule).toBe("R9")
    const paid = await db.salesInvoices.get(invoice.id)
    expect(paid).toMatchObject({
      status: "paid",
      reservedP: 0,
      paidP: 1_955_00,
    })
    const tie = await inventoryTies(db, LOC.GUL)
    expect(tie.gl).toBe(tie.stock)
  })

  it("times out a pending Nagad payment: nothing posts and the reservation is released", async () => {
    const tania = await as("tania")
    const out = await run(db, tania, checkout, {
      items: [{ itemId: ITM.rtWipes, qty: 1 }],
      tenders: [{ method: "nagad", amountP: 402_50 }],
      idempotencyKey: key("nagad"),
    })
    const receiptId = out.receipts[0].receiptId
    // The sweeper job only picks receipts older than the timeout.
    let commits = 0
    const ctx = (at: number) => ({
      db,
      now: at,
      commitSystem: (async () => {
        commits += 1
        return undefined
      }) as never,
    })
    await siJobs[0].run(ctx(now()))
    expect(commits).toBe(0)
    await siJobs[0].run(ctx(now() + 16 * 60_000))
    expect(commits).toBe(1)
    const { commit } = await import("@/core/engine/commit")
    const { SYSTEM_ACTOR } = await import("@/core/engine/types")
    await commit(
      timeoutMfs,
      { receiptIds: [receiptId] },
      { db, actor: SYSTEM_ACTOR }
    )
    expect((await db.receipts.get(receiptId))?.status).toBe("timed-out")
    const invoice = await db.salesInvoices.get(out.invoiceId)
    expect(invoice).toMatchObject({ reservedP: 0, paidP: 0, status: "posted" })
    expect(await journalsOf(db, receiptId)).toEqual([])
    // The balance is collected later at the counter.
    await run(db, tania, checkout, {
      invoiceId: out.invoiceId,
      tenders: [{ method: "cash", amountP: 402_50, tenderedP: 500_00 }],
      idempotencyKey: key("collect"),
    })
    expect((await db.salesInvoices.get(out.invoiceId))?.status).toBe("paid")
  })
})

describe("credit invoices and the credit check (E2)", () => {
  it("blocks Swift Ride's consolidated invoice over its limit until an accounts manager overrides inline; paid in full, its orders close", async () => {
    const shahriar = await as("shahriar")
    const today = dhakaDate(now())
    const input = {
      partyId: PTY.swiftRide,
      locationId: LOC.GUL,
      from: addDaysISO(today, -30),
      to: today,
      idempotencyKey: key("e2"),
    }
    expect(await refusal(db, shahriar, issueConsolidatedInvoice, input)).toBe(
      "CREDIT_OVERRIDE_REQUIRED"
    )
    expect(
      await refusal(db, shahriar, issueConsolidatedInvoice, {
        ...input,
        inline: { approverId: USR.arif, pin: "1234", reason: "Fleet renewal" },
      })
    ).toBe("NOT_APPROVER")
    const out = await run(db, shahriar, issueConsolidatedInvoice, {
      ...input,
      inline: { approverId: USR.farzana, pin: "1234", reason: "Fleet renewal" },
    })
    expect(out.orderCount).toBeGreaterThan(0)
    const invoice = (await db.salesInvoices.get(out.invoiceId))!
    expect(invoice.kind).toBe("consolidated")
    expect(invoice.dueDate > invoice.date).toBe(true)
    const approval = await db.approvals.get(invoice.creditOverrideApprovalId!)
    expect(approval).toMatchObject({
      kind: "credit-override",
      status: "approved",
      decidedBy: USR.farzana,
      inline: true,
    })
    const lines = await db.salesInvoiceLines
      .where("invoiceId")
      .equals(invoice.id)
      .toArray()
    expect(lines.every((l) => l.vehicleId)).toBe(true)
    expect(
      (
        await db.salesOrders.where("partyId").equals(PTY.swiftRide).toArray()
      ).filter((o) => o.status === "delivered" && o.locationId === LOC.GUL)
    ).toEqual([])
    expect(
      await refusal(db, await as("tania"), issueInvoice, {
        orderIds: invoice.orderIds,
        idempotencyKey: key("dup"),
      })
    ).toBe("SI_ORDER_NOT_DELIVERED")

    // Its orders stay invoiced until AR receipts pay it in full; then they close (plan §6.1).
    const mahbub = await as("mahbub")
    const halfP = Math.floor(invoice.totalP / 2)
    const pay = (amountP: number, n: number) =>
      run(db, mahbub, recordReceipt, {
        partyId: PTY.swiftRide,
        method: "bank-transfer",
        cashBankAccountId: "cba_brac",
        amountP,
        allocations: [{ invoiceId: invoice.id, amountP }],
        idempotencyKey: key(`e2-pay-${n}`),
      })
    const orderStatuses = async () =>
      new Set(
        (await db.salesOrders.bulkGet(invoice.orderIds)).map((o) => o!.status)
      )
    await pay(halfP, 1)
    expect((await db.salesInvoices.get(invoice.id))!.status).toBe(
      "partially-paid"
    )
    expect(await orderStatuses()).toEqual(new Set(["invoiced"]))
    await pay(invoice.totalP - halfP, 2)
    expect((await db.salesInvoices.get(invoice.id))!.status).toBe("paid")
    expect(await orderStatuses()).toEqual(new Set(["closed"]))
  })
})

describe("credit notes (E12, R11)", () => {
  it("needs approval above the cashier's 0 limit; an inline approval posts it to customer advance", async () => {
    const tania = await as("tania")
    const invoice = (await db.salesInvoices.get(PLANT.e12Invoice))!
    expect(invoice.status).toBe("paid")
    const lines = await db.salesInvoiceLines
      .where("invoiceId")
      .equals(invoice.id)
      .toArray()
    const interior = lines.find((l) => l.serviceId === SVC.INT_DEEP)!
    const req = {
      invoiceId: invoice.id,
      lines: [{ invoiceLineId: interior.id }],
      reason: "Damp smell after the interior clean",
      idempotencyKey: key("cn"),
    }
    expect(await refusal(db, tania, createCreditNote, req)).toBe(
      "APPROVAL_LIMIT"
    )
    const advanceBefore = await balance(db, "CUSTOMER_ADVANCE", {
      partyId: invoice.partyId,
    })
    const vatBefore = await balance(db, "VAT_OUTPUT", { locationId: LOC.GUL })
    const out = await run(db, tania, createCreditNote, {
      ...req,
      inline: {
        approverId: USR.shahriar,
        pin: "1234",
        reason: "Complaint upheld",
      },
    })
    expect(out.status).toBe("posted")
    expect(out.creditNoteNo).toMatch(/^CRN-\d{4}-\d{4}$/)
    const cn = (await db.creditNotes.get(out.creditNoteId))!
    const total = interior.netP + interior.vatP
    expect(cn).toMatchObject({
      totalP: total,
      toInvoiceP: 0,
      toAdvanceP: total,
    })
    expect(
      await balance(db, "CUSTOMER_ADVANCE", { partyId: invoice.partyId })
    ).toBe(advanceBefore - total)
    expect(await balance(db, "VAT_OUTPUT", { locationId: LOC.GUL })).toBe(
      vatBefore + interior.vatP
    )
    expect((await journalsOf(db, cn.id))[0]).toMatchObject({
      rule: "R11",
      voucherType: "SV",
    })
    expect(
      await refusal(db, tania, createCreditNote, {
        ...req,
        idempotencyKey: key("again"),
        inline: { approverId: USR.shahriar, pin: "1234", reason: "Again" },
      })
    ).toBe("SI_CREDIT_EXCEEDS")
  })

  it("queues a credit note for the inbox; approving it posts R11, rejecting posts nothing", async () => {
    const tania = await as("tania")
    const invoice = (await db.salesInvoices.get(PLANT.e12Invoice))!
    const lines = await db.salesInvoiceLines
      .where("invoiceId")
      .equals(invoice.id)
      .toArray()
    const wash = lines.find((l) => l.serviceId === SVC.WSH_PRM)!
    const out = await run(db, tania, createCreditNote, {
      invoiceId: invoice.id,
      lines: [{ invoiceLineId: wash.id }],
      reason: "Goodwill",
      queue: true,
      idempotencyKey: key("queued"),
    })
    expect(out.status).toBe("pending-approval")
    const cn = (await db.creditNotes.get(out.creditNoteId))!
    const approval = (await db.approvals.get(cn.approvalId!))!
    expect(approval.routedTo).toContain(USR.shahriar)
    expect(await journalsOf(db, cn.id)).toEqual([])
    expect(
      await refusal(db, tania, decideApproval, {
        approvalId: approval.id,
        decision: "approve",
        reason: "",
        expectedVersion: approval.version,
      })
    ).toBe("SELF_APPROVAL")
    await run(db, await as("shahriar"), decideApproval, {
      approvalId: approval.id,
      decision: "approve",
      reason: "OK",
      expectedVersion: approval.version,
    })
    const posted = await db.creditNotes.get(cn.id)
    expect(posted?.status).toBe("posted")
    expect((await journalsOf(db, cn.id))[0]?.rule).toBe("R11")
  })

  it("keeps the books tied", async () => {
    const tie = await booksTie(db)
    expect(tie.unbalanced).toEqual([])
    expect(tie.debit).toBe(tie.credit)
  })
})
