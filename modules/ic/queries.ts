import type { OmniflowDb } from "@/core/db/database"
import type { BatchRow, ISODate, Id, ItemCategoryRow, ItemRow, LocationRow, Poisha } from "@/core/db/schema"
import { roundQty } from "@/core/stock/value"

/**
 * IC Inventory Control queries over committed data (plan §9): stock by item
 * and location with its reorder status and nearest expiry, what is in
 * transit to each location, and reorder suggestions. Used by the screens
 * (inside `useLiveQuery`) and by the report loaders.
 */

export type StockStatus = "ok" | "low" | "out"

export type StockRow = {
  key: string
  item: ItemRow
  category?: ItemCategoryRow
  location: LocationRow
  qtyBase: number
  valueP: Poisha
  quarantinedQty: number
  inTransitQty: number
  minQty?: number
  maxQty?: number
  status: StockStatus
  nearestExpiry?: ISODate
}

export function stockStatus(qty: number, min: number | undefined): StockStatus {
  if (qty <= 0) return "out"
  if (min !== undefined && qty <= min) return "low"
  return "ok"
}

/** Quantity dispatched to each location and not yet received, by item: `${itemId}:${locationId}`. */
export async function inTransitByItem(db: OmniflowDb): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const t of await db.transfers.where("status").equals("dispatched").toArray()) {
    for (const line of await db.transferLines.where("transferId").equals(t.id).toArray()) {
      const key = `${line.itemId}:${t.toLocationId}`
      out.set(key, roundQty((out.get(key) ?? 0) + line.qtySent))
    }
  }
  return out
}

/** Stock rows for every stock location (or one), including items at or below a reorder rule with nothing on hand. */
export async function loadStockRows(db: OmniflowDb, opts: { locationId?: Id; itemId?: Id; today?: ISODate } = {}): Promise<StockRow[]> {
  const [items, categories, locations, values, rules, batches] = await Promise.all([
    db.items.toArray(),
    db.itemCategories.toArray(),
    db.locations.toArray(),
    opts.itemId ? db.stockValues.where("itemId").equals(opts.itemId).toArray() : db.stockValues.toArray(),
    opts.itemId ? db.reorderRules.where("itemId").equals(opts.itemId).toArray() : db.reorderRules.toArray(),
    db.batches.toArray(),
  ])
  const balances = opts.itemId ? await db.stockBalances.where("itemId").equals(opts.itemId).toArray() : await db.stockBalances.toArray()
  const itemById = new Map(items.map((i) => [i.id, i]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  const locById = new Map(locations.map((l) => [l.id, l]))
  const batchById = new Map<Id, BatchRow>(batches.map((b) => [b.id, b]))
  const transit = await inTransitByItem(db)
  const ruleBy = new Map(rules.map((r) => [`${r.itemId}:${r.locationId}`, r]))
  const valueBy = new Map(values.map((v) => [`${v.itemId}:${v.locationId}`, v]))
  const quarantined = new Map<string, number>()
  const nearest = new Map<string, ISODate>()
  for (const b of balances) {
    const key = `${b.itemId}:${b.locationId}`
    if (b.quarantinedQty > 0) quarantined.set(key, roundQty((quarantined.get(key) ?? 0) + b.quarantinedQty))
    const batch = b.batchId ? batchById.get(b.batchId) : undefined
    if (b.qtyBase > 0 && batch?.expiry && batch.status !== "quarantine") {
      const prev = nearest.get(key)
      if (!prev || batch.expiry < prev) nearest.set(key, batch.expiry)
    }
  }
  const keys = new Set<string>([...values.map((v) => `${v.itemId}:${v.locationId}`), ...rules.map((r) => `${r.itemId}:${r.locationId}`)])
  for (const key of quarantined.keys()) keys.add(key)
  const rows: StockRow[] = []
  for (const key of keys) {
    const [itemId, locationId] = key.split(":")
    if (opts.locationId && locationId !== opts.locationId) continue
    const item = itemById.get(itemId)
    const location = locById.get(locationId)
    if (!item || !location) continue
    const value = valueBy.get(key)
    const rule = ruleBy.get(key)
    const qtyBase = roundQty(value?.qtyBase ?? 0)
    rows.push({
      key,
      item,
      category: catById.get(item.categoryId),
      location,
      qtyBase,
      valueP: value?.valueP ?? 0,
      quarantinedQty: quarantined.get(key) ?? 0,
      inTransitQty: transit.get(key) ?? 0,
      minQty: rule?.minQty,
      maxQty: rule?.maxQty,
      status: stockStatus(qtyBase, rule?.minQty),
      nearestExpiry: nearest.get(key),
    })
  }
  return rows.sort((a, b) => (a.location.code + a.item.sku).localeCompare(b.location.code + b.item.sku))
}

export type ReorderSuggestion = {
  key: string
  item: ItemRow
  location: LocationRow
  qtyBase: number
  inTransitQty: number
  onOrderQty: number
  minQty: number
  maxQty: number
  /** Base units needed to reach the maximum */
  needBase: number
  /** In purchase units, rounded up */
  suggestQty: number
  estUnitCostP: Poisha
  vendorId?: Id
}

/**
 * Reorder suggestions (plan §9 /ic/reorder): items whose on hand plus what is
 * coming (in transit, open PO quantities) is at or below the location's
 * minimum; the suggestion fills up to the maximum, in purchase units. The
 * suggested vendor is the item's most recent PO vendor.
 */
export async function loadReorderSuggestions(db: OmniflowDb, locationId?: Id): Promise<ReorderSuggestion[]> {
  const rows = (await loadStockRows(db, { locationId })).filter((r) => r.minQty !== undefined && r.item.status === "active")
  const openPos = (await db.purchaseOrders.toArray()).filter((p) => ["issued", "partial", "pending-approval"].includes(p.status))
  const onOrder = new Map<string, number>()
  for (const po of openPos) {
    for (const line of await db.poLines.where("poId").equals(po.id).toArray()) {
      const item = rows.find((r) => r.item.id === line.itemId)?.item ?? (await db.items.get(line.itemId))
      if (!item) continue
      const open = Math.max(0, line.qty - (line.qtyReceived - line.qtyRejected))
      const key = `${line.itemId}:${po.locationId}`
      onOrder.set(key, roundQty((onOrder.get(key) ?? 0) + open * item.purchaseFactor))
    }
  }
  const lastVendor = new Map<Id, { vendorId: Id; date: string; unitCostP: number }>()
  for (const po of await db.purchaseOrders.toArray()) {
    if (po.status === "cancelled") continue
    for (const line of await db.poLines.where("poId").equals(po.id).toArray()) {
      const prev = lastVendor.get(line.itemId)
      if (!prev || po.orderDate > prev.date) lastVendor.set(line.itemId, { vendorId: po.vendorId, date: po.orderDate, unitCostP: line.unitCostP })
    }
  }
  const out: ReorderSuggestion[] = []
  for (const r of rows) {
    const onOrderQty = onOrder.get(r.key) ?? 0
    const projected = r.qtyBase + r.inTransitQty + onOrderQty
    if (projected > r.minQty!) continue
    const needBase = Math.max(0, roundQty(r.maxQty! - projected))
    if (needBase <= 0) continue
    const last = lastVendor.get(r.item.id)
    out.push({
      key: r.key,
      item: r.item,
      location: r.location,
      qtyBase: r.qtyBase,
      inTransitQty: r.inTransitQty,
      onOrderQty,
      minQty: r.minQty!,
      maxQty: r.maxQty!,
      needBase,
      suggestQty: Math.max(1, Math.ceil(needBase / r.item.purchaseFactor - 1e-9)),
      estUnitCostP: last?.unitCostP ?? r.item.standardCostP,
      vendorId: last?.vendorId,
    })
  }
  return out
}
