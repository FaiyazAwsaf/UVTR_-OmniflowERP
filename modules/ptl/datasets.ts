import type { DatasetLoaders, DatasetRow } from "@/core/reports/types"
import { roundQty } from "@/core/stock/value"

/**
 * PTL report dataset loaders (implementation_plan.md §3.19.1), keyed by
 * dataset code. `ptl.poLines`: one row per PO line (IRT-27 PO status).
 */
export const ptlDatasetLoaders: DatasetLoaders = {
  "ptl.poLines": async (db, params) => {
    const pos = (await db.purchaseOrders.toArray()).filter(
      (po) =>
        (!params.from || po.orderDate >= params.from) &&
        (!params.to || po.orderDate <= params.to) &&
        (!params.locationId || po.locationId === params.locationId)
    )
    const vendors = new Map((await db.parties.bulkGet([...new Set(pos.map((p) => p.vendorId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const items = new Map((await db.items.toArray()).map((i) => [i.id, i]))
    const rows: DatasetRow[] = []
    for (const po of pos) {
      const vendor = vendors.get(po.vendorId)
      for (const line of await db.poLines.where("poId").equals(po.id).toArray()) {
        const accepted = roundQty(line.qtyReceived - line.qtyRejected)
        rows.push({
          orderDate: po.orderDate,
          poNo: po.poNo,
          poHref: `/ptl/po/${po.id}`,
          vendor: vendor?.nameEn ?? "",
          item: items.get(line.itemId)?.nameEn ?? line.itemId,
          ordered: line.qty,
          received: accepted,
          rejected: line.qtyRejected,
          pending: Math.max(0, roundQty(line.qty - accepted)),
          valueP: Math.round(line.qty * line.unitCostP),
          status: po.status,
          expectedDate: po.expectedDate,
        })
      }
    }
    return rows
  },
}
