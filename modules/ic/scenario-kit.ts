import type { OmniflowDb } from "@/core/db/database"
import type { Id, ISODate } from "@/core/db/schema"
import { setStockLevel } from "@/core/scenarios/helpers"
import type { ScenarioKit } from "@/core/scenarios/types"
import { allocateFefo } from "@/core/stock/fefo"
import { roundQty } from "@/core/stock/value"
import { localizeDigits } from "@/lib/i18n/format"
import { isoToDmy } from "@/lib/i18n/dmy"

/**
 * Shared pieces of the SCM launchers (E3, E4, E9; plan §10). Setups read
 * committed data straight from the database and write only through the kit
 * (real commands, or `setStockLevel` for planted stock levels).
 */

/**
 * What FEFO can issue today (core `usableQty`, read outside a commit): on
 * hand less quarantined, expired or held lots.
 */
export async function usableAt(db: OmniflowDb, itemId: Id, locationId: Id, today: ISODate): Promise<number> {
  const balances = await db.stockBalances.where("[itemId+locationId]").equals([itemId, locationId]).toArray()
  const entries = await Promise.all(
    balances.map(async (balance) => ({ balance, batch: balance.batchId ? await db.batches.get(balance.batchId) : undefined }))
  )
  const all = entries.reduce((s, e) => s + Math.max(e.balance.qtyBase, 0), 0)
  if (all <= 0) return 0
  const { short } = allocateFefo(entries, all, today)
  return roundQty(all - short)
}

/** Tops an item up to a level only when it is short (no commit otherwise). */
export async function topUpWhenShort(kit: ScenarioKit, input: { itemId: Id; locationId: Id; qtyBase: number }): Promise<void> {
  if ((await usableAt(kit.db, input.itemId, input.locationId, kit.today())) >= input.qtyBase) return
  await setStockLevel(kit, { ...input, mode: "at-least" })
}

/** An idempotency key unique to this launcher run. */
export const runKey = (kit: ScenarioKit, tag: string) => `${kit.scenarioId}-${tag}-${kit.runId}`

/** A date for a cue card, DD-MM-YYYY in Latin digits (EN) and Bangla digits (BN). */
export function cueDate(iso: ISODate): { en: string; bn: string } {
  const en = isoToDmy(iso)
  return { en, bn: localizeDigits(en, "bn") }
}
