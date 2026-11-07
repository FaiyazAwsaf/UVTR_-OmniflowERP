import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { ScenarioLaunch } from "@/core/scenarios/runner"
import { runScenario } from "@/core/scenarios/runner"
import { trialBalance } from "@/core/ledger/statements"
import { CAT, LOC } from "@/core/seed/content/seed-refs"
import { postCount, recordCounts } from "@/modules/ic/commands"
import { e9CountVariance } from "@/modules/ic/scenarios"

import { decide, expectBalanced, expectStockTies, run, scmDb, type ScmDb } from "./scm"

/**
 * E9 Stock count variance (plan §10), run again and again on the small seed:
 * each run opens a fresh count of Gulshan's retail shelf; the three counts
 * the cue gives make shortfalls worth about ৳4,200 (the total the cue names),
 * above Habib's ৳1,000, so the count waits for Shahriar (৳5,000), whose
 * approval posts R22; a count a previous run left open is cancelled.
 */

let s: ScmDb
beforeAll(async () => {
  s = await scmDb("e9")
}, 120_000)
afterAll(async () => {
  await s.db.delete()
})

async function launch(): Promise<ScenarioLaunch> {
  const out = await runScenario(e9CountVariance, s.db)
  const countId = out.outcome.refs?.countId as string
  expect(out.route).toBe(`/ic/counts/${countId}`)
  expect(out.companionRoute).toBe("/approvals")
  const count = (await s.db.stockCounts.get(countId))!
  expect(count.status).toBe("open")
  expect(count.locationId).toBe(LOC.GUL)
  expect(count.scope).toEqual([CAT.RETAIL])
  const p = out.outcome.params!
  expect(p.countNo).toBe(count.countNo)
  expect(p.limitP).toBe(1_000_00)
  expect(p.approverLimitP).toBe(5_000_00)
  const total = Number(p.varianceP)
  expect(total).toBeGreaterThan(3_800_00)
  expect(total).toBeLessThan(4_600_00)
  const skus = [p.sku1, p.sku2, p.sku3]
  expect(new Set(skus).size).toBe(3)
  for (const i of [1, 2, 3]) {
    expect(Number(p[`counted${i}`])).toBeGreaterThanOrEqual(0)
    expect(Number(p[`counted${i}`])).toBeLessThan(Number(p[`expected${i}`]))
  }
  return out
}

/** Habib fills expected, enters the cue's three counts and posts; Shahriar approves; R22 posts the cue's total. */
async function countAndPost(out: ScenarioLaunch) {
  const p = out.outcome.params!
  const countId = out.outcome.refs?.countId as string
  let count = (await s.db.stockCounts.get(countId))!
  const skuOf = new Map((await s.db.items.toArray()).map((i) => [i.id, i.sku]))
  const counts = count.lines.map((line, index) => {
    const i = [1, 2, 3].find((n) => p[`sku${n}`] === skuOf.get(line.itemId) && p[`expected${n}`] === line.expectedQty)
    return { index, countedQty: i ? Number(p[`counted${i}`]) : line.expectedQty }
  })
  expect(counts.filter((c, i) => c.countedQty !== count.lines[i].expectedQty)).toHaveLength(3)
  const saved = await run(s, recordCounts, { countId, expectedVersion: count.version, counts }, "habib")
  expect(saved.status).toBe("counted")
  count = (await s.db.stockCounts.get(countId))!
  expect(count.lines.reduce((sum, l) => sum + Math.abs(l.varianceValueP), 0)).toBe(p.varianceP)
  const posted = await run(s, postCount, { countId, expectedVersion: count.version, idempotencyKey: `e9-post-${countId}` }, "habib")
  expect(posted.status).toBe("pending-approval")
  expect(posted.amountP).toBe(p.varianceP)
  count = (await s.db.stockCounts.get(countId))!
  const approval = (await s.db.approvals.get(count.approvalId!))!
  expect(approval.approveKey).toBe("ic.count.approve")
  expect(approval.routedTo).toContain("usr_shahriar")
  expect(approval.routedTo).not.toContain("usr_habib")
  await decide(s, approval.id, "shahriar")
  count = (await s.db.stockCounts.get(countId))!
  expect(count.status).toBe("posted")
  const j = await expectBalanced(s, count.journalId!)
  expect(j.journal.rule).toBe("R22")
  expect(j.byTag.get("INV_LOSS")).toBe(p.varianceP)
}

async function ties() {
  const tb = trialBalance(await s.db.accounts.toArray(), await s.db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" })
  expect(tb.balanced).toBe(true)
  await expectStockTies(s)
}

describe("E9 launcher", () => {
  it("run 1: a fresh count at Gulshan; the cue's counts go to Shahriar and post", async () => {
    await countAndPost(await launch())
    await ties()
  })

  it("run 2: another fresh count, computed from the new averages and quantities; it works again", async () => {
    await countAndPost(await launch())
    await ties()
  })

  it("run 3 and 4: a count left open by the previous run is cancelled", async () => {
    const third = await launch()
    const fourth = await launch()
    expect((await s.db.stockCounts.get(third.outcome.refs?.countId as string))?.status).toBe("cancelled")
    await countAndPost(fourth)
    await ties()
  })
})
