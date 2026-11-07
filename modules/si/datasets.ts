import { invoiceOpen } from "@/core/ar/receipt"
import { now } from "@/core/clock/clock"
import { dhakaDate, startOfDhakaDay } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { DatasetLoaders, DatasetParams, DatasetRow } from "@/core/reports/types"

/**
 * SI report dataset loaders (plan §3.19.1): invoice lines (revenue by
 * service, category, class, advisor; IRT-16 to IRT-18, IRT-22) and
 * invoices (status, due, days past due), each linking to its invoice.
 */

const inRange = (day: string, p: DatasetParams) => (!p.from || day >= p.from) && (!p.to || day <= p.to)
const DAY = 86_400_000

async function invoiceLinesLoader(db: OmniflowDb, p: DatasetParams): Promise<DatasetRow[]> {
  const lines = (await db.salesInvoiceLines.toArray()).filter((l) => inRange(l.date, p) && (!p.locationId || l.locationId === p.locationId))
  const [locations, users, services, items, addOns] = await Promise.all([db.locations.toArray(), db.users.toArray(), db.services.toArray(), db.items.toArray(), db.addOns.toArray()])
  const invoices = new Map((await db.salesInvoices.bulkGet([...new Set(lines.map((l) => l.invoiceId))])).filter(Boolean).map((i) => [i!.id, i!]))
  const parties = new Map((await db.parties.bulkGet([...new Set(lines.map((l) => l.partyId))])).filter(Boolean).map((x) => [x!.id, x!]))
  const location = new Map(locations.map((l) => [l.id, l.nameEn]))
  const user = new Map(users.map((u) => [u.id, u.nameEn]))
  const service = new Map(services.map((s) => [s.id, s]))
  const item = new Map(items.map((i) => [i.id, i]))
  const addOn = new Map(addOns.map((a) => [a.id, a]))
  return lines.map((l) => {
    const sv = l.serviceId ? service.get(l.serviceId) : undefined
    const party = parties.get(l.partyId)
    return {
      date: l.date,
      invoiceNo: invoices.get(l.invoiceId)?.invoiceNo,
      invoiceHref: `/si/${l.invoiceId}`,
      location: location.get(l.locationId),
      party: party?.nameEn,
      segment: party?.segment,
      service: sv?.nameEn ?? (l.itemId ? item.get(l.itemId)?.nameEn : l.addOnId ? addOn.get(l.addOnId)?.nameEn : l.descriptionEn),
      category: sv?.category ?? (l.itemId ? "retail" : (l.addOnId ? addOn.get(l.addOnId)?.appliesTo[0] : null) ?? null),
      vehicleClass: l.vehicleClass ?? null,
      qty: l.qty,
      grossP: Math.round(l.qty * l.unitPriceP),
      discountP: l.discountP,
      netP: l.netP,
      vatP: l.vatP,
      advisor: l.advisorId ? user.get(l.advisorId) : null,
    }
  })
}

async function invoicesLoader(db: OmniflowDb, p: DatasetParams): Promise<DatasetRow[]> {
  const invoices = (await db.salesInvoices.toArray()).filter((i) => inRange(i.date, p) && (!p.locationId || i.locationId === p.locationId))
  const locations = new Map((await db.locations.toArray()).map((l) => [l.id, l.nameEn]))
  const parties = new Map((await db.parties.bulkGet([...new Set(invoices.map((i) => i.partyId))])).filter(Boolean).map((x) => [x!.id, x!]))
  const todayStart = startOfDhakaDay(dhakaDate(now()))
  return invoices.map((i) => {
    const dueP = invoiceOpen(i)
    const late = dueP > 0 ? Math.floor((todayStart - startOfDhakaDay(i.dueDate)) / DAY) : 0
    return {
      date: i.date,
      invoiceNo: i.invoiceNo,
      invoiceHref: `/si/${i.id}`,
      kind: i.kind,
      party: parties.get(i.partyId)?.nameEn,
      location: locations.get(i.locationId),
      totalP: i.totalP,
      paidP: i.paidP + i.advanceAppliedP,
      dueP,
      status: i.status,
      daysPastDue: Math.max(0, late),
    }
  })
}

export const siDatasetLoaders: DatasetLoaders = {
  "si.invoiceLines": invoiceLinesLoader,
  "si.invoices": invoicesLoader,
}
