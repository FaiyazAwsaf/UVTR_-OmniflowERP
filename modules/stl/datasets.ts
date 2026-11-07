import { dhakaDate, dhakaTime } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { DatasetLoaders, DatasetParams, DatasetRow } from "@/core/reports/types"
import { readCatalogue } from "@/modules/pc/catalogue"

/**
 * STL report dataset loaders (plan §3.19.1): orders, job tasks and
 * consumption (standard recipe vs actual issues), with drill-down links to
 * the order. Names are English (the report renderer shows them as stored).
 */

const inRange = (day: string, p: DatasetParams) => (!p.from || day >= p.from) && (!p.to || day <= p.to)
const HOUR = 3_600_000

async function names(db: OmniflowDb) {
  const [locations, users] = await Promise.all([db.locations.toArray(), db.users.toArray()])
  return {
    location: new Map(locations.map((l) => [l.id, l.nameEn])),
    user: new Map(users.map((u) => [u.id, u.nameEn])),
  }
}

async function ordersLoader(db: OmniflowDb, p: DatasetParams): Promise<DatasetRow[]> {
  const orders = (await db.salesOrders.toArray()).filter((o) => inRange(o.bookedOn, p) && (!p.locationId || o.locationId === p.locationId))
  const n = await names(db)
  const parties = new Map((await db.parties.bulkGet([...new Set(orders.map((o) => o.partyId))])).filter(Boolean).map((x) => [x!.id, x!]))
  const vehicles = new Map((await db.vehicles.bulkGet([...new Set(orders.map((o) => o.vehicleId).filter((v): v is string => !!v))])).filter(Boolean).map((v) => [v!.id, v!]))
  return orders.map((o) => {
    const end = o.deliveredAt ?? o.readyAt
    return {
      bookedOn: o.bookedOn,
      orderNo: o.orderNo,
      orderHref: `/stl/orders/${o.id}`,
      promisedAt: dhakaDate(o.promisedAt),
      deliveredAt: o.deliveredAt ? dhakaDate(o.deliveredAt) : null,
      location: n.location.get(o.locationId),
      party: parties.get(o.partyId)?.nameEn,
      vehicleClass: o.vehicleId ? vehicles.get(o.vehicleId)?.vehicleClass : null,
      kind: o.kind,
      status: o.status,
      totalP: o.totalP,
      turnaroundHours: end ? Math.round(((end - (o.startedAt ?? o.scheduledAt)) / HOUR) * 10) / 10 : null,
      late: end ? (end > o.promisedAt ? "yes" : "no") : null,
      advisor: n.user.get(o.advisorId),
    }
  })
}

async function tasksLoader(db: OmniflowDb, p: DatasetParams): Promise<DatasetRow[]> {
  const tasks = (await db.jobTasks.toArray()).filter((x) => inRange(dhakaDate(x.plannedStart), p) && (!p.locationId || x.locationId === p.locationId))
  const n = await names(db)
  const [bays, services] = await Promise.all([db.bays.toArray(), db.services.toArray()])
  const bay = new Map(bays.map((b) => [b.id, b.code]))
  const service = new Map(services.map((s) => [s.id, s.nameEn]))
  return tasks.map((x) => ({
    date: dhakaDate(x.startedAt ?? x.plannedStart),
    technician: n.user.get(x.technicianId),
    service: x.serviceId ? service.get(x.serviceId) : "Add-on",
    bay: bay.get(x.bayId),
    location: n.location.get(x.locationId),
    minutes: x.minutes ?? (x.status === "done" ? x.plannedMinutes : null),
    startedAt: x.startedAt ? dhakaTime(x.startedAt) : null,
    finishedAt: x.finishedAt ? dhakaTime(x.finishedAt) : null,
    orderHref: `/stl/orders/${x.orderId}`,
  }))
}

async function consumptionLoader(db: OmniflowDb, p: DatasetParams): Promise<DatasetRow[]> {
  const rows = (await db.jobConsumptions.toArray()).filter((c) => inRange(dhakaDate(c.at), p) && (!p.locationId || c.locationId === p.locationId))
  const n = await names(db)
  const catalogue = await readCatalogue(db)
  const orders = new Map((await db.salesOrders.bulkGet([...new Set(rows.map((r) => r.orderId))])).filter(Boolean).map((o) => [o!.id, o!]))
  const lines = new Map((await db.salesOrderLines.bulkGet([...new Set(rows.map((r) => r.orderLineId).filter((v): v is string => !!v))])).filter(Boolean).map((l) => [l!.id, l!]))
  // One row per order, line and item: standard (the recipe), actual (net of extras and returns).
  const grouped = new Map<string, DatasetRow & { stdValue: number; actualValue: number }>()
  for (const c of rows) {
    const key = `${c.orderId}:${c.orderLineId ?? "-"}:${c.itemId}`
    const order = orders.get(c.orderId)
    const line = c.orderLineId ? lines.get(c.orderLineId) : undefined
    const item = catalogue.items.get(c.itemId)
    let g = grouped.get(key)
    if (!g) {
      g = {
        date: dhakaDate(c.at),
        orderNo: order?.orderNo,
        orderHref: `/stl/orders/${c.orderId}`,
        service: line?.kind === "service" ? catalogue.services.get(line.refId)?.nameEn : "Extra",
        item: item ? `${item.sku} ${item.nameEn}` : c.itemId,
        location: n.location.get(c.locationId),
        technician: n.user.get(c.by),
        standardQty: 0,
        actualQty: 0,
        varianceQty: 0,
        varianceValueP: 0,
        stdValue: 0,
        actualValue: 0,
      }
      grouped.set(key, g)
    }
    g.standardQty = Number(g.standardQty) + c.standardQty
    g.actualQty = Number(g.actualQty) + c.actualQty
    g.actualValue += c.valueP
    if (c.kind === "recipe") g.stdValue += c.valueP
  }
  return [...grouped.values()].map(({ stdValue, actualValue, ...g }) => {
    const std = Number(g.standardQty)
    const actual = Math.round(Number(g.actualQty) * 1000) / 1000
    const unit = std > 0 ? stdValue / std : actual !== 0 ? actualValue / actual : 0
    return { ...g, actualQty: actual, varianceQty: Math.round((actual - std) * 1000) / 1000, varianceValueP: Math.round((actual - std) * unit) }
  })
}

export const stlDatasetLoaders: DatasetLoaders = {
  "stl.orders": ordersLoader,
  "stl.tasks": tasksLoader,
  "stl.consumption": consumptionLoader,
}
