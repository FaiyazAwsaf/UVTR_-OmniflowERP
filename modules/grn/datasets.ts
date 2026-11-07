import type { DatasetLoaders, DatasetRow } from "@/core/reports/types"

/**
 * GRN report dataset loaders (implementation_plan.md §3.19.1).
 * `grn.lines`: one row per GRN line (IRT-28 GRN register with rejections).
 */
export const grnDatasetLoaders: DatasetLoaders = {
  "grn.lines": async (db, params) => {
    const grns = (await db.grns.toArray()).filter(
      (g) =>
        (!params.from || g.date >= params.from) &&
        (!params.to || g.date <= params.to) &&
        (!params.locationId || g.locationId === params.locationId)
    )
    const items = new Map((await db.items.toArray()).map((i) => [i.id, i]))
    const parties = new Map<string, string>()
    const pos = new Map<string, string>()
    const rows: DatasetRow[] = []
    for (const grn of grns) {
      if (!parties.has(grn.vendorId)) parties.set(grn.vendorId, (await db.parties.get(grn.vendorId))?.nameEn ?? "")
      if (!pos.has(grn.poId)) pos.set(grn.poId, (await db.purchaseOrders.get(grn.poId))?.poNo ?? "")
      for (const line of await db.grnLines.where("grnId").equals(grn.id).toArray()) {
        rows.push({
          date: grn.date,
          grnNo: grn.grnNo,
          grnHref: `/grn/${grn.id}`,
          poNo: pos.get(grn.poId),
          vendor: parties.get(grn.vendorId),
          item: items.get(line.itemId)?.nameEn ?? line.itemId,
          accepted: line.qtyAccepted,
          rejected: line.qtyRejected,
          reason: line.rejectReason ?? null,
          valueP: Math.round(line.qtyAccepted * line.unitCostP),
        })
      }
    }
    return rows
  },
}
