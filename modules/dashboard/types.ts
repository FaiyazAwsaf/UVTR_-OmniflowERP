import type { LocationCode } from "@/config/brand.config"
import type { ISODate, Id, Poisha } from "@/core/db/schema"
import type { ProfitAndLoss } from "@/core/ledger/statements"
import type { RoleCode } from "@/core/security/types"

/**
 * Executive dashboard, role homes and the STL studio home: the shapes the
 * read-side loaders in queries.ts return (plan §9 `/dashboard`, `/home`,
 * `/stl`). Money is integer poisha; every figure comes from the same
 * functions FRS and IRT use, so a tile and its drill-down always agree.
 */

/** The dashboard's period control. */
export type DashPeriod = "today" | "mtd" | "last-month"

export const DASH_PERIODS: DashPeriod[] = ["today", "mtd", "last-month"]

export type DayRange = { from: ISODate; to: ISODate }

/** Revenue and margin from the P&L (accounting_rules.md §6). */
export type FinanceFigures = {
  /** Net revenue (service + products − discounts, net of VAT) today */
  revenueTodayP: Poisha
  /** Net revenue for the period */
  revenuePeriodP: Poisha
  /** Net revenue for the comparison range (the same days of the month before), when there is one */
  revenueCompareP: Poisha | null
  /** Gross profit for the period: net revenue − cost of sales (consumables, COGS, losses, PPV) */
  grossProfitP: Poisha
  costOfSalesP: Poisha
  /** Gross profit as a percent of net revenue (null without revenue) */
  marginPct: number | null
  /** Invoices dated today at the location (or everywhere) */
  invoicesToday: number
  period: ProfitAndLoss
}

/** Receipts that posted in the period (the IRT-07 receipts register). */
export type CollectionFigures = {
  totalP: Poisha
  count: number
  byMethod: Record<string, Poisha>
}

export type CashAccountFigure = {
  id: Id
  code: string
  nameEn: string
  nameBn: string
  kind: "cash-till" | "petty-cash" | "bank" | "mfs" | "card-clearing"
  locationId: Id
  balanceP: Poisha
}

/** Balances now: receivables and payables from the subledgers, cash and stock from the GL. */
export type PositionFigures = {
  receivablesP: Poisha
  receivableCount: number
  overdueP: Poisha
  overdueCount: number
  /** Customer aging buckets of the open items (days past due) */
  buckets: { current: Poisha; d0_30: Poisha; d31_60: Poisha; d61_90: Poisha; over90: Poisha }
  /** AP open items overdue or due within 7 days (company-wide) */
  payablesDueP: Poisha
  payablesDueCount: number
  payablesOverdueP: Poisha
  payablesOpenP: Poisha
  cash: CashAccountFigure[]
  cashTotalP: Poisha
  /** Inventory accounts (chemicals, consumables, retail) per location */
  stockByLocation: { locationId: Id; valueP: Poisha }[]
  stockTotalP: Poisha
  /** Inventory in transit to the location(s) */
  inTransitP: Poisha
}

export type StudioStatusKey = "booked" | "in-progress" | "qc" | "ready" | "delivered"

export const STUDIO_STATUSES: StudioStatusKey[] = ["booked", "in-progress", "qc", "ready", "delivered"]

/** Jobs and bays of one studio today. */
export type StudioOps = {
  locationId: Id
  code: LocationCode
  counts: Record<StudioStatusKey, number>
  /** Booked, in progress or in QC with the promised time passed */
  late: number
  bayCount: number
  /** Minutes of bay time between 09:00 and 21:00 (bays × 720) */
  bayMinutes: number
  /** Minutes covered by scheduled tasks (overlaps in one bay counted once) */
  scheduledMinutes: number
  utilisationPct: number
  bays: { bayId: Id; code: string; minutes: number; pct: number }[]
}

export type TrendPoint = { date: ISODate; total: Poisha } & Partial<Record<LocationCode, Poisha>>

/** Revenue by day and studio (the IRT-16 dataset, last 30 days). */
export type RevenueTrend = DayRange & {
  points: TrendPoint[]
  /** Net revenue per location code over the range (IRT-16 grouped by studio) */
  byLocation: Partial<Record<LocationCode, Poisha>>
  totalP: Poisha
  series: LocationCode[]
}

export type TopService = {
  key: string
  nameEn: string
  nameBn: string
  category: string | null
  qty: number
  lines: number
  netP: Poisha
}

export type AlertKind = "reorder" | "expiring" | "quarantine" | "approvals" | "bills-on-hold" | "pdc-due"

export const ALERT_KINDS: AlertKind[] = ["approvals", "bills-on-hold", "pdc-due", "reorder", "expiring", "quarantine"]

export type AlertFigure = { kind: AlertKind; count: number; href: string; companyWide: boolean }

/* ---------------- Role homes ---------------- */

export type HomeKpiFormat = "money" | "count" | "pct"

export type HomeKpi = {
  key: string
  value: number
  format: HomeKpiFormat
  href: string
}

export type TodoKind =
  | "approval"
  | "late-job"
  | "qc"
  | "ready"
  | "booking"
  | "quote"
  | "task"
  | "counter"
  | "counter-invoice"
  | "pickup"
  | "petty-pending"
  | "mfs"
  | "overdue"
  | "bill-hold"
  | "pdc"
  | "draft"
  | "voucher-pending"
  | "payment-pending"
  | "low-stock"
  | "expiring"
  | "grn"
  | "transfer-out"
  | "transfer-in"
  | "quarantine"
  | "po-overdue"
  | "pr-approved"
  | "locked-user"
  | "failed-signin"
  | "password-change"
  | "audit"
  | "access-review"
  | "report"
  | "dashboard"

export type Tone = "warning" | "destructive" | "info" | "success" | "muted"

/** One line of a role's to-do list; the component turns it into words in the window's language. */
export type TodoItem = {
  kind: TodoKind
  id: string
  /** Document number, code or username (always Latin) */
  ref?: string
  /** A bilingual name (party, item, user, service) */
  name?: { en: string; bn: string }
  /** A second bilingual detail (location, vehicle, report) */
  detail?: { en: string; bn: string }
  /** An i18n key for a short label (an approval's kind, a status) */
  labelKey?: string
  amountP?: Poisha
  /** A moment (demo-clock ms) */
  at?: number
  /** A day */
  day?: ISODate
  count?: number
  href: string
  tone?: Tone
}

export type RoleHomeData = {
  role: RoleCode | "NONE"
  /** Location the home is scoped to (studio-bound roles), else null */
  locationId: Id | null
  /** The locations the home covers (one studio, the store keeper's stock locations, or the user's) */
  scopeIds: Id[]
  kpis: HomeKpi[]
  todos: TodoItem[]
}

/* ---------------- STL studio home ---------------- */

export type StudioOrder = {
  id: Id
  orderNo: string
  status: StudioStatusKey
  partyEn: string
  partyBn: string
  regNo?: string
  vehicle?: string
  vehicleClass?: string
  scheduledAt: number
  promisedAt: number
  bayCode?: string
  technicians: { id: Id; en: string; bn: string }[]
  services: string[]
  totalP: Poisha
  late: boolean
}

export type StudioHomeData = {
  locationId: Id
  code: LocationCode
  orders: StudioOrder[]
  /** Orders scheduled to start today, by time */
  bookings: StudioOrder[]
  late: StudioOrder[]
  ops: StudioOps
  revenueTodayP: Poisha
  depositsTodayP: Poisha
  depositsCount: number
}
