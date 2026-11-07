import { locations } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { DatasetLoaders, DatasetParams } from "@/core/reports/types"

import { arOpenItems } from "./queries"

const locationName = (id: string) => locations.find((l) => l.id === id)?.name.en ?? id

const inRange = (date: string, p: DatasetParams) => (!p.from || date >= p.from) && (!p.to || date <= p.to)

/**
 * AR report dataset loaders (implementation_plan.md §3.19.1), keyed by
 * dataset code (fields registered in core/reports/datasets.ts).
 */
export const arDatasetLoaders: DatasetLoaders = {
  /** One row per open invoice, aged on today (demo clock). */
  "ar.openItems": async (db, params) => {
    const today = dhakaDate(now())
    const items = await arOpenItems(db, today)
    return items
      .filter((i) => !params.locationId || i.invoice.locationId === params.locationId)
      .map((i) => ({
        party: i.party?.nameEn ?? i.invoice.partyId,
        partyHref: `/par/${i.invoice.partyId}`,
        invoiceNo: i.invoice.invoiceNo,
        invoiceHref: `/si/${i.invoice.id}`,
        location: locationName(i.invoice.locationId),
        dueDate: i.invoice.dueDate,
        daysPastDue: i.dpd,
        bucket: i.bucket,
        outstandingP: i.openP,
      }))
  },
  /** One row per receipt that posted (counter, deposits, AR receipts, cleared cheques). */
  "ar.receipts": async (db, params) => {
    const receipts = (await db.receipts.where("status").equals("posted").toArray()).filter(
      (r) => inRange(r.date, params) && (!params.locationId || r.locationId === params.locationId)
    )
    const parties = new Map((await db.parties.bulkGet([...new Set(receipts.map((r) => r.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return receipts
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.receiptNo.localeCompare(b.receiptNo)))
      .map((r) => ({
        date: r.date,
        receiptNo: r.receiptNo,
        receiptHref: `/ar/receipts?id=${r.id}`,
        party: parties.get(r.partyId)?.nameEn ?? r.partyId,
        partyHref: `/par/${r.partyId}`,
        method: r.method,
        amountP: r.amountP,
        vdsP: r.vdsDeductedP,
        aitP: r.aitDeductedP,
        location: locationName(r.locationId),
      }))
  },
}
