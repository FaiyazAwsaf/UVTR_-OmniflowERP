import type { OmniflowDb } from "@/core/db/database"
import type { ISODate, Id, ItemRow, SalesOrderLineRow } from "@/core/db/schema"
import { isUsable } from "@/core/stock/fefo"
import { roundQty } from "@/core/stock/value"
import { recipeFor, type Catalogue } from "@/modules/pc/pricing"

/**
 * Stock for a job (plan §10 E3): what the recipes of an order's unfinished
 * service lines will take from the studio shelf, against what FEFO can issue
 * there today (usable stock: batch ok, not expired, never quarantined; the
 * same rule as `usableQty` in core/stock). Reads committed data only, so the
 * order page and launcher setups can both use it.
 */

/** Usable quantity (base units) of an item at a location on a day. */
export async function readUsableQty(db: OmniflowDb, itemId: Id, locationId: Id, on: ISODate): Promise<number> {
  const balances = await db.stockBalances.where("[itemId+locationId]").equals([itemId, locationId]).toArray()
  const batchIds = [...new Set(balances.map((b) => b.batchId).filter((b): b is string => !!b))]
  const batches = new Map((await db.batches.bulkGet(batchIds)).filter(Boolean).map((b) => [b!.id, b!]))
  const usable = balances
    .map((balance) => ({ balance, batch: balance.batchId ? batches.get(balance.batchId) : undefined }))
    .filter((entry) => isUsable(entry, on))
    .reduce((s, entry) => s + entry.balance.qtyBase, 0)
  return roundQty(usable)
}

/** Recipe needs (base units per item) of service lines, scaled by each line's vehicle class. */
export function recipeNeeds(
  catalogue: Pick<Catalogue, "recipes" | "items">,
  lines: Pick<SalesOrderLineRow, "kind" | "refId" | "vehicleClass" | "qty">[]
): Map<Id, number> {
  const needs = new Map<Id, number>()
  for (const line of lines) {
    if (line.kind !== "service") continue
    for (const r of recipeFor(catalogue, line.refId, line.vehicleClass ?? "SD")) {
      needs.set(r.itemId, roundQty((needs.get(r.itemId) ?? 0) + r.qtyBase * (line.qty || 1)))
    }
  }
  return needs
}

export type StockCheckRow = {
  item: ItemRow
  neededQty: number
  usableQty: number
  shortQty: number
  /** What to ask the store for: the shortfall rounded up to whole purchase units */
  requestQty: number
}

/** The shortfall rounded up to the item's purchase factor (a 50 ml kit, a 5 L can). */
export function requestQtyFor(item: Pick<ItemRow, "purchaseFactor">, shortQty: number): number {
  if (shortQty <= 0) return 0
  const factor = item.purchaseFactor > 0 ? item.purchaseFactor : 1
  return roundQty(Math.ceil(roundQty(shortQty / factor) - 1e-9) * factor)
}

/** Needed vs usable per recipe item for an order's unfinished service lines at a location. */
export async function readOrderStockCheck(
  db: OmniflowDb,
  catalogue: Pick<Catalogue, "recipes" | "items">,
  input: { locationId: Id; lines: SalesOrderLineRow[]; on: ISODate }
): Promise<StockCheckRow[]> {
  const open = input.lines.filter((l) => l.kind === "service" && l.status === "open")
  const needs = recipeNeeds(catalogue, open)
  const rows: StockCheckRow[] = []
  for (const [itemId, neededQty] of needs) {
    const item = catalogue.items.get(itemId)
    if (!item || neededQty <= 0) continue
    const usableQty = await readUsableQty(db, itemId, input.locationId, input.on)
    const shortQty = roundQty(Math.max(0, neededQty - usableQty))
    rows.push({ item, neededQty, usableQty, shortQty, requestQty: requestQtyFor(item, shortQty) })
  }
  return rows.sort((a, b) => (b.shortQty > 0 ? 1 : 0) - (a.shortQty > 0 ? 1 : 0) || a.item.sku.localeCompare(b.item.sku))
}
