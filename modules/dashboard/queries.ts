import { locations as LOCATIONS, type LocationCode } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { addDaysISO, atDhaka, dhakaDate, MINUTE } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { readSetting } from "@/core/db/settings"
import type { AccountTag, ISODate, Id, JobTaskRow, Poisha, ReportDefinitionRow, SalesOrderRow } from "@/core/db/schema"
import { profitAndLoss } from "@/core/ledger/statements"
import { DATASET_LOADERS } from "@/core/reports/loaders"
import { runReport, type ReportDefinitionLike } from "@/core/reports/runner"
import { SYSTEM_REPORTS } from "@/core/seed/generators/reports"
import { invoiceAvailable } from "@/core/ar/receipt"
import { canDecide } from "@/core/approvals/approvals"
import { resolveSecurity } from "@/core/security/resolve"
import { ROLE_CODES, type RoleCode } from "@/core/security/types"
import { arOpenItems, apOpenItems } from "@/modules/ar/queries"
import { cashPosition } from "@/modules/cab/queries"

import type {
  AlertFigure,
  CashAccountFigure,
  CollectionFigures,
  DashPeriod,
  DayRange,
  FinanceFigures,
  HomeKpi,
  PositionFigures,
  RevenueTrend,
  RoleHomeData,
  StudioOps,
  StudioOrder,
  StudioStatusKey,
  TodoItem,
  TopService,
  TrendPoint,
} from "./types"

/**
 * Read-side loaders of the executive dashboard, the role homes and the STL
 * studio home (plan §9). Each takes the database and plain parameters, so the
 * screens run them inside `useLiveQuery` (a commit in any window re-runs
 * them) and the tests call them directly. Every figure reuses the function
 * its drill-down uses: the P&L builder (`profitAndLoss`), the IRT runner and
 * dataset loaders, the AR and AP open items and the CAB cash position.
 */

/* ---------------- Periods and links ---------------- */

const monthStart = (day: ISODate) => `${day.slice(0, 7)}-01`

/** The days a period covers on `today`: today, month to date, or the whole of last month. */
export function periodRange(period: DashPeriod, today: ISODate): DayRange {
  if (period === "today") return { from: today, to: today }
  if (period === "mtd") return { from: monthStart(today), to: today }
  const to = addDaysISO(monthStart(today), -1)
  return { from: monthStart(to), to }
}

/**
 * What a period is compared with: month to date against the same days of
 * last month (capped at its end); last month against the month before. Today
 * has no comparison (a part day against a whole one would mislead).
 */
export function compareRange(period: DashPeriod, today: ISODate): DayRange | null {
  if (period === "today") return null
  const { from, to } = periodRange(period, today)
  const prevEnd = addDaysISO(from, -1)
  const prevFrom = monthStart(prevEnd)
  if (period === "last-month") return { from: prevFrom, to: prevEnd }
  const sameDay = `${prevFrom.slice(0, 7)}-${to.slice(8, 10)}`
  return { from: prevFrom, to: sameDay > prevEnd ? prevEnd : sameDay }
}

/** "/irt/run/IRT-16?from=…&to=…&loc=…": the runner reads these parameters. */
export function irtHref(code: string, range?: DayRange | null, locationId?: Id | null): string {
  const q = new URLSearchParams()
  if (range) {
    q.set("from", range.from)
    q.set("to", range.to)
  }
  if (locationId) q.set("loc", locationId)
  const s = q.toString()
  return `/irt/run/${code}${s ? `?${s}` : ""}`
}

export const locationCode = (id: Id | null | undefined): LocationCode | undefined => LOCATIONS.find((l) => l.id === id)?.code
export const STUDIO_IDS = LOCATIONS.filter((l) => l.kind === "studio").map((l) => l.id)
export const isStudio = (id: Id | null | undefined) => !!id && STUDIO_IDS.includes(id)

/* ---------------- Report definitions ---------------- */

/** A system report's definition: the seeded row (what IRT runs), else the seed's own definition. */
export async function reportDefinition(db: OmniflowDb, code: string): Promise<ReportDefinitionLike & Pick<ReportDefinitionRow, "code">> {
  const [row] = await db.reportDefinitions.where("code").equals(code).toArray()
  if (row?.dataset) return row
  const def = SYSTEM_REPORTS.find((r) => r.code === code)
  if (!def?.dataset) throw new Error(`no dataset report ${code}`)
  return { code, dataset: def.dataset, columns: def.columns, filters: def.filters ?? [], groupBy: def.groupBy, sort: def.sort, totals: def.totals }
}

/* ---------------- Finance (P&L) ---------------- */

/**
 * Revenue today, for the period and its comparison, and gross margin, all
 * from `profitAndLoss` over the posted ledger (the FRS P&L's own builder):
 * net revenue = service revenue + product sales − discounts, net of VAT;
 * gross profit = net revenue − cost of sales.
 */
export async function loadFinance(
  db: OmniflowDb,
  p: { today: ISODate; period: DashPeriod; locationId?: Id | null }
): Promise<FinanceFigures> {
  const range = periodRange(p.period, p.today)
  const compare = compareRange(p.period, p.today)
  const start = [range.from, p.today, compare?.from ?? p.today].sort()[0]
  const end = [range.to, p.today].sort().reverse()[0]
  const [accounts, lines, invoices] = await Promise.all([
    db.accounts.toArray(),
    db.journalLines.where("date").between(start, end, true, true).toArray(),
    db.salesInvoices.where("date").equals(p.today).toArray(),
  ])
  const locationId = p.locationId ?? null
  const period = profitAndLoss(accounts, lines, { ...range, locationId })
  const day = profitAndLoss(accounts, lines, { from: p.today, to: p.today, locationId })
  const prior = compare ? profitAndLoss(accounts, lines, { ...compare, locationId }) : null
  return {
    revenueTodayP: day.netRevenueP,
    revenuePeriodP: period.netRevenueP,
    revenueCompareP: prior ? prior.netRevenueP : null,
    grossProfitP: period.grossProfitP,
    costOfSalesP: period.totals.costOfSales,
    marginPct: period.netRevenueP ? (period.grossProfitP / period.netRevenueP) * 100 : null,
    invoicesToday: invoices.filter((i) => !locationId || i.locationId === locationId).length,
    period,
  }
}

/** Receipts that posted in a range: exactly the rows of the IRT-07 receipts register. */
export async function loadCollections(db: OmniflowDb, p: DayRange & { locationId?: Id | null }): Promise<CollectionFigures> {
  const loader = DATASET_LOADERS["ar.receipts"]
  const rows = loader ? await loader(db, { from: p.from, to: p.to, locationId: p.locationId ?? undefined }) : []
  const byMethod: Record<string, Poisha> = {}
  let totalP = 0
  for (const r of rows) {
    const amount = Number(r.amountP) || 0
    totalP += amount
    const method = String(r.method)
    byMethod[method] = (byMethod[method] ?? 0) + amount
  }
  return { totalP, count: rows.length, byMethod }
}

/* ---------------- Positions now ---------------- */

const INVENTORY_TAGS: AccountTag[] = ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"]

/** The location a cash or bank account belongs to: its own, else Head Office (banks, wallets, card clearing). */
export const cashAccountLocation = (locationId?: Id | null): Id => locationId ?? "loc_hq"

/**
 * Receivables and overdue from the AR open items (= AR_CONTROL in total; by
 * the invoice's location with a filter), payables due within 7 days and
 * overdue from the AP open items (company-wide), cash and bank per account
 * from the CAB cash position (= the GL), stock value per location from the
 * inventory accounts (= Σ stock values, IRT-23) and what is in transit.
 */
export async function loadPositions(db: OmniflowDb, p: { today: ISODate; locationId?: Id | null }): Promise<PositionFigures> {
  const locationId = p.locationId ?? null
  const [ar, ap, position, map] = await Promise.all([
    arOpenItems(db, p.today),
    apOpenItems(db, p.today),
    cashPosition(db, p.today),
    readSetting(db, "postingAccounts").catch(() => ({}) as Record<AccountTag, Id>),
  ])
  const buckets = { current: 0, d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 }
  let receivablesP = 0
  let receivableCount = 0
  let overdueP = 0
  let overdueCount = 0
  for (const i of ar) {
    if (locationId && i.invoice.locationId !== locationId) continue
    receivablesP += i.openP
    receivableCount += 1
    buckets[i.bucket] += i.openP
    if (i.dpd > 0) {
      overdueP += i.openP
      overdueCount += 1
    }
  }
  const week = addDaysISO(p.today, 7)
  let payablesDueP = 0
  let payablesDueCount = 0
  let payablesOverdueP = 0
  let payablesOpenP = 0
  for (const i of ap) {
    payablesOpenP += i.openP
    if (i.dpd > 0) payablesOverdueP += i.openP
    if (i.dpd > 0 || i.bill.dueDate <= week) {
      payablesDueP += i.openP
      payablesDueCount += 1
    }
  }
  const cash: CashAccountFigure[] = position
    .map((r) => ({
      id: r.account.id,
      code: r.account.code,
      nameEn: r.account.nameEn,
      nameBn: r.account.nameBn,
      kind: r.account.kind,
      locationId: cashAccountLocation(r.account.locationId),
      balanceP: r.balanceP,
    }))
    .filter((r) => !locationId || r.locationId === locationId)
  const invIds = new Set(INVENTORY_TAGS.map((t) => map[t]).filter(Boolean))
  const transitId = map.INV_TRANSIT
  const ids = [...invIds, ...(transitId ? [transitId] : [])]
  const lines = ids.length ? await db.journalLines.where("accountId").anyOf(ids).toArray() : []
  const byLoc = new Map<Id, Poisha>()
  let inTransitP = 0
  for (const l of lines) {
    if (l.date > p.today) continue
    const net = l.debitP - l.creditP
    if (l.accountId === transitId) {
      if (!locationId || l.locationId === locationId) inTransitP += net
      continue
    }
    const loc = l.locationId ?? "-"
    byLoc.set(loc, (byLoc.get(loc) ?? 0) + net)
  }
  const stockByLocation = LOCATIONS.filter((l) => l.isStockLocation && (!locationId || l.id === locationId)).map((l) => ({
    locationId: l.id,
    valueP: byLoc.get(l.id) ?? 0,
  }))
  return {
    receivablesP,
    receivableCount,
    overdueP,
    overdueCount,
    buckets,
    payablesDueP,
    payablesDueCount,
    payablesOverdueP,
    payablesOpenP,
    cash,
    cashTotalP: cash.reduce((s, r) => s + r.balanceP, 0),
    stockByLocation,
    stockTotalP: stockByLocation.reduce((s, r) => s + r.valueP, 0),
    inTransitP,
  }
}

/* ---------------- Studios today ---------------- */

export const OPEN_HOUR: string = "09:00"
export const DAY_MINUTES = 12 * 60
const ACTIVE = new Set(["booked", "in-progress", "qc", "ready"])
const DONE = new Set(["delivered", "invoiced", "closed"])
const LATE_STATUSES = new Set(["booked", "in-progress", "qc"])

/** A job counts as late when it is booked, in progress or in QC and its promised time has passed (the job board's rule). */
export const isLate = (o: Pick<SalesOrderRow, "status" | "promisedAt">, nowMs: number) => LATE_STATUSES.has(o.status) && nowMs > 0 && o.promisedAt < nowMs

/** The board column of an order today, or null when it is not on today's board. */
export function boardStatus(o: Pick<SalesOrderRow, "status" | "deliveredAt">, today: ISODate): StudioStatusKey | null {
  if (ACTIVE.has(o.status)) return o.status as StudioStatusKey
  if (DONE.has(o.status) && o.deliveredAt && dhakaDate(o.deliveredAt) === today) return "delivered"
  return null
}

/** Minutes of [start, end) intervals covered at least once (a bay holds one job however many technicians work it). */
export function coveredMinutes(intervals: [number, number][]): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let curStart = -Infinity
  let curEnd = -Infinity
  for (const [a, b] of sorted) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart
      curStart = a
      curEnd = b
    } else if (b > curEnd) curEnd = b
  }
  if (curEnd > curStart) total += curEnd - curStart
  return Math.round(total / MINUTE)
}

/**
 * One studio today: orders per board column (booked, in progress, QC and
 * ready, plus delivered today), late jobs, and bay utilisation: the minutes
 * of 09:00 to 21:00 covered by tasks scheduled in each bay (tasks of
 * cancelled orders left out, as on the board's bay lanes) over the bays'
 * minutes.
 */
export async function loadStudioOps(db: OmniflowDb, p: { locationId: Id; today: ISODate; nowMs: number }): Promise<StudioOps> {
  const dayStart = atDhaka(p.today, OPEN_HOUR)
  const dayEnd = dayStart + DAY_MINUTES * MINUTE
  const [orders, bays, tasks] = await Promise.all([
    db.salesOrders.where("locationId").equals(p.locationId).toArray(),
    db.bays.where("locationId").equals(p.locationId).toArray(),
    db.jobTasks.where("plannedStart").between(dayStart - 3 * 24 * 60 * MINUTE, dayEnd).toArray(),
  ])
  const counts: Record<StudioStatusKey, number> = { booked: 0, "in-progress": 0, qc: 0, ready: 0, delivered: 0 }
  let late = 0
  for (const o of orders) {
    const s = boardStatus(o, p.today)
    if (s) counts[s] += 1
    if (isLate(o, p.nowMs)) late += 1
  }
  const ops = await bayUse(db, tasks.filter((x) => x.locationId === p.locationId), bays.filter((b) => b.active), dayStart, dayEnd)
  return { locationId: p.locationId, code: locationCode(p.locationId) ?? "GUL", counts, late, ...ops }
}

async function bayUse(db: OmniflowDb, tasks: JobTaskRow[], bays: { id: Id; code: string }[], dayStart: number, dayEnd: number) {
  const orders = new Map((await db.salesOrders.bulkGet([...new Set(tasks.map((x) => x.orderId))])).filter(Boolean).map((o) => [o!.id, o!]))
  const live = tasks.filter((x) => orders.get(x.orderId)?.status !== "cancelled")
  const sortedBays = [...bays].sort((a, b) => a.code.localeCompare(b.code))
  const perBay = sortedBays.map((bay) => {
    const intervals: [number, number][] = live
      .filter((x) => x.bayId === bay.id)
      .map((x) => [Math.max(dayStart, x.plannedStart), Math.min(dayEnd, x.plannedStart + x.plannedMinutes * MINUTE)])
    const minutes = coveredMinutes(intervals)
    return { bayId: bay.id, code: bay.code, minutes, pct: (minutes / DAY_MINUTES) * 100 }
  })
  const bayMinutes = sortedBays.length * DAY_MINUTES
  const scheduledMinutes = perBay.reduce((s, b) => s + b.minutes, 0)
  return {
    bayCount: sortedBays.length,
    bayMinutes,
    scheduledMinutes,
    utilisationPct: bayMinutes ? (scheduledMinutes / bayMinutes) * 100 : 0,
    bays: perBay,
  }
}

/* ---------------- Revenue trend and top services (IRT) ---------------- */

const codeByName = new Map(LOCATIONS.map((l) => [l.name.en, l.code]))

/**
 * Revenue by day and studio over the last `days` days: the IRT-16 report
 * ("revenue by service category and studio") run through the IRT runner, so
 * its studio totals are the report's totals for the same days.
 */
export async function loadRevenueTrend(db: OmniflowDb, p: { today: ISODate; locationId?: Id | null; days?: number }): Promise<RevenueTrend> {
  const days = p.days ?? 30
  const from = addDaysISO(p.today, -(days - 1))
  const to = p.today
  const def = await reportDefinition(db, "IRT-16")
  const result = await runReport(db, def, { from, to, locationId: p.locationId ?? undefined })
  const byDate = new Map<string, TrendPoint>()
  for (let d = from; d <= to; d = addDaysISO(d, 1)) byDate.set(d, { date: d, total: 0 })
  const byLocation: Partial<Record<LocationCode, Poisha>> = {}
  for (const row of result.rows) {
    const code = codeByName.get(String(row.location))
    const point = byDate.get(String(row.date))
    const net = Number(row.netP) || 0
    if (!code || !point) continue
    point[code] = (point[code] ?? 0) + net
    point.total += net
    byLocation[code] = (byLocation[code] ?? 0) + net
  }
  const studios = LOCATIONS.filter((l) => l.kind === "studio" && (!p.locationId || l.id === p.locationId)).map((l) => l.code)
  const extra = (Object.keys(byLocation) as LocationCode[]).filter((c) => !studios.includes(c))
  const series = [...studios, ...extra]
  const points = [...byDate.values()].map((pt) => {
    for (const c of series) pt[c] = pt[c] ?? 0
    return pt
  })
  return { from, to, points, byLocation, totalP: result.totals.netP ?? 0, series }
}

/** The period's top services by revenue (the IRT-18 report: invoice lines grouped by service). */
export async function loadTopServices(
  db: OmniflowDb,
  p: DayRange & { locationId?: Id | null; limit?: number }
): Promise<{ top: TopService[]; totalP: Poisha; totalQty: number; groups: number }> {
  const def = await reportDefinition(db, "IRT-18")
  const [result, services, items, addOns] = await Promise.all([
    runReport(db, def, { from: p.from, to: p.to, locationId: p.locationId ?? undefined }),
    db.services.toArray(),
    db.items.toArray(),
    db.addOns.toArray(),
  ])
  const bn = new Map<string, string>()
  for (const r of [...items, ...addOns, ...services]) bn.set(r.nameEn, r.nameBn)
  const top = (result.groups ?? [])
    .map((g) => {
      const name = String(g.key.service ?? "")
      return {
        key: name,
        nameEn: name,
        nameBn: bn.get(name) ?? name,
        category: (g.rows[0]?.category as string | null | undefined) ?? null,
        qty: g.totals.qty ?? 0,
        lines: g.count,
        netP: g.totals.netP ?? 0,
      }
    })
    .sort((a, b) => b.netP - a.netP || b.qty - a.qty || a.key.localeCompare(b.key))
  return { top: top.slice(0, p.limit ?? 5), totalP: result.totals.netP ?? 0, totalQty: result.totals.qty ?? 0, groups: top.length }
}

/* ---------------- Alerts ---------------- */

/**
 * What needs attention: items at or below their reorder level (the IRT-25
 * reorder report's rows), lots expiring within `rules.expiryWarnDays` (the
 * IC expiry watch), lots held in quarantine, pending approvals, vendor bills
 * on hold and received post-dated cheques due within `rules.pdcWarnDays`.
 * Bills on hold and cheques are company-wide; the rest follow the location.
 */
export async function loadAlerts(db: OmniflowDb, p: { today: ISODate; locationId?: Id | null }): Promise<AlertFigure[]> {
  const locationId = p.locationId ?? null
  const reorderDef = await reportDefinition(db, "IRT-25")
  const cutoff = addDaysISO(p.today, rules.expiryWarnDays)
  const pdcCutoff = addDaysISO(p.today, rules.pdcWarnDays)
  const [reorder, batches, held, approvals, onHold, cheques] = await Promise.all([
    runReport(db, reorderDef, { locationId: locationId ?? undefined }),
    db.batches.where("expiry").belowOrEqual(cutoff).toArray(),
    db.grnLines.where("quarantineStatus").equals("held").toArray(),
    db.approvals.where("status").equals("pending").toArray(),
    db.vendorBills.where("status").equals("on-hold").toArray(),
    db.cheques.where("status").equals("in-hand").toArray(),
  ])
  let expiring = 0
  for (const batch of batches) {
    if (!batch.expiry) continue
    for (const b of await db.stockBalances.where("batchId").equals(batch.id).toArray()) {
      if (b.qtyBase + b.quarantinedQty <= 0) continue
      if (locationId && b.locationId !== locationId) continue
      expiring += 1
    }
  }
  const grns = new Map((await db.grns.bulkGet([...new Set(held.map((l) => l.grnId))])).filter(Boolean).map((g) => [g!.id, g!]))
  const quarantine = held.filter((l) => !locationId || grns.get(l.grnId)?.locationId === locationId).length
  const pdc = cheques.filter((c) => c.direction === "received" && c.chequeDate <= pdcCutoff).length
  const loc = locationId ? `?loc=${locationId}` : ""
  return [
    { kind: "approvals", count: approvals.filter((a) => !locationId || a.locationId === locationId).length, href: "/approvals", companyWide: false },
    { kind: "bills-on-hold", count: onHold.length, href: "/ap/bills", companyWide: true },
    { kind: "pdc-due", count: pdc, href: "/cab/cheques", companyWide: true },
    { kind: "reorder", count: reorder.rowCount, href: `/irt/run/IRT-25${loc}`, companyWide: false },
    { kind: "expiring", count: expiring, href: "/ic/expiry", companyWide: false },
    { kind: "quarantine", count: quarantine, href: "/grn/quarantine", companyWide: false },
  ]
}

/* ---------------- STL studio home ---------------- */

/**
 * The studio home of one studio today (plan §9 `/stl`): today's orders by
 * status (the job board's columns), bookings scheduled to start today by
 * time with bay and technicians, late jobs, revenue today (P&L at the
 * studio), deposits taken today (posted booking deposits) and bay use.
 */
export async function loadStudioHome(
  db: OmniflowDb,
  p: { locationId: Id; today: ISODate; nowMs: number }
): Promise<{ orders: StudioOrder[]; bookings: StudioOrder[]; late: StudioOrder[]; ops: StudioOps; revenueTodayP: Poisha; depositsTodayP: Poisha; depositsCount: number }> {
  const dayStart = atDhaka(p.today, "00:00")
  const dayEnd = dayStart + 24 * 60 * MINUTE
  const [all, ops, finance, receipts] = await Promise.all([
    db.salesOrders.where("locationId").equals(p.locationId).toArray(),
    loadStudioOps(db, p),
    loadFinance(db, { today: p.today, period: "today", locationId: p.locationId }),
    db.receipts.where("date").equals(p.today).toArray(),
  ])
  const onBoard = all.filter((o) => boardStatus(o, p.today))
  const booked = all.filter((o) => o.status !== "cancelled" && o.scheduledAt >= dayStart && o.scheduledAt < dayEnd)
  const wanted = [...new Map([...onBoard, ...booked].map((o) => [o.id, o])).values()]
  const ids = wanted.map((o) => o.id)
  const [lines, tasks, bays, users, vehicles, parties] = await Promise.all([
    db.salesOrderLines.where("orderId").anyOf(ids).toArray(),
    db.jobTasks.where("orderId").anyOf(ids).toArray(),
    db.bays.where("locationId").equals(p.locationId).toArray(),
    db.users.toArray(),
    db.vehicles.bulkGet([...new Set(wanted.map((o) => o.vehicleId).filter((v): v is string => !!v))]),
    db.parties.bulkGet([...new Set(wanted.map((o) => o.partyId))]),
  ])
  const services = new Map((await db.services.toArray()).map((s) => [s.id, s.code]))
  const userBy = new Map(users.map((u) => [u.id, u]))
  const bayBy = new Map(bays.map((b) => [b.id, b.code]))
  const vehicleBy = new Map(vehicles.filter(Boolean).map((v) => [v!.id, v!]))
  const partyBy = new Map(parties.filter(Boolean).map((x) => [x!.id, x!]))
  const view = (o: SalesOrderRow): StudioOrder => {
    const vehicle = o.vehicleId ? vehicleBy.get(o.vehicleId) : undefined
    const party = partyBy.get(o.partyId)
    const techIds = [...new Set(tasks.filter((x) => x.orderId === o.id).map((x) => x.technicianId))]
    const bayId = o.bayId ?? tasks.find((x) => x.orderId === o.id)?.bayId
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: boardStatus(o, p.today) ?? (DONE.has(o.status) ? "delivered" : "booked"),
      partyEn: party?.nameEn ?? "",
      partyBn: party?.nameBn ?? party?.nameEn ?? "",
      regNo: vehicle?.regNo,
      vehicle: vehicle ? `${vehicle.make} ${vehicle.model}` : undefined,
      vehicleClass: vehicle?.vehicleClass,
      scheduledAt: o.scheduledAt,
      promisedAt: o.promisedAt,
      bayCode: bayId ? bayBy.get(bayId) : undefined,
      technicians: techIds.map((id) => ({ id, en: userBy.get(id)?.nameEn ?? id, bn: userBy.get(id)?.nameBn ?? id })),
      services: lines
        .filter((l) => l.orderId === o.id && l.kind === "service" && l.status !== "cancelled")
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((l) => services.get(l.refId) ?? l.descriptionEn),
      totalP: o.totalP,
      late: isLate(o, p.nowMs),
    }
  }
  const orders = onBoard.map(view).sort((a, b) => a.promisedAt - b.promisedAt)
  const bookings = booked.map(view).sort((a, b) => a.scheduledAt - b.scheduledAt || a.orderNo.localeCompare(b.orderNo))
  const deposits = receipts.filter((r) => r.locationId === p.locationId && r.orderId && r.status === "posted")
  return {
    orders,
    bookings,
    late: orders.filter((o) => o.late),
    ops,
    revenueTodayP: finance.revenueTodayP,
    depositsTodayP: deposits.reduce((s, r) => s + r.amountP, 0),
    depositsCount: deposits.length,
  }
}

/** The month ("YYYY-MM") a range ends in (the FRS P&L's `?month=`). */
export const monthOfRange = (range: DayRange) => range.to.slice(0, 7)

/* ---------------- Role homes ---------------- */

/** The role a home is built for when a user holds several (the order of plan §8). */
export function primaryRole(roleCodes: readonly string[]): RoleCode | "NONE" {
  return ROLE_CODES.find((r) => roleCodes.includes(r)) ?? "NONE"
}

/** Roles whose home is scoped to one studio (the window's location when it is theirs). */
const STUDIO_BOUND: ReadonlySet<string> = new Set(["STUDIO_MGR", "ADVISOR", "CASHIER", "TECHNICIAN"])

const CREDIT_SEGMENTS = new Set(["fleet", "dealer", "corporate"])
/** Sign-ins and housekeeping that would crowd the auditor's recent activity. */
const QUIET_COMMANDS: ReadonlySet<string> = new Set(["sac.signIn", "sac.signOut", "sac.verifyMfa", "sac.timeoutSessions", "notifications.markRead", "irt.recordRun"])
const QUIET_ENTITIES: ReadonlySet<string> = new Set(["sessions", "notifications", "reportRuns"])
const bi = (row: { nameEn: string; nameBn: string } | undefined | null) => (row ? { en: row.nameEn, bn: row.nameBn || row.nameEn } : undefined)
const locName = (id: Id | undefined | null) => {
  const l = LOCATIONS.find((x) => x.id === id)
  return l ? { en: l.name.en, bn: l.name.bn } : undefined
}

/**
 * A user's role home (plan §9 `/home`): four KPIs and a to-do list for the
 * user's role, each pointing at the screen to act on it. Studio-bound roles
 * see their studio (the window's location when it is one of theirs, else
 * their home studio); the store keeper sees his stock locations. Approvals
 * are the ones this user may decide now (grants, limits, scope), never their
 * own, exactly as the approvals inbox shows them.
 */
export async function loadRoleHome(
  db: OmniflowDb,
  p: { userId: Id; today: ISODate; nowMs: number; locationId?: Id | null }
): Promise<RoleHomeData> {
  const user = await db.users.get(p.userId)
  if (!user) return { role: "NONE", locationId: null, scopeIds: [], kpis: [], todos: [] }
  const security = await resolveSecurity(db, user.id)
  const role = primaryRole(security.roleCodes)
  const studios = user.locationIds.filter(isStudio)
  const studio = STUDIO_BOUND.has(role)
    ? p.locationId && studios.includes(p.locationId)
      ? p.locationId
      : studios.includes(user.homeLocationId)
        ? user.homeLocationId
        : (studios[0] ?? null)
    : null
  const dayStart = atDhaka(p.today, "00:00")
  const dayEnd = dayStart + 24 * 60 * MINUTE

  const kpis: HomeKpi[] = []
  const todos: TodoItem[] = []
  const kpi = (key: string, value: number, format: HomeKpi["format"], href: string) => kpis.push({ key, value, format, href })

  // Shared pieces, loaded only by the roles that use them.
  const approvalsForMe = async () => {
    const pending = await db.approvals.where("status").equals("pending").toArray()
    const mine = pending.filter((a) => a.requestedBy !== user.id && canDecide(security, user.locationIds, a)).sort((a, b) => b.requestedAt - a.requestedAt)
    const requesters = new Map((await db.users.bulkGet([...new Set(mine.map((a) => a.requestedBy))])).filter(Boolean).map((u) => [u!.id, u!]))
    return mine.map(
      (a): TodoItem => ({
        kind: "approval",
        id: a.id,
        ref: a.docNo,
        name: bi(requesters.get(a.requestedBy)),
        labelKey: `approvals.kinds.${a.kind}`,
        amountP: a.amountP,
        at: a.requestedAt,
        href: "/approvals",
        tone: "warning",
      })
    )
  }
  const overdueByParty = async (limit: number) => {
    const items = (await arOpenItems(db, p.today)).filter((i) => i.dpd > 0)
    const byParty = new Map<Id, { party: (typeof items)[number]["party"]; amountP: number; dpd: number }>()
    for (const i of items) {
      const g = byParty.get(i.invoice.partyId) ?? { party: i.party, amountP: 0, dpd: 0 }
      g.amountP += i.openP
      g.dpd = Math.max(g.dpd, i.dpd)
      byParty.set(i.invoice.partyId, g)
    }
    const totalP = items.reduce((s, i) => s + i.openP, 0)
    const top = [...byParty.entries()]
      .sort((a, b) => b[1].amountP - a[1].amountP)
      .slice(0, limit)
      .map(([partyId, g]): TodoItem => ({ kind: "overdue", id: `overdue:${partyId}`, ref: g.party?.code, name: bi(g.party), amountP: g.amountP, count: g.dpd, href: `/par/${partyId}`, tone: "destructive" }))
    return { totalP, top }
  }
  const billsOnHold = async () => {
    const bills = await db.vendorBills.where("status").equals("on-hold").toArray()
    const vendors = new Map((await db.parties.bulkGet([...new Set(bills.map((b) => b.partyId))])).filter(Boolean).map((x) => [x!.id, x!]))
    return bills
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((b): TodoItem => ({ kind: "bill-hold", id: b.id, ref: b.billNo, name: bi(vendors.get(b.partyId)), amountP: b.totalP, day: b.date, href: `/ap/bills/${b.id}`, tone: "warning" }))
  }
  const pdcsDue = async () => {
    const cutoff = addDaysISO(p.today, rules.pdcWarnDays)
    const cheques = (await db.cheques.where("status").equals("in-hand").toArray()).filter((c) => c.direction === "received" && c.chequeDate <= cutoff)
    const parties = new Map((await db.parties.bulkGet([...new Set(cheques.map((c) => c.partyId))])).filter(Boolean).map((x) => [x!.id, x!]))
    return cheques
      .sort((a, b) => (a.chequeDate < b.chequeDate ? -1 : 1))
      .map((c): TodoItem => ({ kind: "pdc", id: c.id, ref: c.chequeNo, name: bi(parties.get(c.partyId)), amountP: c.amountP, day: c.chequeDate, href: `/cab/cheques?id=${c.id}`, tone: c.chequeDate <= p.today ? "warning" : "info" }))
  }
  const journals = async (status: "draft" | "pending-approval", preparedBy?: Id) => {
    const rows = (await db.journals.where("status").equals(status).toArray()).filter((j) => !preparedBy || j.preparedBy === preparedBy)
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((j): TodoItem => ({ kind: status === "draft" ? "draft" : "voucher-pending", id: j.id, ref: j.journalNo, amountP: j.totalP, day: j.date, href: `/fa/journals/${j.id}`, tone: status === "draft" ? "muted" : "warning" }))
  }
  const reorderCount = async (locationIds: Id[] | null) => {
    const def = await reportDefinition(db, "IRT-25")
    const result = await runReport(db, def, {})
    const names = locationIds ? new Set(locationIds.map((id) => LOCATIONS.find((l) => l.id === id)?.name.en)) : null
    return result.rows.filter((r) => !names || names.has(String(r.location))).length
  }
  const expiringAt = async (locationIds: Id[] | null) => {
    const batches = await db.batches.where("expiry").belowOrEqual(addDaysISO(p.today, rules.expiryWarnDays)).toArray()
    let n = 0
    for (const batch of batches) {
      for (const b of await db.stockBalances.where("batchId").equals(batch.id).toArray()) {
        if (b.qtyBase + b.quarantinedQty > 0 && (!locationIds || locationIds.includes(b.locationId))) n += 1
      }
    }
    return n
  }
  const studioOrders = async (loc: Id) => {
    const all = await db.salesOrders.where("locationId").equals(loc).toArray()
    const parties = new Map(
      (await db.parties.bulkGet([...new Set(all.filter((o) => boardStatus(o, p.today)).map((o) => o.partyId))])).filter(Boolean).map((x) => [x!.id, x!])
    )
    const item = (o: SalesOrderRow, kind: TodoItem["kind"], href: string, tone?: TodoItem["tone"]): TodoItem => ({
      kind,
      id: `${kind}:${o.id}`,
      ref: o.orderNo,
      name: bi(parties.get(o.partyId)),
      amountP: o.totalP,
      at: kind === "booking" ? o.scheduledAt : o.promisedAt,
      href,
      tone,
    })
    return { all, item }
  }

  switch (role) {
    case "OWNER": {
      const [finance, collections, position, approvals, held, overdue] = await Promise.all([
        loadFinance(db, { today: p.today, period: "today" }),
        loadCollections(db, { from: p.today, to: p.today }),
        cashPosition(db, p.today),
        approvalsForMe(),
        billsOnHold(),
        overdueByParty(3),
      ])
      kpi("revenueToday", finance.revenueTodayP, "money", "/dashboard")
      kpi("collectionsToday", collections.totalP, "money", irtHref("IRT-07", { from: p.today, to: p.today }))
      kpi("cash", position.reduce((s, r) => s + r.balanceP, 0), "money", "/cab")
      kpi("approvals", approvals.length, "count", "/approvals")
      todos.push({ kind: "dashboard", id: "dashboard", amountP: finance.revenueTodayP, href: "/dashboard", tone: "info" })
      todos.push(...approvals.slice(0, 5), ...held.slice(0, 3), ...overdue.top)
      break
    }
    case "ACC_MGR": {
      const [approvals, held, overdue, pdcs, pending, drafts] = await Promise.all([
        approvalsForMe(),
        billsOnHold(),
        overdueByParty(3),
        pdcsDue(),
        journals("pending-approval"),
        journals("draft", user.id),
      ])
      kpi("approvals", approvals.length, "count", "/approvals")
      kpi("overdueReceivables", overdue.totalP, "money", "/ar/aging")
      kpi("billsOnHold", held.length, "count", "/ap/bills")
      kpi("pdcDue", pdcs.length, "count", "/cab/cheques")
      todos.push(...approvals.slice(0, 5), ...held, ...pending.filter((j) => !approvals.some((a) => a.ref === j.ref)).slice(0, 4), ...drafts.slice(0, 3), ...pdcs, ...overdue.top)
      break
    }
    case "ACCOUNTANT": {
      const [drafts, pending, payments, pdcs, held, overdue] = await Promise.all([
        journals("draft", user.id),
        journals("pending-approval", user.id),
        db.vendorPayments.where("status").equals("pending-approval").toArray(),
        pdcsDue(),
        billsOnHold(),
        overdueByParty(3),
      ])
      const myPayments = payments.filter((x) => x.preparedBy === user.id)
      const vendors = new Map((await db.parties.bulkGet([...new Set(myPayments.map((x) => x.partyId))])).filter(Boolean).map((x) => [x!.id, x!]))
      const paymentItems = myPayments.map(
        (x): TodoItem => ({ kind: "payment-pending", id: x.id, ref: x.paymentNo, name: bi(vendors.get(x.partyId)), amountP: x.grossP, day: x.date, href: `/ap/payments/${x.id}`, tone: "warning" })
      )
      kpi("myDrafts", drafts.length, "count", "/fa/journals?status=draft")
      kpi("awaitingApproval", pending.length + paymentItems.length, "count", "/fa/journals?status=pending-approval")
      kpi("overdueReceivables", overdue.totalP, "money", "/ar/aging")
      kpi("pdcDue", pdcs.length, "count", "/cab/cheques")
      todos.push(...drafts.slice(0, 4), ...pending.slice(0, 4), ...paymentItems, ...pdcs, ...held, ...overdue.top)
      break
    }
    case "STUDIO_MGR":
    case "ADVISOR": {
      if (!studio) break
      const [{ all, item }, approvals, finance] = await Promise.all([
        studioOrders(studio),
        role === "STUDIO_MGR" ? approvalsForMe() : Promise.resolve([] as TodoItem[]),
        loadFinance(db, { today: p.today, period: "today", locationId: studio }),
      ])
      const onBoard = all.filter((o) => boardStatus(o, p.today))
      const late = onBoard.filter((o) => isLate(o, p.nowMs)).sort((a, b) => a.promisedAt - b.promisedAt)
      const ready = onBoard.filter((o) => o.status === "ready").sort((a, b) => a.promisedAt - b.promisedAt)
      kpi("jobsToday", onBoard.length, "count", "/stl/board")
      kpi("lateJobs", late.length, "count", "/stl")
      const lateItems = late.map((o) => item(o, "late-job", `/stl/orders/${o.id}`, "destructive"))
      const readyItems = ready.map((o) => item(o, "ready", `/sd/handover/${o.id}`, "success"))
      if (role === "STUDIO_MGR") {
        const qc = onBoard.filter((o) => o.status === "qc").map((o) => item(o, "qc", `/stl/orders/${o.id}`, "warning"))
        const low = await reorderCount([studio])
        kpi("revenueToday", finance.revenueTodayP, "money", irtHref("IRT-16", { from: p.today, to: p.today }, studio))
        kpi("approvals", approvals.length, "count", "/approvals")
        todos.push(...approvals.slice(0, 5), ...qc, ...readyItems, ...lateItems)
        if (low) todos.push({ kind: "low-stock", id: "low-stock", count: low, detail: locName(studio), href: irtHref("IRT-25", null, studio), tone: "warning" })
      } else {
        const later = all
          .filter((o) => o.status === "booked" && o.scheduledAt >= Math.max(p.nowMs, dayStart) && o.scheduledAt < dayEnd)
          .sort((a, b) => a.scheduledAt - b.scheduledAt)
        const quotes = (await db.quotations.where("locationId").equals(studio).toArray()).filter((q) => (q.status === "sent" || q.status === "draft") && q.validUntil >= p.today)
        const qParties = new Map((await db.parties.bulkGet([...new Set(quotes.map((q) => q.partyId))])).filter(Boolean).map((x) => [x!.id, x!]))
        kpi("bookingsLater", later.length, "count", "/stl/board")
        kpi("openQuotes", quotes.length, "count", "/stl/quotations")
        todos.push(...lateItems, ...readyItems, ...later.map((o) => item(o, "booking", `/stl/orders/${o.id}`, "info")))
        todos.push(
          ...quotes
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 5)
            .map(
              (q): TodoItem => ({
                kind: "quote",
                id: q.id,
                ref: q.quoteNo,
                name: bi(qParties.get(q.partyId)),
                amountP: q.totalP,
                day: q.validUntil,
                labelKey: `dashboard.home.quoteStatus.${q.status}`,
                href: `/stl/quotations/${q.id}`,
                tone: "info",
              })
            )
        )
      }
      break
    }
    case "CASHIER": {
      if (!studio) break
      const [delivered, ready, invoices, pendingReceipts, receiptsToday, position, petty] = await Promise.all([
        db.salesOrders.where("[locationId+status]").equals([studio, "delivered"]).toArray(),
        db.salesOrders.where("[locationId+status]").equals([studio, "ready"]).toArray(),
        db.salesInvoices.where("locationId").equals(studio).toArray(),
        db.receipts.where("status").equals("pending").toArray(),
        db.receipts.where("date").equals(p.today).toArray(),
        cashPosition(db, p.today),
        db.pettyCashVouchers.where("status").equals("pending-approval").toArray(),
      ])
      const partyIds = [...new Set([...delivered, ...ready, ...invoices, ...pendingReceipts].map((x) => x.partyId))]
      const parties = new Map((await db.parties.bulkGet(partyIds)).filter(Boolean).map((x) => [x!.id, x!]))
      const atCounter = (partyId: Id) => {
        const party = parties.get(partyId)
        return !!party && !CREDIT_SEGMENTS.has(party.segment) && party.paymentTermsDays === 0
      }
      const queue = delivered.filter((o) => atCounter(o.partyId))
      const coming = ready.filter((o) => atCounter(o.partyId))
      const open = invoices.filter((i) => i.kind === "counter" && invoiceAvailable(i) > 0)
      const mfs = pendingReceipts.filter((r) => r.locationId === studio && (r.method === "bkash" || r.method === "nagad"))
      const takings = receiptsToday.filter((r) => r.locationId === studio && r.status === "posted")
      const till = position.find((r) => r.account.kind === "cash-till" && r.account.locationId === studio)
      const myPetty = petty.filter((v) => v.preparedBy === user.id)
      kpi("counterQueue", queue.length + open.length, "count", "/si/counter")
      kpi("takingsToday", takings.reduce((s, r) => s + r.amountP, 0), "money", "/ar/receipts")
      kpi("pendingMfs", mfs.length, "count", "/si/counter")
      kpi("tillBalance", till?.balanceP ?? 0, "money", till ? `/cab/accounts/${till.account.id}` : "/cab")
      todos.push(
        ...queue
          .sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0))
          .map((o): TodoItem => ({ kind: "counter", id: o.id, ref: o.orderNo, name: bi(parties.get(o.partyId)), amountP: o.totalP - o.advanceP, at: o.deliveredAt, href: "/si/counter", tone: "warning" })),
        ...open.map((i): TodoItem => ({ kind: "counter-invoice", id: i.id, ref: i.invoiceNo, name: bi(parties.get(i.partyId)), amountP: invoiceAvailable(i), day: i.date, href: "/si/counter", tone: "warning" })),
        ...mfs.map(
          (r): TodoItem => ({ kind: "mfs", id: r.id, ref: r.receiptNo, name: bi(parties.get(r.partyId)), amountP: r.amountP, at: r.at, labelKey: `reports.enum.method.${r.method}`, href: "/si/counter", tone: "info" })
        ),
        ...coming
          .sort((a, b) => a.promisedAt - b.promisedAt)
          .map((o): TodoItem => ({ kind: "pickup", id: o.id, ref: o.orderNo, name: bi(parties.get(o.partyId)), amountP: o.totalP - o.advanceP, at: o.promisedAt, href: "/si/counter", tone: "info" })),
        ...myPetty.map((v): TodoItem => ({ kind: "petty-pending", id: v.id, ref: v.voucherNo, amountP: v.amountP, day: v.date, labelKey: "dashboard.home.todo.sub.awaitingApproval", href: `/cab/petty-cash?id=${v.id}`, tone: "warning" }))
      )
      break
    }
    case "TECHNICIAN": {
      const open = await db.jobTasks.where("[technicianId+status]").anyOf([user.id, "queued"], [user.id, "in-progress"]).toArray()
      const mine = open.filter((x) => x.plannedStart < dayEnd)
      const done = (await db.jobTasks.where("technicianId").equals(user.id).toArray()).filter(
        (x) => x.status === "done" && !!x.finishedAt && x.finishedAt >= dayStart && x.finishedAt < dayEnd
      )
      const orders = new Map((await db.salesOrders.bulkGet([...new Set(mine.map((x) => x.orderId))])).filter(Boolean).map((o) => [o!.id, o!]))
      const services = new Map((await db.services.toArray()).map((s) => [s.id, s]))
      const bays = new Map((await db.bays.toArray()).map((b) => [b.id, b.code]))
      const late = new Set(mine.filter((x) => x.plannedStart + x.plannedMinutes * MINUTE < p.nowMs).map((x) => x.id))
      kpi("myTasks", mine.length, "count", "/stl/my-jobs")
      kpi("inProgress", mine.filter((x) => x.status === "in-progress").length, "count", "/stl/my-jobs")
      kpi("doneToday", done.length, "count", "/stl/my-jobs")
      kpi("lateTasks", late.size, "count", "/stl/my-jobs")
      todos.push(
        ...mine
          .sort((a, b) => a.plannedStart - b.plannedStart)
          .map((x): TodoItem => {
            const bay = bays.get(x.bayId)
            return {
              kind: "task",
              id: x.id,
              ref: orders.get(x.orderId)?.orderNo,
              name: bi(x.serviceId ? services.get(x.serviceId) : undefined),
              detail: bay ? { en: bay, bn: bay } : undefined,
              at: x.plannedStart,
              labelKey: `dashboard.home.taskStatus.${x.status}`,
              href: "/stl/my-jobs",
              tone: late.has(x.id) ? "destructive" : x.status === "in-progress" ? "info" : "muted",
            }
          })
      )
      break
    }
    case "STORE": {
      const locs = user.locationIds.filter((id) => LOCATIONS.find((l) => l.id === id)?.isStockLocation)
      const [pos, transfers, held, low, expiring, approvals] = await Promise.all([
        db.purchaseOrders.where("status").anyOf("issued", "partial").toArray(),
        db.transfers.where("status").anyOf("requested", "dispatched").toArray(),
        db.grnLines.where("quarantineStatus").equals("held").toArray(),
        reorderCount(locs),
        expiringAt(locs),
        approvalsForMe(),
      ])
      const myPos = pos.filter((x) => locs.includes(x.locationId)).sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1))
      const vendors = new Map((await db.parties.bulkGet([...new Set(myPos.map((x) => x.vendorId))])).filter(Boolean).map((x) => [x!.id, x!]))
      const toDispatch = transfers.filter((x) => x.status === "requested" && locs.includes(x.fromLocationId))
      const toReceive = transfers.filter((x) => x.status === "dispatched" && locs.includes(x.toLocationId))
      const grns = new Map((await db.grns.bulkGet([...new Set(held.map((l) => l.grnId))])).filter(Boolean).map((g) => [g!.id, g!]))
      const quarantine = held.filter((l) => locs.includes(grns.get(l.grnId)?.locationId ?? ""))
      const inTransit = transfers.filter((x) => x.status === "dispatched" && (locs.includes(x.toLocationId) || locs.includes(x.fromLocationId)))
      kpi("lowStock", low, "count", "/ic/reorder")
      kpi("expiringLots", expiring, "count", "/ic/expiry")
      kpi("grnPending", myPos.length, "count", "/grn")
      kpi("inTransit", inTransit.length, "count", "/st/transfers")
      todos.push(...approvals.slice(0, 3))
      todos.push(
        ...myPos.map(
          (x): TodoItem => ({ kind: "grn", id: x.id, ref: x.poNo, name: bi(vendors.get(x.vendorId)), detail: locName(x.locationId), day: x.expectedDate, href: `/grn/receive/${x.id}`, tone: x.expectedDate < p.today ? "destructive" : "info" })
        )
      )
      todos.push(...toDispatch.map((x): TodoItem => ({ kind: "transfer-out", id: x.id, ref: x.transferNo, detail: locName(x.toLocationId), at: x.requestedAt, href: `/st/transfers/${x.id}`, tone: "warning" })))
      todos.push(...toReceive.map((x): TodoItem => ({ kind: "transfer-in", id: x.id, ref: x.transferNo, detail: locName(x.fromLocationId), at: x.dispatchedAt, href: `/st/transfers/${x.id}`, tone: "info" })))
      if (quarantine.length) todos.push({ kind: "quarantine", id: "quarantine", count: quarantine.length, href: "/grn/quarantine", tone: "warning" })
      if (expiring) todos.push({ kind: "expiring", id: "expiring", count: expiring, href: "/ic/expiry", tone: "warning" })
      if (low) todos.push({ kind: "low-stock", id: "low-stock", count: low, href: "/ic/reorder", tone: "warning" })
      break
    }
    case "PROCUREMENT": {
      const [approvals, pos, prs, low] = await Promise.all([
        approvalsForMe(),
        db.purchaseOrders.where("status").anyOf("issued", "partial").toArray(),
        db.purchaseRequisitions.where("status").equals("approved").toArray(),
        reorderCount(null),
      ])
      const overdue = pos.filter((x) => x.expectedDate < p.today).sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1))
      const vendors = new Map((await db.parties.bulkGet([...new Set(overdue.map((x) => x.vendorId))])).filter(Boolean).map((x) => [x!.id, x!]))
      kpi("approvals", approvals.length, "count", "/approvals")
      kpi("openPos", pos.length, "count", "/ptl/po")
      kpi("overduePos", overdue.length, "count", "/ptl/po")
      kpi("lowStock", low, "count", "/ic/reorder")
      todos.push(...approvals.slice(0, 5))
      todos.push(
        ...overdue.map((x): TodoItem => ({ kind: "po-overdue", id: x.id, ref: x.poNo, name: bi(vendors.get(x.vendorId)), amountP: x.totalP, day: x.expectedDate, href: `/ptl/po/${x.id}`, tone: "destructive" }))
      )
      todos.push(...prs.map((x): TodoItem => ({ kind: "pr-approved", id: x.id, ref: x.prNo, detail: locName(x.locationId), amountP: x.totalP, day: x.date, href: `/ptl/requisitions/${x.id}`, tone: "info" })))
      if (low) todos.push({ kind: "low-stock", id: "low-stock", count: low, href: "/ic/reorder", tone: "warning" })
      break
    }
    case "SYS_ADMIN": {
      const [users, sessions, logins] = await Promise.all([db.users.toArray(), db.sessions.toArray(), db.loginEvents.where("at").between(dayStart, dayEnd).toArray()])
      const locked = users.filter((u) => u.status === "locked")
      const active = sessions.filter((s) => !s.endedAt)
      const failed = logins.filter((l) => l.result !== "success").sort((a, b) => b.at - a.at)
      const mustChange = users.filter((u) => u.mustChangePassword && u.status === "active")
      kpi("lockedUsers", locked.length, "count", "/sac")
      kpi("activeSessions", active.length, "count", "/sac/sessions")
      kpi("failedToday", failed.length, "count", "/sac/login-history")
      kpi("activeUsers", users.filter((u) => u.status === "active").length, "count", "/sac")
      todos.push(...locked.map((u): TodoItem => ({ kind: "locked-user", id: u.id, ref: u.username, name: bi(u), count: u.failedAttempts, href: `/sac/users/${u.id}`, tone: "destructive" })))
      todos.push(...mustChange.map((u): TodoItem => ({ kind: "password-change", id: `pw:${u.id}`, ref: u.username, name: bi(u), href: `/sac/users/${u.id}`, tone: "warning" })))
      todos.push(
        ...failed
          .slice(0, 5)
          .map((l): TodoItem => ({ kind: "failed-signin", id: l.id, ref: l.username, at: l.at, labelKey: `dashboard.home.loginResult.${l.result}`, href: `/sac/login-history?for=${l.username}`, tone: "warning" }))
      )
      break
    }
    case "AUDITOR": {
      const [todayAudit, recent, decided, users] = await Promise.all([
        db.audit.where("at").between(dayStart, dayEnd).toArray(),
        db.audit.orderBy("seq").reverse().limit(60).toArray(),
        db.approvals.where("status").anyOf("approved", "rejected").toArray(),
        db.users.toArray(),
      ])
      const decidedToday = decided.filter((a) => !!a.decidedAt && a.decidedAt >= dayStart && a.decidedAt < dayEnd)
      kpi("auditToday", todayAudit.length, "count", "/sac/audit")
      kpi("blockedToday", todayAudit.filter((a) => a.action === "blocked").length, "count", "/sac/audit")
      kpi("decidedToday", decidedToday.length, "count", "/approvals")
      kpi("usersWithAccess", users.filter((u) => u.status === "active").length, "count", irtHref("IRT-32"))
      todos.push({ kind: "access-review", id: "access-review", ref: "IRT-32", href: irtHref("IRT-32"), tone: "info" })
      todos.push({ kind: "report", id: "logins", ref: "IRT-31", href: irtHref("IRT-31"), tone: "info" })
      todos.push({ kind: "dashboard", id: "dashboard", href: "/dashboard", tone: "info" })
      const seen = new Set<string>()
      for (const a of recent) {
        if (seen.has(a.commitId) || (a.action !== "blocked" && QUIET_COMMANDS.has(a.command)) || QUIET_ENTITIES.has(a.entity)) continue
        seen.add(a.commitId)
        todos.push({
          kind: "audit",
          id: `audit:${a.seq}`,
          ref: a.docNo ?? a.command,
          name: { en: a.actor.name, bn: users.find((u) => u.id === a.actor.userId)?.nameBn ?? a.actor.name },
          labelKey: `dashboard.home.auditAction.${a.action}`,
          at: a.at,
          href: "/sac/audit",
          tone: a.action === "blocked" ? "destructive" : "muted",
        })
        if (seen.size >= 6) break
      }
      break
    }
    default: {
      const approvals = await approvalsForMe()
      kpi("approvals", approvals.length, "count", "/approvals")
      todos.push(...approvals.slice(0, 5))
    }
  }
  const stockLocs = user.locationIds.filter((id) => LOCATIONS.find((l) => l.id === id)?.isStockLocation)
  const scopeIds = studio ? [studio] : role === "STORE" ? stockLocs : user.locationIds
  return { role, locationId: studio, scopeIds, kpis, todos }
}
