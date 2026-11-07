import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { BatchRow, StockBalanceRow } from "@/core/db/schema"
import { stockValueId } from "@/core/db/tables"
import { allocateFefo } from "@/core/stock/fefo"
import {
  acceptQuarantined,
  adjustStock,
  issueStock,
  quarantineLot,
  receiveStock,
  returnQuarantined,
  transferIn,
  transferOut,
} from "@/core/stock/moves"
import { addMonthsISO } from "@/core/seed/time"
import { issueValue, scaleRecipeQty, standardValue } from "@/core/stock/value"

import { foundationDb } from "../helpers/foundation"
import { asSystem, seedTestItems } from "../helpers/fixtures"

const ref = { docType: "test", docId: "t1", docNo: "T-1" }
/** Expiry dates relative to the test clock, so FEFO tests hold on any TEST_DATE. */
const monthsAhead = (n: number) => addMonthsISO(dhakaDate(now()), n)

describe("stock math (plan §3.5)", () => {
  it("takes value pro rata and empties a location with exactly the remainder", () => {
    expect(issueValue(10, 30, 1_000_00)).toBe(33_333)
    expect(issueValue(30, 30, 1_000_01)).toBe(1_000_01)
    expect(issueValue(0, 30, 1_000_00)).toBe(0)
  })

  it("scales recipes by vehicle class (whole ml, 0.05 pc)", () => {
    expect(scaleRecipeQty(30, "SUV", "ml")).toBe(38)
    expect(scaleRecipeQty(0.25, "HB", "pc")).toBe(0.2)
    expect(scaleRecipeQty(0.5, "SUV", "pc")).toBe(0.65)
    expect(scaleRecipeQty(150, "LSUV", "ml")).toBe(225)
  })

  it("values standard cost per base unit", () => {
    expect(standardValue({ standardCostP: 6_500_00, purchaseFactor: 50 }, 38)).toBe(4_940_00)
  })

  it("allocates FEFO over usable batches only", () => {
    const bal = (id: string, batchId: string, qty: number): StockBalanceRow => ({
      id,
      itemId: "i",
      locationId: "l",
      batchId,
      qtyBase: qty,
      quarantinedQty: 0,
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      createdBy: "s",
      updatedBy: "s",
      origin: "central",
    })
    const batch = (id: string, expiry: string, status: BatchRow["status"] = "ok"): BatchRow => ({
      id,
      itemId: "i",
      batchNo: id,
      expiry,
      receivedAt: 0,
      status,
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      createdBy: "s",
      updatedBy: "s",
      origin: "central",
    })
    const entries = [
      { balance: bal("b1", "late", 50), batch: batch("late", "2027-12-31") },
      { balance: bal("b2", "early", 20), batch: batch("early", "2027-01-31") },
      { balance: bal("b3", "expired", 99), batch: batch("expired", "2026-01-01") },
      { balance: bal("b4", "held", 99), batch: batch("held", "2026-12-31", "quarantine") },
    ]
    const { allocations, short } = allocateFefo(entries, 30, "2026-11-07")
    expect(allocations.map((a) => [a.batchId, a.qty])).toEqual([
      ["early", 20],
      ["late", 10],
    ])
    expect(short).toBe(0)
    expect(allocateFefo(entries, 100, "2026-11-07").short).toBe(30)
  })
})

describe("stock moves", () => {
  let db: OmniflowDb
  beforeEach(async () => {
    db = await foundationDb("stock")
    await seedTestItems(db)
  })
  afterEach(async () => {
    await db.delete()
  })
  const value = async (itemId: string, loc: string) => db.stockValues.get(stockValueId(itemId, loc))

  it("keeps a moving average across receipts and issues, and refuses going negative", async () => {
    await asSystem(db, async (tx) => {
      await receiveStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 100, valueP: 13_000_00, type: "grn", ref, batch: { batchNo: "A", expiry: monthsAhead(8) } })
      await receiveStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 50, valueP: 7_000_00, type: "grn", ref, batch: { batchNo: "B", expiry: monthsAhead(4) } })
    })
    expect(await value("itm_cc2", "loc_gul")).toMatchObject({ qtyBase: 150, valueP: 20_000_00 })
    const out = await asSystem(db, (tx) => issueStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 60, type: "issue-job", ref }))
    expect(out.valueP).toBe(8_000_00)
    // FEFO: batch B (earlier expiry) first
    expect(out.moves[0].qtyBase).toBe(50)
    expect(await value("itm_cc2", "loc_gul")).toMatchObject({ qtyBase: 90, valueP: 12_000_00 })
    await expect(
      asSystem(db, (tx) => issueStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 91, type: "issue-job", ref }))
    ).rejects.toMatchObject({ code: "STOCK_NEGATIVE" })
    const emptied = await asSystem(db, (tx) => issueStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 90, type: "issue-job", ref }))
    expect(emptied.valueP).toBe(12_000_00)
    expect(await value("itm_cc2", "loc_gul")).toMatchObject({ qtyBase: 0, valueP: 0 })
  })

  it("raises StockBelowReorder once on crossing the minimum", async () => {
    await asSystem(db, (tx) =>
      receiveStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 150, valueP: 19_500_00, type: "grn", ref, batch: { batchNo: "A" } })
    )
    await asSystem(db, (tx) => issueStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 38, type: "issue-job", ref }))
    expect(await db.events.where("type").equals("StockBelowReorder").count()).toBe(0)
    await asSystem(db, (tx) => issueStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 38, type: "issue-job", ref }))
    expect(await db.events.where("type").equals("StockBelowReorder").count()).toBe(1)
    await asSystem(db, (tx) => issueStock(tx, { itemId: "itm_cc2", locationId: "loc_gul", qtyBase: 10, type: "issue-job", ref }))
    expect(await db.events.where("type").equals("StockBelowReorder").count()).toBe(1)
  })

  it("carries value through a transfer", async () => {
    await asSystem(db, (tx) =>
      receiveStock(tx, { itemId: "itm_cc2", locationId: "loc_cst", qtyBase: 900, valueP: 117_000_00, type: "grn", ref, batch: { batchNo: "C" } })
    )
    const sent = await asSystem(db, (tx) => transferOut(tx, { itemId: "itm_cc2", locationId: "loc_cst", qtyBase: 100, ref }))
    expect(sent.valueP).toBe(13_000_00)
    await asSystem(db, (tx) =>
      transferIn(tx, { itemId: "itm_cc2", locationId: "loc_utt", qtyBase: 100, valueP: sent.valueP, ref, batchId: sent.moves[0].batchId })
    )
    expect(await value("itm_cc2", "loc_utt")).toMatchObject({ qtyBase: 100, valueP: 13_000_00 })
  })

  it("holds quarantined lots without value until accepted, and returns them without posting", async () => {
    const held = await asSystem(db, (tx) =>
      quarantineLot(tx, { itemId: "itm_cc2", locationId: "loc_cst", qtyBase: 100, batch: { batchNo: "Q1", expiry: "2026-12-01" }, ref })
    )
    expect(await value("itm_cc2", "loc_cst")).toBeUndefined()
    await expect(
      asSystem(db, (tx) => issueStock(tx, { itemId: "itm_cc2", locationId: "loc_cst", qtyBase: 1, type: "issue-job", ref }))
    ).rejects.toMatchObject({ code: "STOCK_NEGATIVE" })
    await asSystem(db, (tx) =>
      acceptQuarantined(tx, { itemId: "itm_cc2", locationId: "loc_cst", batchId: held.batchId, qtyBase: 50, valueP: 6_500_00, ref })
    )
    await asSystem(db, (tx) => returnQuarantined(tx, { itemId: "itm_cc2", locationId: "loc_cst", batchId: held.batchId, qtyBase: 50, ref }))
    expect(await value("itm_cc2", "loc_cst")).toMatchObject({ qtyBase: 50, valueP: 6_500_00 })
    const bal = await db.stockBalances.where("[itemId+locationId]").equals(["itm_cc2", "loc_cst"]).first()
    expect(bal).toMatchObject({ qtyBase: 50, quarantinedQty: 0 })
  })

  it("adjusts gains at average (or standard cost when empty) and losses at average", async () => {
    const gain = await asSystem(db, (tx) => adjustStock(tx, { itemId: "itm_mft", locationId: "loc_gul", qtyBase: 10, type: "adjust", ref }))
    expect(gain.signedValueP).toBe(2_200_00)
    const loss = await asSystem(db, (tx) => adjustStock(tx, { itemId: "itm_mft", locationId: "loc_gul", qtyBase: -4, type: "count-variance", ref }))
    expect(loss.signedValueP).toBe(-880_00)
  })
})
