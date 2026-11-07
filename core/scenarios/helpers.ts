import type { OmniflowDb } from "@/core/db/database"
import type { Id, ISODate, ScenarioRunRow } from "@/core/db/schema"
import { stockValueId } from "@/core/db/tables"
import { postJournal } from "@/core/ledger/post"
import { linesForStockAdjustment, RULE_VOUCHER } from "@/core/ledger/rules"
import { addMonthsISO, lastOfMonth } from "@/core/seed/time"
import { inventoryTagOf, issueStock, receiveStock, usableQty } from "@/core/stock/moves"
import { roundQty, standardValue } from "@/core/stock/value"

import type { ScenarioKit } from "./types"

/**
 * Helpers every launcher setup shares (plan §10 re-run rules). They only
 * read, or write through the kit (commands or audited fixtures).
 */

/** The most recent run of any of these launchers (J1..J6 share one journey), newest first. */
export async function lastRun(db: OmniflowDb, scenarioIds: string | string[]): Promise<ScenarioRunRow | undefined> {
  const ids = new Set(Array.isArray(scenarioIds) ? scenarioIds : [scenarioIds])
  const runs = await db.scenarioRuns.orderBy("at").reverse().toArray()
  return runs.find((r) => ids.has(r.scenarioId))
}

/** Every earlier run of these launchers, newest first (to clear what they left in the way). */
export async function previousRuns(db: OmniflowDb, scenarioIds: string | string[]): Promise<ScenarioRunRow[]> {
  const ids = new Set(Array.isArray(scenarioIds) ? scenarioIds : [scenarioIds])
  const runs = await db.scenarioRuns.orderBy("at").reverse().toArray()
  return runs.filter((r) => ids.has(r.scenarioId))
}

/**
 * Brings an item's usable stock at a location to a level (plan §10: "top up
 * or reset planted stock with an adjustment fixture"). `at-least` only tops
 * up; `exactly` also takes stock away (FEFO). The difference posts R22 like a
 * stock adjustment (gain or loss against inventory loss), so the books and
 * the inventory accounts stay tied. A top-up arrives as a fresh lot that
 * expires in a year at the location's average cost (the standard cost when
 * the shelf is empty). Returns the usable quantity before and after.
 */
export async function setStockLevel(
  kit: ScenarioKit,
  input: { itemId: Id; locationId: Id; qtyBase: number; mode: "at-least" | "exactly" }
): Promise<{ before: number; after: number }> {
  return kit.fixture(`stock ${input.itemId} at ${input.locationId} ${input.mode} ${input.qtyBase}`, async (tx) => {
    const today = tx.today()
    const before = await usableQty(tx, input.itemId, input.locationId, today)
    const diff = roundQty(input.qtyBase - before)
    if (diff === 0 || (diff < 0 && input.mode === "at-least")) return { before, after: before }
    const item = await tx.get("items", input.itemId)
    const tag = await inventoryTagOf(tx, item)
    const ref = { docType: "scenarioRuns", docId: kit.runId, docNo: `SETUP-${kit.scenarioId}` }
    let valueP: number
    if (diff > 0) {
      const current = await tx.find("stockValues", stockValueId(input.itemId, input.locationId))
      valueP =
        current && current.qtyBase > 0 ? Math.round((diff * current.valueP) / current.qtyBase) : standardValue(item, diff)
      await receiveStock(tx, {
        itemId: input.itemId,
        locationId: input.locationId,
        qtyBase: diff,
        valueP,
        type: "adjust",
        ref,
        batch: { batchNo: `DEMO-${kit.scenarioId}-${today.replaceAll("-", "")}`, expiry: addMonthsISO(today, 12) },
      })
    } else {
      const out = await issueStock(tx, { itemId: input.itemId, locationId: input.locationId, qtyBase: -diff, type: "adjust", ref })
      valueP = -out.valueP
    }
    if (valueP !== 0) {
      await postJournal(tx, {
        voucherType: RULE_VOUCHER.R22,
        date: today,
        narration: `Demo setup ${kit.scenarioId}: ${item.sku} ${diff > 0 ? "topped up" : "reduced"} by ${Math.abs(diff)} at the studio`,
        lines: linesForStockAdjustment({ locationId: input.locationId, lines: [{ itemId: input.itemId, tag, valueP }] }),
        rule: "R22",
      })
    }
    return { before, after: roundQty(before + diff) }
  })
}

/** The month before `today`: YYYY-MM, its first and its last day. */
export function lastMonth(today: ISODate): { month: string; firstDay: ISODate; lastDay: ISODate } {
  const firstDay = addMonthsISO(today, -1)
  return { month: firstDay.slice(0, 7), firstDay, lastDay: lastOfMonth(firstDay) }
}
