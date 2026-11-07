import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysISO } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { commit } from "@/core/engine/commit"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { stockValueId } from "@/core/db/tables"
import { LOC } from "@/core/seed/content/seed-refs"
import { cancelCount, openCount, postCount, raiseReorderPr, recordCounts } from "@/modules/ic/commands"
import { icDatasetLoaders } from "@/modules/ic/datasets"
import { icJobs } from "@/modules/ic/jobs"
import { loadReorderSuggestions, loadStockRows } from "@/modules/ic/queries"
import { grnDatasetLoaders } from "@/modules/grn/datasets"
import { ptlDatasetLoaders } from "@/modules/ptl/datasets"
import { stDatasetLoaders } from "@/modules/st/datasets"

import { asSystem } from "../helpers/fixtures"
import { decide, expectBalanced, expectStockTies, refused, run, scmDb, type ScmDb } from "./scm"

/**
 * IC (plan §6.2, accounting_rules R22): E9 by hand (a fresh count at
 * Gulshan, 3 variances worth about ৳4,200 above Habib's ৳1,000, Shahriar
 * approves within his ৳5,000, the journal posts), counts within limit,
 * rejection, reorder requisitions, the expiry watch and the datasets.
 */

let s: ScmDb
beforeAll(async () => {
  s = await scmDb("ic")
}, 120_000)
afterAll(async () => {
  await s.db.delete()
})

async function counted(countId: string, variances: number, targetEachP: number) {
  const count = (await s.db.stockCounts.get(countId))!
  const picked: number[] = []
  const counts = []
  for (const [index, line] of count.lines.entries()) {
    let countedQty = line.expectedQty
    if (picked.length < variances) {
      const v = (await s.db.stockValues.get(stockValueId(line.itemId, count.locationId)))!
      const item = (await s.db.items.get(line.itemId))!
      const unit = v.valueP / v.qtyBase
      const q = item.baseUom === "pc" || item.baseUom === "roll" ? Math.round(targetEachP / unit) : Math.round(targetEachP / unit)
      if (q >= 1 && q <= line.expectedQty && targetEachP / unit < line.expectedQty) {
        countedQty = line.expectedQty - q
        picked.push(index)
      }
    }
    counts.push({ index, countedQty })
  }
  expect(picked.length).toBe(variances)
  return run(s, recordCounts, { countId, expectedVersion: count.version, counts }, "habib", LOC.GUL)
}

describe("stock counts (E9)", () => {
  let countId: string

  it("Habib opens a count at Gulshan: expected quantities are snapshotted", async () => {
    await refused(s, openCount, { locationId: LOC.GUL }, "tania", "DENIED")
    await refused(s, openCount, { locationId: LOC.GUL }, "arif", "OUT_OF_SCOPE")
    const out = await run(s, openCount, { locationId: LOC.GUL }, "habib", LOC.GUL)
    countId = out.id
    expect(out.countNo).toMatch(/^CNT-GUL-\d{4}-\d{3}$/)
    const count = (await s.db.stockCounts.get(countId))!
    expect(count.status).toBe("open")
    expect(count.lines.length).toBeGreaterThan(5)
    expect(count.lines.every((l) => l.expectedQty > 0)).toBe(true)
  })

  it("cannot post before every line is counted", async () => {
    const count = (await s.db.stockCounts.get(countId))!
    await run(s, recordCounts, { countId, expectedVersion: count.version, counts: [{ index: 0, countedQty: count.lines[0].expectedQty }] }, "habib", LOC.GUL)
    const again = (await s.db.stockCounts.get(countId))!
    expect(again.status).toBe("open")
    await refused(s, postCount, { countId, expectedVersion: again.version, idempotencyKey: "c0" }, "habib", "COUNT_NOT_COUNTED", LOC.GUL)
  })

  it("3 variances worth about ৳4,200 wait for approval and Shahriar posts them (R22)", async () => {
    const res = await counted(countId, 3, 1_400_00)
    expect(res.status).toBe("counted")
    const count = (await s.db.stockCounts.get(countId))!
    const total = count.lines.reduce((sum, l) => sum + Math.abs(l.varianceValueP), 0)
    expect(total).toBeGreaterThan(3_000_00)
    expect(total).toBeLessThan(5_000_00)
    const out = await run(s, postCount, { countId, expectedVersion: count.version, idempotencyKey: "c1" }, "habib", LOC.GUL)
    expect(out.status).toBe("pending-approval")
    const pending = (await s.db.stockCounts.get(countId))!
    const approval = (await s.db.approvals.get(pending.approvalId!))!
    expect(approval.approveKey).toBe("ic.count.approve")
    expect(approval.kind).toBe("stock-adjust")
    expect(approval.routedTo).toContain("usr_shahriar")
    expect(approval.routedTo).not.toContain("usr_arif")
    await decide(s, approval.id, "shahriar")
    const posted = (await s.db.stockCounts.get(countId))!
    expect(posted.status).toBe("posted")
    const j = await expectBalanced(s, posted.journalId!)
    expect(j.journal.rule).toBe("R22")
    expect(j.journal.preparedBy).toBe("usr_habib")
    expect(Math.abs(j.byTag.get("INV_LOSS") ?? 0)).toBe(posted.lines.reduce((sum, l) => sum - l.varianceValueP, 0))
    const moves = await s.db.stockMoves.where("ref.docId").equals(countId).toArray()
    expect(moves.length).toBe(3)
    expect(moves.every((m) => m.type === "count-variance" && m.journalId === posted.journalId)).toBe(true)
    expect(await s.db.events.where("type").equals("CountPosted").count()).toBe(1)
    await expectStockTies(s)
  })

  it("a variance within Habib's limit posts at once; a rejected count goes back to counted", async () => {
    const small = await run(s, openCount, { locationId: LOC.CST }, "habib")
    await counted(small.id, 1, 300_00)
    let count = (await s.db.stockCounts.get(small.id))!
    const out = await run(s, postCount, { countId: small.id, expectedVersion: count.version, idempotencyKey: "c2" }, "habib")
    expect(out.status).toBe("posted")
    await expectBalanced(s, out.journalId!)

    const big = await run(s, openCount, { locationId: LOC.CST }, "habib")
    await counted(big.id, 2, 1_500_00)
    count = (await s.db.stockCounts.get(big.id))!
    await run(s, postCount, { countId: big.id, expectedVersion: count.version, idempotencyKey: "c3" }, "habib")
    count = (await s.db.stockCounts.get(big.id))!
    await decide(s, count.approvalId!, "farzana", "reject")
    expect((await s.db.stockCounts.get(big.id))?.status).toBe("counted")
    count = (await s.db.stockCounts.get(big.id))!
    await run(s, cancelCount, { countId: big.id, expectedVersion: count.version, reason: "Recount tomorrow" }, "habib")
    expect((await s.db.stockCounts.get(big.id))?.status).toBe("cancelled")
    await expectStockTies(s)
  })
})

describe("reorder, expiry watch and datasets", () => {
  it("suggests reorders at the studios and raises a draft requisition", async () => {
    const suggestions = await loadReorderSuggestions(s.db)
    expect(suggestions.length).toBeGreaterThan(0)
    const atCst = (await loadReorderSuggestions(s.db, LOC.CST))[0] ?? suggestions[0]
    await refused(s, raiseReorderPr, { locationId: LOC.CST, lines: [{ itemId: atCst.item.id, qty: 1, estUnitCostP: 100 }], idempotencyKey: "r0" }, "shahriar", "OUT_OF_SCOPE")
    const out = await run(
      s,
      raiseReorderPr,
      { locationId: atCst.location.id, lines: [{ itemId: atCst.item.id, qty: atCst.suggestQty, estUnitCostP: atCst.estUnitCostP, suggestedVendorId: atCst.vendorId }], idempotencyKey: "r1" },
      "habib",
      atCst.location.id
    )
    const pr = (await s.db.purchaseRequisitions.get(out.id))!
    expect(pr.status).toBe("draft")
    expect(pr.reason).toBe("reorder")
    expect(pr.totalP).toBe(Math.round(atCst.suggestQty * atCst.estUnitCostP))
  })

  it("the expiry watch alerts once per batch and expires past batches", async () => {
    const ctx = {
      db: s.db,
      now: now(),
      commitSystem: (def: never, input: never) => commit(def, input, { db: s.db, actor: SYSTEM_ACTOR }),
    }
    const target = (await s.db.batches.toArray()).find((b) => b.status === "ok" && b.expiry)!
    await asSystem(s.db, async (tx) => {
      await tx.update("batches", target.id, { expiry: addDaysISO(s.today, -1) })
    })
    await icJobs[0].run(ctx as never)
    const alerts = await s.db.events.where("type").equals("ExpiryAlert").count()
    expect(alerts).toBeGreaterThan(0)
    expect((await s.db.batches.get(target.id))?.status).toBe("expired")
    await icJobs[0].run(ctx as never)
    expect(await s.db.events.where("type").equals("ExpiryAlert").count()).toBe(alerts)
  })

  it("stock rows and every SCM dataset load", async () => {
    const rows = await loadStockRows(s.db, { locationId: LOC.UTT })
    expect(rows.length).toBeGreaterThan(10)
    expect(rows.every((r) => r.location.id === LOC.UTT)).toBe(true)
    const stock = await icDatasetLoaders["ic.stock"](s.db, {})
    expect(stock[0]).toHaveProperty("itemHref")
    const moves = await icDatasetLoaders["ic.moves"](s.db, { from: addDaysISO(s.today, -3), to: s.today })
    expect(moves.length).toBeGreaterThan(0)
    expect((await ptlDatasetLoaders["ptl.poLines"](s.db, {})).length).toBeGreaterThan(0)
    expect((await grnDatasetLoaders["grn.lines"](s.db, {})).length).toBeGreaterThan(0)
    expect((await stDatasetLoaders["st.transfers"](s.db, {})).length).toBeGreaterThan(0)
  })
})
