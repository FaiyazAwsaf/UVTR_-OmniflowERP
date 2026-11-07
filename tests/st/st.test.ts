import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysISO } from "@/core/clock/dates"
import { stockValueId } from "@/core/db/tables"
import { ITM, LOC, PLANT } from "@/core/seed/content/seed-refs"
import { cancelTransfer, dispatchTransfer, receiveTransfer, recordIssue, requestTransfer, saveAdjustment } from "@/modules/st/commands"

import { asSystem } from "../helpers/fixtures"
import { decide, expectBalanced, expectStockTies, refused, run, scmDb, type ScmDb } from "../ic/scm"

/**
 * ST (plan §6.2, accounting_rules R20, R21, R22): E3 by hand (Uttara holds
 * 20 ml of ceramic 2-year; Arif requests from Central, Habib dispatches with
 * the 6.5 challan, Arif receives), a shortfall to inventory loss, scopes,
 * adjustments within limit and through approval, internal use, expired
 * batch write-off.
 */

let s: ScmDb
beforeAll(async () => {
  s = await scmDb("st")
}, 120_000)
afterAll(async () => {
  await s.db.delete()
})

const value = async (itemId: string, locationId: string) => (await s.db.stockValues.get(stockValueId(itemId, locationId))) ?? { qtyBase: 0, valueP: 0 }

describe("transfers (E3)", () => {
  let transferId: string

  it("Uttara starts with 20 ml of ceramic 2-year (planted)", async () => {
    expect((await value(ITM.cc2Kit, LOC.UTT)).qtyBase).toBe(20)
  })

  it("Arif requests from Central into his own studio only", async () => {
    await refused(s, requestTransfer, { fromLocationId: LOC.CST, toLocationId: LOC.GUL, lines: [{ itemId: ITM.cc2Kit, qtyBase: 50 }] }, "arif", "OUT_OF_SCOPE")
    await refused(s, requestTransfer, { fromLocationId: LOC.CST, toLocationId: LOC.UTT, lines: [{ itemId: ITM.cc2Kit, qtyBase: 50 }] }, "nayeem", "DENIED")
    const out = await run(s, requestTransfer, { fromLocationId: LOC.CST, toLocationId: LOC.UTT, note: "Booked SUV ceramic job", lines: [{ itemId: ITM.cc2Kit, qtyBase: 50 }] }, "arif")
    transferId = out.id
    expect(out.transferNo).toMatch(/^TRF-\d{4}-\d{4}$/)
    expect((await s.db.transfers.get(transferId))?.status).toBe("requested")
  })

  it("Habib dispatches at Central's average cost into transit (R20); Arif cannot dispatch from Central", async () => {
    const t = (await s.db.transfers.get(transferId))!
    const lines = await s.db.transferLines.where("transferId").equals(transferId).toArray()
    await refused(s, dispatchTransfer, { transferId, expectedVersion: t.version, lines: [] }, "arif", "OUT_OF_SCOPE")
    const cst = await value(ITM.cc2Kit, LOC.CST)
    const expected = Math.round((50 * cst.valueP) / cst.qtyBase)
    const out = await run(s, dispatchTransfer, { transferId, expectedVersion: t.version, vehicleNo: "DHAKA METRO-NA 11-2233", lines: lines.map((l) => ({ lineId: l.id, qtySent: 50 })) }, "habib")
    const j = await expectBalanced(s, out.journalId)
    expect(j.journal.rule).toBe("R20")
    expect(j.journal.voucherType).toBe("IV")
    expect(j.byTag.get("INV_TRANSIT")).toBe(expected)
    expect(j.byTag.get("INV_CHEMICAL")).toBe(-expected)
    const sent = await s.db.transferLines.where("transferId").equals(transferId).toArray()
    expect(sent.reduce((sum, l) => sum + l.valueP, 0)).toBe(expected)
    expect(sent.reduce((sum, l) => sum + l.qtySent, 0)).toBe(50)
    expect((await s.db.transfers.get(transferId))?.status).toBe("dispatched")
    await expectStockTies(s)
  })

  it("Arif receives it in full (R21) and Uttara holds 70 ml", async () => {
    const t = (await s.db.transfers.get(transferId))!
    await refused(s, receiveTransfer, { transferId, expectedVersion: t.version, lines: [] }, "shahriar", "OUT_OF_SCOPE")
    const sent = await s.db.transferLines.where("transferId").equals(transferId).toArray()
    const out = await run(s, receiveTransfer, { transferId, expectedVersion: t.version, lines: sent.map((l) => ({ lineId: l.id, qtyReceived: l.qtySent })) }, "arif")
    const j = await expectBalanced(s, out.journalId)
    expect(j.journal.rule).toBe("R21")
    expect(j.byTag.get("INV_LOSS") ?? 0).toBe(0)
    expect((await value(ITM.cc2Kit, LOC.UTT)).qtyBase).toBe(70)
    expect((await s.db.transfers.get(transferId))?.status).toBe("received")
    await expectStockTies(s)
  })

  it("a shortfall on receipt goes to inventory loss at its share of the carried value", async () => {
    const req = await run(s, requestTransfer, { fromLocationId: LOC.CST, toLocationId: LOC.GUL, lines: [{ itemId: ITM.microfiber, qtyBase: 20 }] }, "shahriar")
    let t = (await s.db.transfers.get(req.id))!
    const lines = await s.db.transferLines.where("transferId").equals(req.id).toArray()
    await run(s, dispatchTransfer, { transferId: req.id, expectedVersion: t.version, lines: [{ lineId: lines[0].id, qtySent: 20 }] }, "habib")
    t = (await s.db.transfers.get(req.id))!
    const sent = await s.db.transferLines.where("transferId").equals(req.id).toArray()
    const carried = sent.reduce((sum, l) => sum + l.valueP, 0)
    const out = await run(
      s,
      receiveTransfer,
      { transferId: req.id, expectedVersion: t.version, lines: sent.map((l, i) => ({ lineId: l.id, qtyReceived: i === 0 ? l.qtySent - 2 : l.qtySent, note: "2 pieces short" })) },
      "shahriar"
    )
    const j = await expectBalanced(s, out.journalId)
    const loss = j.byTag.get("INV_LOSS") ?? 0
    expect(loss).toBeGreaterThan(0)
    expect((j.byTag.get("INV_CONSUMABLE") ?? 0) + loss).toBe(carried)
    expect(j.byTag.get("INV_TRANSIT")).toBe(-carried)
    const received = await s.db.transferLines.where("transferId").equals(req.id).toArray()
    expect(received[0].discrepancyNote).toBe("2 pieces short")
    await expectStockTies(s)
  })

  it("a request can be cancelled before dispatch; it cannot be received", async () => {
    const req = await run(s, requestTransfer, { fromLocationId: LOC.CST, toLocationId: LOC.GUL, lines: [{ itemId: ITM.polish, qtyBase: 1000 }] }, "habib")
    const t = (await s.db.transfers.get(req.id))!
    await refused(s, receiveTransfer, { transferId: req.id, expectedVersion: t.version, lines: [] }, "shahriar", "TRANSFER_NOT_DISPATCHED")
    await run(s, cancelTransfer, { transferId: req.id, expectedVersion: t.version, reason: "Not needed" }, "habib")
    expect((await s.db.transfers.get(req.id))?.status).toBe("cancelled")
  })
})

describe("adjustments and internal use (R22)", () => {
  it("a small damage within Habib's ৳1,000 posts at once", async () => {
    const out = await run(s, saveAdjustment, { locationId: LOC.CST, reason: "damage", note: "Torn pack", lines: [{ itemId: ITM.microfiber, qtyBase: -1 }], idempotencyKey: "adj-1" }, "habib")
    expect(out.status).toBe("posted")
    const j = await expectBalanced(s, out.journalId!)
    expect(j.journal.rule).toBe("R22")
    expect(j.byTag.get("INV_LOSS")).toBeGreaterThan(0)
    expect(j.byTag.get("INV_CONSUMABLE")).toBe(-(j.byTag.get("INV_LOSS") ?? 0))
    await refused(s, saveAdjustment, { locationId: LOC.CST, reason: "damage", note: "x x x", lines: [{ itemId: ITM.microfiber, qtyBase: 1 }], idempotencyKey: "adj-x" }, "habib", "ADJUSTMENT_SIGN")
    await refused(s, saveAdjustment, { locationId: LOC.CST, reason: "damage", note: "x x x", lines: [{ itemId: ITM.microfiber, qtyBase: -1 }], idempotencyKey: "adj-y" }, "tania", "DENIED")
    await expectStockTies(s)
  })

  it("above his limit it waits for a Gulshan approver; Shahriar approves and R22 posts", async () => {
    const rows = (await s.db.stockValues.where("locationId").equals(LOC.GUL).toArray()).filter((v) => v.valueP > 4_000_00 && v.qtyBase > 0)
    const row = rows.sort((a, b) => b.valueP - a.valueP)[0]
    const item = (await s.db.items.get(row.itemId))!
    const step = item.baseUom === "pc" || item.baseUom === "roll" ? 1 : 1
    const qty = Math.ceil((row.qtyBase * 2_000_00) / row.valueP / step) * step
    const out = await run(s, saveAdjustment, { locationId: LOC.GUL, reason: "loss", note: "Missing after stocktake", lines: [{ itemId: row.itemId, qtyBase: -qty }], idempotencyKey: "adj-2" }, "habib", LOC.GUL)
    expect(out.status).toBe("pending-approval")
    const adj = (await s.db.stockAdjustments.get(out.id))!
    const approval = (await s.db.approvals.get(adj.approvalId!))!
    expect(approval.approveKey).toBe("st.adjust.approve")
    expect(approval.routedTo).toContain("usr_shahriar")
    expect(approval.routedTo).not.toContain("usr_arif")
    expect(approval.routedTo).not.toContain("usr_habib")
    await refused(s, (await import("@/core/approvals/decide")).decideApproval, { approvalId: approval.id, decision: "approve", reason: "", expectedVersion: approval.version }, "habib", "SELF_APPROVAL")
    await decide(s, approval.id, "shahriar")
    const posted = (await s.db.stockAdjustments.get(out.id))!
    expect(posted.status).toBe("posted")
    const j = await expectBalanced(s, posted.journalId!)
    expect(j.journal.rule).toBe("R22")
    expect(j.journal.preparedBy).toBe("usr_habib")
    expect(j.journal.approvalId).toBe(approval.id)
    expect(-posted.lines[0].valueP).toBe(j.byTag.get("INV_LOSS"))
    await expectStockTies(s)
  })

  it("the planted Uttara adjustment (damaged polish) posts when Arif approves", async () => {
    await decide(s, PLANT.pendingAdjustmentApproval, "arif")
    const adj = (await s.db.stockAdjustments.get(PLANT.pendingAdjustment))!
    expect(adj.status).toBe("posted")
    await expectBalanced(s, adj.journalId!)
    await expectStockTies(s)
  })

  it("a rejected adjustment posts nothing", async () => {
    const rows = (await s.db.stockValues.where("locationId").equals(LOC.CST).toArray()).filter((v) => v.valueP > 50_000_00)
    const row = rows[0]
    const qty = Math.ceil((row.qtyBase * 3_000_00) / row.valueP)
    const out = await run(s, saveAdjustment, { locationId: LOC.CST, reason: "loss", note: "Leak", lines: [{ itemId: row.itemId, qtyBase: -qty }], idempotencyKey: "adj-3" }, "habib")
    const adj = (await s.db.stockAdjustments.get(out.id))!
    const journals = await s.db.journals.count()
    await decide(s, adj.approvalId!, "farzana", "reject")
    expect((await s.db.stockAdjustments.get(out.id))?.status).toBe("rejected")
    expect(await s.db.journals.count()).toBe(journals)
  })

  it("internal use debits the chosen expense (R22)", async () => {
    const out = await run(s, recordIssue, { locationId: LOC.CST, expenseTag: "OFFICE", note: "Cleaning the store office", lines: [{ itemId: ITM.apc, qtyBase: 100 }], idempotencyKey: "iss-1" }, "habib")
    expect(out.status).toBe("posted")
    const j = await expectBalanced(s, out.journalId!)
    expect(j.byTag.get("OFFICE")).toBeGreaterThan(0)
    expect(j.byTag.get("INV_CHEMICAL")).toBe(-(j.byTag.get("OFFICE") ?? 0))
    expect(await s.db.events.where("type").equals("StockIssued").count()).toBeGreaterThan(0)
    const moves = await s.db.stockMoves.where("ref.docId").equals(out.id).toArray()
    expect(moves[0].type).toBe("internal-use")
    expect(moves[0].journalId).toBe(out.journalId)
  })

  it("an expired batch is written off from that batch (FEFO would skip it)", async () => {
    const balances = (await s.db.stockBalances.where("locationId").equals(LOC.CST).toArray()).filter((b) => b.batchId && b.qtyBase > 0)
    const target = balances[0]
    await asSystem(s.db, async (tx) => {
      await tx.update("batches", target.batchId!, { expiry: addDaysISO(s.today, -3), status: "expired" })
    })
    const out = await run(
      s,
      saveAdjustment,
      { locationId: LOC.CST, reason: "expiry", note: "Expired batch", lines: [{ itemId: target.itemId, batchId: target.batchId, qtyBase: -Math.min(1, target.qtyBase) }], idempotencyKey: "adj-exp" },
      "habib"
    )
    const adj = (await s.db.stockAdjustments.get(out.id))!
    if (adj.status === "posted") await expectBalanced(s, adj.journalId!)
    const after = await s.db.stockBalances.get(target.id)
    expect(after!.qtyBase).toBeCloseTo(target.qtyBase - Math.min(1, target.qtyBase), 6)
    await expectStockTies(s)
  })
})
