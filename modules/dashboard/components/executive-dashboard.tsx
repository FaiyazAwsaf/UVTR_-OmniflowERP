"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  AlarmClock,
  AlertTriangle,
  Banknote,
  BarChart3,
  CalendarClock,
  CarFront,
  CircleDollarSign,
  FileWarning,
  Gauge,
  HandCoins,
  Inbox,
  Landmark,
  Package,
  PackageX,
  Percent,
  Receipt,
  ShieldAlert,
  TrendingUp,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { locations as LOCATIONS } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { useDb } from "@/core/db/DbProvider"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import {
  irtHref,
  isStudio,
  loadAlerts,
  loadCollections,
  loadFinance,
  loadPositions,
  loadRevenueTrend,
  loadStudioOps,
  loadTopServices,
  monthOfRange,
  periodRange,
  STUDIO_IDS,
} from "../queries"
import { DASH_PERIODS, STUDIO_STATUSES, type AlertFigure, type AlertKind, type CashAccountFigure, type DashPeriod, type StudioOps } from "../types"
import { JobsBarChart, RevenueTrendChart, SERIES_COLOR } from "./charts"
import { DrillLink, FigureTile, GradientKpi, MoneyFigure, Pills, ShareBar, useDemoToday } from "./kit"

const ALERT_ICON: Record<AlertKind, LucideIcon> = {
  reorder: PackageX,
  expiring: CalendarClock,
  quarantine: ShieldAlert,
  approvals: Inbox,
  "bills-on-hold": FileWarning,
  "pdc-due": Banknote,
}

const CASH_KINDS: CashAccountFigure["kind"][] = ["cash-till", "petty-cash", "bank", "mfs", "card-clearing"]

/**
 * /dashboard: the owner's executive dashboard (plan §9, objective §2). A
 * period control (today, month to date, last month) and a location filter;
 * revenue today and for the period (the P&L's net revenue), collections
 * (the IRT-07 receipts), receivables and overdue (AR open items = AR
 * control), payables due (AP open items), cash and bank (the GL), gross
 * margin (P&L), stock value (inventory accounts), jobs by status and bay
 * use per studio, top services (IRT-18), the 30-day revenue trend (IRT-16)
 * and alerts. Every tile drills down to the report or screen that proves
 * it with the same period and location. All live: a checkout in another
 * window moves revenue, collections and cash at once.
 */
export function ExecutiveDashboard() {
  const db = useDb()
  const { t, tk, num, pct, money, dmy, locale } = useLocale()
  const { today, nowMs } = useDemoToday()
  const [period, setPeriod] = React.useState<DashPeriod>("mtd")
  const [loc, setLoc] = React.useState<string>("all")
  const locationId = loc === "all" ? null : loc
  const ready = today > "2000"
  const range = React.useMemo(() => (ready ? periodRange(period, today) : null), [ready, period, today])
  const studioIds = React.useMemo(() => (locationId ? (isStudio(locationId) ? [locationId] : []) : STUDIO_IDS), [locationId])

  const finance = useLiveQuery(async () => (ready ? loadFinance(db, { today, period, locationId }) : undefined), [db, ready, today, period, locationId])
  const collections = useLiveQuery(async () => (range ? loadCollections(db, { ...range, locationId }) : undefined), [db, range, locationId])
  const positions = useLiveQuery(async () => (ready ? loadPositions(db, { today, locationId }) : undefined), [db, ready, today, locationId])
  const ops = useLiveQuery(
    async () => (ready ? Promise.all(studioIds.map((id) => loadStudioOps(db, { locationId: id, today, nowMs }))) : undefined),
    [db, ready, today, nowMs, studioIds]
  )
  const trend = useLiveQuery(async () => (ready ? loadRevenueTrend(db, { today, locationId }) : undefined), [db, ready, today, locationId])
  const top = useLiveQuery(async () => (range ? loadTopServices(db, { ...range, locationId }) : undefined), [db, range, locationId])
  const alerts = useLiveQuery(async () => (ready ? loadAlerts(db, { today, locationId }) : undefined), [db, ready, today, locationId])

  const periodLabel = t(`dashboard.exec.period.${period}` as "dashboard.exec.period.mtd")
  const location = LOCATIONS.find((l) => l.id === locationId)
  const locationLabel = location ? location.name[locale] : t("dashboard.exec.location.all")
  const todayRange = ready ? { from: today, to: today } : null
  const compareDelta =
    finance && finance.revenueCompareP ? ((finance.revenuePeriodP - finance.revenueCompareP) / Math.abs(finance.revenueCompareP)) * 100 : null
  const companyWide = locationId ? t("dashboard.common.companyWide") : undefined
  const scope = `${period}|${loc}`

  return (
    <div className="@container/dash flex min-w-0 flex-col gap-5" data-testid="dashboard" data-period={period} data-location={locationId ?? "all"} data-ready={finance && positions ? "true" : undefined}>
      <PageHeader
        title={t("dashboard.exec.title")}
        subtitle={
          range ? (
            <>
              {t("dashboard.exec.subtitle", { period: periodLabel, location: locationLabel })}
              <span className="nums"> · {t("dashboard.exec.range", { from: dmy(range.from), to: dmy(range.to) })}</span>
            </>
          ) : null
        }
        actions={
          <>
            <Pills
              testId="dashboard-period"
              label={t("dashboard.exec.period.label")}
              value={period}
              onChange={setPeriod}
              options={DASH_PERIODS.map((p) => ({ value: p, label: t(`dashboard.exec.period.${p}` as "dashboard.exec.period.mtd") }))}
            />
            <Select value={loc} onValueChange={(v) => v && setLoc(String(v))}>
              <SelectTrigger size="sm" className="min-w-40" data-testid="dashboard-location" data-value={loc} aria-label={t("dashboard.exec.location.label")}>
                <SelectValue>{() => locationLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="dashboard-location-option" data-value="all">
                  {t("dashboard.exec.location.all")}
                </SelectItem>
                {LOCATIONS.map((l) => (
                  <SelectItem key={l.id} value={l.id} data-testid="dashboard-location-option" data-value={l.id}>
                    <span lang="en" className="mr-1.5 font-mono text-[0.6875rem] text-muted-foreground">
                      {l.code}
                    </span>
                    {l.name[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* Top row: the four gradient KPIs */}
      <div className="grid grid-cols-1 gap-4 @min-[30rem]/dash:grid-cols-2 @min-[68rem]/dash:grid-cols-4">
        <GradientKpi
          testId="kpi-revenue-today"
          variant="cyan"
          icon={TrendingUp}
          title={t("dashboard.exec.kpi.revenueToday")}
          value={<MoneyFigure poisha={finance?.revenueTodayP ?? 0} />}
          amount={finance?.revenueTodayP}
          scope={scope}
          flashKey={finance?.revenueTodayP}
          caption={t("dashboard.exec.caption.invoicesToday", { count: num(finance?.invoicesToday ?? 0) })}
          href={irtHref("IRT-16", todayRange, locationId)}
        />
        <GradientKpi
          testId="kpi-revenue-mtd"
          variant="yellow"
          icon={BarChart3}
          title={t(`dashboard.exec.kpi.revenuePeriod.${period}` as "dashboard.exec.kpi.revenuePeriod.mtd")}
          value={<MoneyFigure poisha={finance?.revenuePeriodP ?? 0} />}
          amount={finance?.revenuePeriodP}
          scope={scope}
          flashKey={finance?.revenuePeriodP}
          delta={compareDelta}
          caption={period === "today" ? t("dashboard.exec.caption.netOfVat") : period === "mtd" ? t("dashboard.exec.caption.vsSameDays") : t("dashboard.exec.caption.vsMonthBefore")}
          href={irtHref("IRT-16", range, locationId)}
        />
        <GradientKpi
          testId="kpi-collections"
          variant="pink"
          icon={HandCoins}
          title={t("dashboard.exec.kpi.collections")}
          value={<MoneyFigure poisha={collections?.totalP ?? 0} />}
          amount={collections?.totalP}
          scope={scope}
          flashKey={collections?.totalP}
          caption={`${periodLabel}, ${t("dashboard.exec.caption.receipts", { count: num(collections?.count ?? 0) })}`}
          href={irtHref("IRT-07", range, locationId)}
        />
        <GradientKpi
          testId="kpi-cash"
          variant="purple"
          icon={Wallet}
          title={t("dashboard.exec.kpi.cash")}
          value={<MoneyFigure poisha={positions?.cashTotalP ?? 0} />}
          amount={positions?.cashTotalP}
          scope={scope}
          flashKey={positions?.cashTotalP}
          caption={t("dashboard.exec.caption.accounts", { count: num(positions?.cash.length ?? 0) })}
          href="/cab"
        />
      </div>

      {/* Calm tiles: positions and margin */}
      <div className="grid grid-cols-1 gap-4 @min-[26rem]/dash:grid-cols-2 @min-[48rem]/dash:grid-cols-3 @min-[80rem]/dash:grid-cols-5">
        <FigureTile
          testId="kpi-receivables"
          icon={Receipt}
          title={t("dashboard.exec.kpi.receivables")}
          value={<MoneyText poisha={positions?.receivablesP ?? 0} />}
          amount={positions?.receivablesP}
          scope={scope}
          flashKey={positions?.receivablesP}
          note={t("dashboard.common.now")}
          caption={t("dashboard.exec.caption.openInvoices", { count: num(positions?.receivableCount ?? 0) })}
          href={irtHref("IRT-06", null, locationId)}
        >
          {positions ? <AgingBar buckets={positions.buckets} /> : null}
        </FigureTile>
        <FigureTile
          testId="kpi-overdue"
          icon={AlertTriangle}
          title={t("dashboard.exec.kpi.overdue")}
          value={<MoneyText poisha={positions?.overdueP ?? 0} />}
          amount={positions?.overdueP}
          scope={scope}
          flashKey={positions?.overdueP}
          tone={positions?.overdueP ? "destructive" : undefined}
          note={t("dashboard.common.now")}
          caption={t("dashboard.exec.caption.pastDue", { count: num(positions?.overdueCount ?? 0) })}
          href="/ar/aging"
        >
          <ShareBar pct={positions?.receivablesP ? (positions.overdueP / positions.receivablesP) * 100 : 0} color="var(--destructive)" />
        </FigureTile>
        <FigureTile
          testId="kpi-payables-due"
          icon={Landmark}
          title={t("dashboard.exec.kpi.payablesDue")}
          value={<MoneyText poisha={positions?.payablesDueP ?? 0} />}
          amount={positions?.payablesDueP}
          scope={scope}
          flashKey={positions?.payablesDueP}
          note={companyWide ?? t("dashboard.common.now")}
          caption={t("dashboard.exec.caption.payables", { count: num(positions?.payablesDueCount ?? 0) })}
          href={irtHref("IRT-08")}
        >
          <p className="truncate text-xs text-destructive">{positions?.payablesOverdueP ? t("dashboard.exec.caption.payablesOverdue", { amount: money(positions.payablesOverdueP) }) : " "}</p>
        </FigureTile>
        <FigureTile
          testId="kpi-gross-margin"
          icon={Percent}
          title={t("dashboard.exec.kpi.grossMargin")}
          value={finance?.marginPct === null || finance?.marginPct === undefined ? "-" : pct(finance.marginPct, 1)}
          amount={finance?.grossProfitP}
          dataValue={finance?.marginPct === null || finance?.marginPct === undefined ? undefined : Math.round(finance.marginPct * 10) / 10}
          scope={scope}
          flashKey={finance?.grossProfitP}
          note={periodLabel}
          caption={finance?.marginPct === null ? t("dashboard.exec.caption.noRevenue") : t("dashboard.exec.caption.grossProfit", { amount: money(finance?.grossProfitP ?? 0) })}
          href={`/frs/profit-loss?month=${range ? monthOfRange(range) : ""}`}
        >
          <ShareBar pct={Math.max(0, finance?.marginPct ?? 0)} color="var(--success)" />
        </FigureTile>
        <FigureTile
          testId="kpi-stock-value"
          icon={Package}
          title={t("dashboard.exec.kpi.stockValue")}
          value={<MoneyText poisha={positions?.stockTotalP ?? 0} />}
          amount={positions?.stockTotalP}
          scope={scope}
          flashKey={positions?.stockTotalP}
          note={t("dashboard.common.now")}
          caption={t("dashboard.exec.caption.inTransit", { amount: money(positions?.inTransitP ?? 0) })}
          href={irtHref("IRT-23", null, locationId)}
        >
          {positions ? <StockSplit rows={positions.stockByLocation} total={positions.stockTotalP} /> : null}
        </FigureTile>
      </div>

      {/* Trend with the alerts rail */}
      <div className="grid grid-cols-1 gap-5 @min-[68rem]/dash:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard
          title={t("dashboard.exec.trend.title")}
          subtitle={t("dashboard.exec.trend.subtitle")}
          icon={TrendingUp}
          action={trend ? <DrillLink href={irtHref("IRT-16", { from: trend.from, to: trend.to }, locationId)} /> : null}
          className="min-w-0"
        >
          <div data-testid="revenue-trend" data-amount={trend?.totalP} data-from={trend?.from} data-to={trend?.to} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t("dashboard.exec.trend.total")}</span>
                <MoneyText poisha={trend?.totalP ?? 0} className="text-lg font-semibold" />
              </span>
              {(trend?.series ?? []).map((code) => (
                <span key={code} className="flex flex-col" data-testid="trend-location" data-location={code} data-amount={trend?.byLocation[code] ?? 0}>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: SERIES_COLOR[code] }} />
                    {LOCATIONS.find((l) => l.code === code)?.name[locale] ?? code}
                  </span>
                  <MoneyText poisha={trend?.byLocation[code] ?? 0} className="text-sm font-medium" />
                </span>
              ))}
            </div>
            {trend ? (
              trend.totalP ? (
                <RevenueTrendChart trend={trend} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("dashboard.exec.trend.empty")}</p>
              )
            ) : (
              <div className="h-[240px]" />
            )}
          </div>
        </SectionCard>

        <SectionCard title={t("dashboard.exec.alerts.title")} subtitle={t("dashboard.exec.alerts.subtitle")} icon={AlertTriangle} size="sm">
          <ul data-testid="alerts" className="flex flex-col">
            {(alerts ?? []).map((a) => (
              <AlertRow key={a.kind} alert={a} filtered={!!locationId} />
            ))}
            {alerts && !alerts.some((a) => a.count) ? <li className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.exec.alerts.none")}</li> : null}
          </ul>
        </SectionCard>
      </div>

      {/* Studios today and top services */}
      <div className="grid grid-cols-1 gap-5 @min-[48rem]/dash:grid-cols-2 @min-[80rem]/dash:grid-cols-3">
        <SectionCard title={t("dashboard.exec.jobs.title")} subtitle={t("dashboard.exec.jobs.subtitle")} icon={CarFront} size="sm" action={<DrillLink href="/stl/board" />}>
          <div data-testid="jobs-by-status" className="flex min-w-0 flex-col gap-3">
            {ops && ops.length ? (
              <>
                <JobsBarChart studios={ops} height={180} />
                <JobsTable studios={ops} />
              </>
            ) : ops ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.exec.jobs.none")}</p>
            ) : (
              <div className="h-[220px]" />
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={t("dashboard.exec.bays.title")}
          subtitle={t("dashboard.exec.bays.subtitle")}
          icon={Gauge}
          size="sm"
          action={<DrillLink href={irtHref("IRT-21", todayRange, locationId && isStudio(locationId) ? locationId : null)} />}
        >
          <div data-testid="bay-utilisation" className="flex min-w-0 flex-col gap-4">
            {(ops ?? []).map((st) => (
              <BayBlock key={st.locationId} ops={st} />
            ))}
            {ops && !ops.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.exec.jobs.none")}</p> : null}
          </div>
        </SectionCard>

        <SectionCard
          title={t("dashboard.exec.top.title")}
          subtitle={t("dashboard.exec.top.subtitle", { period: periodLabel })}
          icon={Trophy}
          size="sm"
          action={<DrillLink href={irtHref("IRT-18", range, locationId)} />}
          className="@min-[48rem]/dash:col-span-2 @min-[80rem]/dash:col-span-1"
        >
          <ol data-testid="top-services" data-amount={top?.totalP} className="flex flex-col">
            {(top?.top ?? []).map((s, i) => (
              <li key={s.key} data-testid="top-service" data-amount={s.netP} data-value={s.qty} className="flex min-w-0 items-center gap-3 border-b border-hairline py-2 last:border-b-0">
                <span className="icon-well flex size-7 shrink-0 items-center justify-center text-xs font-semibold nums">{num(i + 1)}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate text-[0.8125rem] font-medium">{locale === "bn" ? s.nameBn : s.nameEn}</span>
                    <MoneyText poisha={s.netP} className="shrink-0 font-mono text-[0.8125rem]" />
                  </span>
                  <span className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                    <span className="shrink-0">{t("dashboard.exec.top.sold", { count: num(s.qty) })}</span>
                    {s.category ? <span className="shrink-0 truncate">· {tk(`reports.enum.category.${s.category}`)}</span> : null}
                    <ShareBar pct={top?.totalP ? (s.netP / top.totalP) * 100 : 0} className="ml-auto max-w-24" />
                  </span>
                </span>
              </li>
            ))}
            {top && !top.top.length ? <li className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.exec.top.empty")}</li> : null}
          </ol>
        </SectionCard>
      </div>

      {/* Cash and stock breakdowns */}
      <div className="grid grid-cols-1 gap-5 @min-[60rem]/dash:grid-cols-2">
        <SectionCard title={t("dashboard.exec.cash.title")} subtitle={t("dashboard.exec.cash.subtitle")} icon={CircleDollarSign} size="sm" action={<DrillLink href="/cab" />}>
          <CashTable rows={positions?.cash ?? []} total={positions?.cashTotalP ?? 0} />
        </SectionCard>
        <SectionCard title={t("dashboard.exec.stock.title")} subtitle={t("dashboard.exec.stock.subtitle")} icon={Package} size="sm" action={<DrillLink href={irtHref("IRT-23", null, locationId)} />}>
          <ul className="flex flex-col gap-3" data-testid="stock-by-location">
            {(positions?.stockByLocation ?? []).map((r) => {
              const l = LOCATIONS.find((x) => x.id === r.locationId)
              return (
                <li key={r.locationId} className="flex flex-col gap-1.5" data-location={l?.code} data-amount={r.valueP}>
                  <span className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                    <span className="flex items-center gap-2">
                      <span lang="en" className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[0.625rem] font-semibold">
                        {l?.code}
                      </span>
                      {l?.name[locale]}
                    </span>
                    <MoneyText poisha={r.valueP} className="font-mono" />
                  </span>
                  <ShareBar pct={positions?.stockTotalP ? (r.valueP / positions.stockTotalP) * 100 : 0} color={SERIES_COLOR[l?.code ?? "GUL"]} />
                </li>
              )
            })}
            <li className="flex items-baseline justify-between gap-3 border-t border-hairline pt-2 text-[0.8125rem] text-muted-foreground">
              <span>{t("dashboard.exec.stock.transit")}</span>
              <MoneyText poisha={positions?.inTransitP ?? 0} className="font-mono" />
            </li>
          </ul>
        </SectionCard>
      </div>
    </div>
  )
}

function AgingBar({ buckets }: { buckets: { current: number; d0_30: number; d31_60: number; d61_90: number; over90: number } }) {
  const { tk, money } = useLocale()
  const total = Object.values(buckets).reduce((s, v) => s + v, 0)
  const parts: { key: keyof typeof buckets; color: string }[] = [
    { key: "current", color: "var(--success)" },
    { key: "d0_30", color: "var(--chart-1)" },
    { key: "d31_60", color: "var(--warning)" },
    { key: "d61_90", color: "var(--chart-5)" },
    { key: "over90", color: "var(--destructive)" },
  ]
  return (
    <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
      {total > 0
        ? parts.map((p) =>
            buckets[p.key] > 0 ? (
              <span key={p.key} title={`${tk(`reports.enum.bucket.${p.key}`)}: ${money(buckets[p.key])}`} style={{ width: `${(buckets[p.key] / total) * 100}%`, background: p.color }} className="h-full" />
            ) : null
          )
        : null}
    </span>
  )
}

function StockSplit({ rows, total }: { rows: { locationId: string; valueP: number }[]; total: number }) {
  const { money, locale } = useLocale()
  return (
    <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
      {total > 0
        ? rows.map((r) => {
            const l = LOCATIONS.find((x) => x.id === r.locationId)
            return r.valueP > 0 ? (
              <span key={r.locationId} title={`${l?.name[locale]}: ${money(r.valueP)}`} style={{ width: `${(r.valueP / total) * 100}%`, background: SERIES_COLOR[l?.code ?? "GUL"] }} className="h-full" />
            ) : null
          })
        : null}
    </span>
  )
}

function AlertRow({ alert, filtered }: { alert: AlertFigure; filtered: boolean }) {
  const { t, num } = useLocale()
  const Icon = ALERT_ICON[alert.kind]
  const label = t(`dashboard.exec.alerts.kinds.${alert.kind}` as "dashboard.exec.alerts.kinds.reorder", {
    days: num(alert.kind === "pdc-due" ? rules.pdcWarnDays : rules.expiryWarnDays),
  })
  const tone = alert.count ? (alert.kind === "approvals" || alert.kind === "bills-on-hold" ? "text-warning" : "text-destructive") : "text-muted-foreground"
  return (
    <li data-testid="alert-item" data-kind={alert.kind} data-value={alert.count} data-href={alert.href} className="flex min-w-0 items-center gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <span className={cn("icon-well flex size-9 shrink-0 items-center justify-center", tone)}>
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.8125rem] font-medium">{label}</span>
        <DrillLink href={alert.href} className="self-start" />
      </span>
      {filtered && alert.companyWide ? <span className="hidden text-[0.625rem] text-muted-foreground @min-[20rem]:inline">{t("dashboard.common.companyWide")}</span> : null}
      <span className={cn("nums min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-semibold", alert.count ? "count-badge" : "bg-surface-raised text-muted-foreground")}>{num(alert.count)}</span>
    </li>
  )
}

function JobsTable({ studios }: { studios: StudioOps[] }) {
  const { t, num, locale } = useLocale()
  return (
    <div className="@container/jobs overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="h-7 rounded-l-md bg-surface-raised px-2 text-left font-medium" />
            {STUDIO_STATUSES.map((s) => (
              <th key={s} className="h-7 bg-surface-raised px-1.5 text-right font-medium whitespace-nowrap">
                {t(`dashboard.exec.jobs.status.${s}` as "dashboard.exec.jobs.status.booked")}
              </th>
            ))}
            <th className="h-7 rounded-r-md bg-surface-raised px-2 text-right font-medium text-destructive" title={t("dashboard.exec.jobs.late")}>
              <AlarmClock className="ml-auto size-3.5" aria-label={t("dashboard.exec.jobs.late")} />
            </th>
          </tr>
        </thead>
        <tbody>
          {studios.map((st) => (
            <tr key={st.locationId} data-testid="jobs-row" data-location={st.code}>
              <td className="h-8 border-b border-hairline px-2 whitespace-nowrap">
                <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: SERIES_COLOR[st.code] }} />
                {LOCATIONS.find((l) => l.id === st.locationId)?.name[locale]}
              </td>
              {STUDIO_STATUSES.map((s) => (
                <td key={s} data-testid="jobs-cell" data-location={st.code} data-status={s} data-value={st.counts[s]} className="h-8 border-b border-hairline px-1.5 text-right font-mono">
                  {num(st.counts[s])}
                </td>
              ))}
              <td data-testid="jobs-late" data-location={st.code} data-value={st.late} title={t("dashboard.common.late", { count: num(st.late) })} className={cn("h-8 border-b border-hairline px-2 text-right font-mono", st.late ? "text-destructive" : "text-muted-foreground")}>
                {num(st.late)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BayBlock({ ops }: { ops: StudioOps }) {
  const { t, num, pct, locale } = useLocale()
  const name = LOCATIONS.find((l) => l.id === ops.locationId)?.name[locale]
  return (
    <div data-testid="bay-studio" data-location={ops.code} data-value={Math.round(ops.utilisationPct * 10) / 10} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] font-medium">
          <span className="size-2 shrink-0 rounded-full" style={{ background: SERIES_COLOR[ops.code] }} />
          <span className="truncate">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{t("dashboard.exec.bays.bayCount", { count: num(ops.bayCount) })}</span>
        </span>
        <span className="figure shrink-0 text-xl">{pct(ops.utilisationPct, 0)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t("dashboard.exec.bays.detail", { minutes: num(ops.scheduledMinutes), total: num(ops.bayMinutes) })}</p>
      <div className="grid grid-cols-[2.5rem_1fr_2.75rem] items-center gap-x-2 gap-y-1.5">
        {ops.bays.map((b) => (
          <React.Fragment key={b.bayId}>
            <span lang="en" className="font-mono text-[0.6875rem] font-semibold">
              {b.code}
            </span>
            <ShareBar pct={b.pct} color={SERIES_COLOR[ops.code]} />
            <span className="text-right text-[0.6875rem] text-muted-foreground nums">{pct(b.pct, 0)}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function CashTable({ rows, total }: { rows: CashAccountFigure[]; total: number }) {
  const { t, tk, locale } = useLocale()
  return (
    <div data-testid="cash-position" data-amount={total} className="flex flex-col">
      {CASH_KINDS.map((kind) => {
        const list = rows.filter((r) => r.kind === kind)
        if (!list.length) return null
        const subtotal = list.reduce((s, r) => s + r.balanceP, 0)
        return (
          <div key={kind} className="flex flex-col border-b border-hairline py-1.5 last:border-b-0">
            <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium">
              <span>{tk(`reports.enum.cashKind.${kind}`)}</span>
              <MoneyText poisha={subtotal} className="font-mono" />
            </div>
            {list.map((r) => (
              <div key={r.id} data-testid="cash-account" data-code={r.code} data-amount={r.balanceP} className="flex items-baseline justify-between gap-3 pl-3 text-xs text-muted-foreground">
                <span className="truncate">{locale === "bn" ? r.nameBn : r.nameEn}</span>
                <MoneyText poisha={r.balanceP} colorize className="font-mono" />
              </div>
            ))}
          </div>
        )
      })}
      <div className="flex items-baseline justify-between gap-3 rounded-md bg-surface-raised px-2 py-1.5 text-[0.8125rem] font-semibold">
        <span>{t("dashboard.exec.cash.total")}</span>
        <MoneyText poisha={total} className="font-mono" />
      </div>
    </div>
  )
}
