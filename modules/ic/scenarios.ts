import type { Id, ItemRow, StockValueRow } from "@/core/db/schema"
import { stockValueId } from "@/core/db/tables"
import { previousRuns } from "@/core/scenarios/helpers"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { CAT, LOC, USR } from "@/core/seed/content/seed-refs"
import { resolveSecurity } from "@/core/security/resolve"
import { issueValue } from "@/core/stock/value"

import { cancelCount, openCount } from "./commands"
import { runKey } from "./scenario-kit"

/**
 * E9 Stock count variance (plan §10): a fresh count of Gulshan's retail
 * shelf. The cue gives three counted quantities, computed here from the
 * count's expected quantities and today's average costs, whose shortfalls
 * total about ৳4,200: above Habib's ৳1,000 stock-adjust limit, so the count
 * waits for Shahriar (limit ৳5,000), whose approval posts R22.
 */

const TARGET_P = 4_200_00
const PER_LINE_P = TARGET_P / 3
const NEAR_P = 210_00
const REASON = "Superseded by a new E9 demo count"

export type E9Pick = { index: number; itemId: Id; sku: string; expected: number; counted: number; valueP: number }

/** Earlier E9 counts still open or counted are cancelled (re-run rules). */
async function clearEarlierRuns(kit: ScenarioKit): Promise<void> {
  for (const run of await previousRuns(kit.db, "E9")) {
    const count = run.refs.countId ? await kit.db.stockCounts.get(run.refs.countId) : undefined
    if (!count || (count.status !== "open" && count.status !== "counted")) continue
    await kit.run(cancelCount, { countId: count.id, expectedVersion: count.version, reason: REASON }, "habib")
  }
}

/** A shortfall worth about a third of the target on a line, in whole units (tens of ml or g). */
function shortfallFor(item: ItemRow, expected: number, value: StockValueRow): { qty: number; valueP: number } | undefined {
  if (value.qtyBase <= 0 || value.valueP <= 0) return undefined
  const unit = item.baseUom === "pc" || item.baseUom === "roll" ? 1 : 10
  const max = Math.floor(expected / unit) * unit
  if (max < unit) return undefined
  const ideal = Math.round((PER_LINE_P * value.qtyBase) / value.valueP / unit) * unit
  const qty = Math.min(Math.max(ideal, unit), max > unit ? max - unit : max)
  return { qty, valueP: issueValue(qty, value.qtyBase, value.valueP) }
}

/**
 * Three lines on three different items whose shortfalls total about
 * ৳4,200: within ৳210 of it, the triple nearest the top of the count;
 * otherwise the nearest total.
 */
export function pickVariances(
  lines: { itemId: Id; expectedQty: number }[],
  items: Map<Id, ItemRow>,
  values: Map<Id, StockValueRow>
): E9Pick[] {
  const options: E9Pick[] = []
  lines.forEach((line, index) => {
    const item = items.get(line.itemId)
    const value = values.get(line.itemId)
    if (!item || !value) return
    const short = shortfallFor(item, line.expectedQty, value)
    if (short) options.push({ index, itemId: item.id, sku: item.sku, expected: line.expectedQty, counted: line.expectedQty - short.qty, valueP: short.valueP })
  })
  let best: { picks: E9Pick[]; error: number; last: number } | undefined
  const better = (picks: E9Pick[]) => {
    const error = Math.abs(picks.reduce((s, p) => s + p.valueP, 0) - TARGET_P)
    const last = picks[2].index
    if (!best) return true
    const near = error <= NEAR_P
    const bestNear = best.error <= NEAR_P
    if (near !== bestNear) return near
    return near ? last < best.last || (last === best.last && error < best.error) : error < best.error
  }
  for (let a = 0; a < options.length; a++) {
    for (let b = a + 1; b < options.length; b++) {
      if (options[b].itemId === options[a].itemId) continue
      for (let c = b + 1; c < options.length; c++) {
        if (options[c].itemId === options[a].itemId || options[c].itemId === options[b].itemId) continue
        const picks = [options[a], options[b], options[c]]
        if (better(picks)) best = { picks, error: Math.abs(picks.reduce((s, p) => s + p.valueP, 0) - TARGET_P), last: picks[2].index }
      }
    }
  }
  if (!best) throw new Error("E9: fewer than three items to count at Gulshan")
  return best.picks
}

export const e9CountVariance: ScenarioDef = {
  id: "E9",
  kind: "scenario",
  module: "ic",
  titleKey: "ic.scenarios.e9.title",
  summaryKey: "ic.scenarios.e9.summary",
  user: "habib",
  async setup(kit) {
    const db = kit.db
    await clearEarlierRuns(kit)

    // The retail shelf (one line per item), else everything at Gulshan.
    const items = new Map((await db.items.toArray()).map((i) => [i.id, i]))
    const atGulshan = (await db.stockBalances.where("locationId").equals(LOC.GUL).toArray()).filter((b) => b.qtyBase > 0)
    const retail = new Set(atGulshan.filter((b) => items.get(b.itemId)?.categoryId === CAT.RETAIL).map((b) => b.itemId))
    const opened = await kit.run(
      openCount,
      { locationId: LOC.GUL, categoryIds: retail.size >= 6 ? [CAT.RETAIL] : undefined, idempotencyKey: runKey(kit, "count") },
      "habib"
    )
    const count = await db.stockCounts.get(opened.id)
    if (!count) throw new Error("E9: the count was not saved")
    const ids = [...new Set(count.lines.map((l) => l.itemId))]
    const values = new Map(
      (await db.stockValues.bulkGet(ids.map((id) => stockValueId(id, LOC.GUL)))).filter((v): v is StockValueRow => !!v).map((v) => [v.itemId, v])
    )
    const picks = pickVariances(count.lines, items, values).sort((a, b) => a.index - b.index)
    const [habib, shahriar] = await Promise.all([resolveSecurity(db, USR.habib), resolveSecurity(db, USR.shahriar)])

    const params: Record<string, string | number> = {
      countNo: opened.countNo,
      varianceP: picks.reduce((s, p) => s + p.valueP, 0),
      limitP: habib.limits["stock-adjust"],
      approverLimitP: shahriar.limits["stock-adjust"],
    }
    picks.forEach((p, i) => {
      params[`sku${i + 1}`] = p.sku
      params[`expected${i + 1}`] = p.expected
      params[`counted${i + 1}`] = p.counted
    })
    return { refs: { countId: opened.id, locationId: LOC.GUL }, params }
  },
  route: (outcome) => `/ic/counts/${outcome.refs?.countId ?? ""}`,
  cueKeys: ["ic.scenarios.e9.cue1", "ic.scenarios.e9.cue2", "ic.scenarios.e9.cue3", "ic.scenarios.e9.cue4", "ic.scenarios.e9.cue5"],
  companion: { user: "shahriar", route: () => "/approvals" },
}

/** IC scenario launchers (implementation_plan.md §10). */
export const icScenarios: ScenarioDef[] = [e9CountVariance]
