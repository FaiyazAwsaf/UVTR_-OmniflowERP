import type { DatasetLoaders, DatasetRow } from "@/core/reports/types"

import { loadStockRows } from "./queries"

/**
 * IC report dataset loaders (implementation_plan.md §3.19.1). `ic.stock`:
 * item × location (IRT-23 valuation, IRT-25 reorder, IRT-26 expiry);
 * `ic.moves`: every stock move (IRT-24 stock movement).
 */
export const icDatasetLoaders: DatasetLoaders = {
  "ic.stock": async (db, params) => {
    const rows = await loadStockRows(db, { locationId: params.locationId })
    return rows.map(
      (r): DatasetRow => ({
        item: r.item.nameEn,
        itemHref: `/ic/items/${r.item.id}`,
        category: r.category?.nameEn ?? "",
        kind: r.item.kind,
        location: r.location.nameEn,
        qty: r.qtyBase,
        valueP: r.valueP,
        avgCostP: r.qtyBase > 0 ? Math.round((r.valueP / r.qtyBase) * r.item.purchaseFactor) : 0,
        minQty: r.minQty ?? null,
        status: r.status,
        nearestExpiry: r.nearestExpiry ?? null,
      })
    )
  },
  "ic.moves": async (db, params) => {
    const moves = await (params.from || params.to
      ? db.stockMoves
          .where("date")
          .between(params.from ?? "0000-00-00", params.to ?? "9999-12-31", true, true)
          .toArray()
      : db.stockMoves.toArray())
    const items = new Map((await db.items.toArray()).map((i) => [i.id, i]))
    const locations = new Map((await db.locations.toArray()).map((l) => [l.id, l]))
    return moves
      .filter((m) => !params.locationId || m.locationId === params.locationId)
      .sort((a, b) => a.at - b.at)
      .map(
        (m): DatasetRow => ({
          date: m.date,
          item: items.get(m.itemId)?.nameEn ?? m.itemId,
          location: locations.get(m.locationId)?.nameEn ?? m.locationId,
          type: m.type,
          qty: m.qtyBase,
          valueP: m.valueP,
          docNo: m.ref.docNo,
        })
      )
  },
}
