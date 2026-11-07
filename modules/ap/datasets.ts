import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { DatasetLoaders, DatasetParams } from "@/core/reports/types"

import { apOpenItems } from "@/modules/ar/queries"

const inRange = (date: string, p: DatasetParams) => (!p.from || date >= p.from) && (!p.to || date <= p.to)

/**
 * AP report dataset loaders (implementation_plan.md §3.19.1), keyed by
 * dataset code (fields registered in core/reports/datasets.ts).
 */
export const apDatasetLoaders: DatasetLoaders = {
  /** One row per posted bill with an open amount, aged on today. */
  "ap.openItems": async (db) => {
    const items = await apOpenItems(db, dhakaDate(now()))
    return items.map((i) => ({
      vendor: i.vendor?.nameEn ?? i.bill.partyId,
      partyHref: `/par/${i.bill.partyId}`,
      billNo: i.bill.billNo,
      billHref: `/ap/bills/${i.bill.id}`,
      dueDate: i.bill.dueDate,
      daysPastDue: i.dpd,
      bucket: i.bucket,
      outstandingP: i.openP,
    }))
  },
  /** One row per bill (any status), the purchase side of the VAT story. */
  "ap.bills": async (db, params) => {
    const bills = (await db.vendorBills.toArray()).filter((b) => inRange(b.date, params))
    const parties = new Map((await db.parties.bulkGet([...new Set(bills.map((b) => b.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return bills
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.billNo.localeCompare(b.billNo)))
      .map((b) => ({
        date: b.date,
        billNo: b.billNo,
        billHref: `/ap/bills/${b.id}`,
        vendor: parties.get(b.partyId)?.nameEn ?? b.partyId,
        partyHref: `/par/${b.partyId}`,
        kind: b.kind,
        netP: b.subtotalP,
        vatP: b.inputVatP,
        totalP: b.totalP,
        matchStatus: b.matchStatus,
        hasMushak63: b.hasMushak63 ? "yes" : "no",
      }))
  },
  /** One row per posted vendor payment, with the AIT and VDS withheld. */
  "ap.payments": async (db, params) => {
    const payments = (await db.vendorPayments.where("status").equals("posted").toArray()).filter((p) => inRange(p.date, params))
    const parties = new Map((await db.parties.bulkGet([...new Set(payments.map((p) => p.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return payments
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.paymentNo.localeCompare(b.paymentNo)))
      .map((p) => ({
        date: p.date,
        paymentNo: p.paymentNo,
        paymentHref: `/ap/payments/${p.id}`,
        vendor: parties.get(p.partyId)?.nameEn ?? p.partyId,
        partyHref: `/par/${p.partyId}`,
        method: p.method,
        grossP: p.grossP,
        aitP: p.aitP,
        vdsP: p.vdsP,
        netP: p.netPaidP,
      }))
  },
}
