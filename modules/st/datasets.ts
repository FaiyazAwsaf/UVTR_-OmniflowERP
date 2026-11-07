import { addDaysISO, startOfDhakaDay } from "@/core/clock/dates"
import type { DatasetLoaders, DatasetRow } from "@/core/reports/types"
import { roundQty } from "@/core/stock/value"

/**
 * ST report dataset loaders (implementation_plan.md §3.19.1).
 * `st.transfers`: one row per transfer line (IRT-30 transfer register).
 */
export const stDatasetLoaders: DatasetLoaders = {
  "st.transfers": async (db, params) => {
    const locations = new Map((await db.locations.toArray()).map((l) => [l.id, l]))
    const items = new Map((await db.items.toArray()).map((i) => [i.id, i]))
    const transfers = (await db.transfers.toArray()).filter(
      (t) =>
        (!params.locationId || t.fromLocationId === params.locationId || t.toLocationId === params.locationId) &&
        (!params.from || (t.dispatchedAt ?? t.requestedAt) >= startOfDhakaDay(params.from)) &&
        (!params.to || (t.dispatchedAt ?? t.requestedAt) < startOfDhakaDay(addDaysISO(params.to, 1)))
    )
    const rows: DatasetRow[] = []
    for (const t of transfers) {
      for (const line of await db.transferLines.where("transferId").equals(t.id).toArray()) {
        const received = t.status === "received" ? line.qtyReceived : 0
        rows.push({
          transferNo: t.transferNo,
          transferHref: `/st/transfers/${t.id}`,
          from: locations.get(t.fromLocationId)?.nameEn ?? t.fromLocationId,
          to: locations.get(t.toLocationId)?.nameEn ?? t.toLocationId,
          item: items.get(line.itemId)?.nameEn ?? line.itemId,
          sent: line.qtySent,
          received,
          shortfall: t.status === "received" ? roundQty(line.qtySent - line.qtyReceived) : 0,
          status: t.status,
        })
      }
    }
    return rows
  },
}
