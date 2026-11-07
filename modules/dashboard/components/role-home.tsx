"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  AlarmClock,
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  CalendarClock,
  CarFront,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  FilePen,
  FileSearch,
  FileWarning,
  Gauge,
  HandCoins,
  History,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Lock,
  MonitorSmartphone,
  Package,
  PackageCheck,
  PackageX,
  Receipt,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Timer,
  Truck,
  UserX,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { locations as LOCATIONS } from "@/config/brand.config"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { ROLE_LANDING } from "@/core/security/seed-users"
import type { RoleCode } from "@/core/security/types"
import { useCan } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { loadRoleHome } from "../queries"
import type { HomeKpi, TodoItem, TodoKind } from "../types"
import {
  FormattedFigure,
  GradientKpi,
  ListRow,
  TONE_DOT,
  useDemoToday,
} from "./kit"

const VARIANTS = ["cyan", "yellow", "pink", "purple"] as const

const KPI_ICON: Record<string, LucideIcon> = {
  revenueToday: BarChart3,
  collectionsToday: HandCoins,
  cash: Wallet,
  approvals: Inbox,
  overdueReceivables: Receipt,
  billsOnHold: FileWarning,
  pdcDue: Banknote,
  myDrafts: FilePen,
  awaitingApproval: FileClock,
  jobsToday: CarFront,
  lateJobs: AlarmClock,
  bookingsLater: CalendarClock,
  openQuotes: ClipboardList,
  counterQueue: ShoppingCart,
  takingsToday: HandCoins,
  pendingMfs: Smartphone,
  tillBalance: Wallet,
  myTasks: Wrench,
  inProgress: Timer,
  doneToday: BadgeCheck,
  lateTasks: AlarmClock,
  lowStock: PackageX,
  expiringLots: CalendarClock,
  grnPending: PackageCheck,
  inTransit: Truck,
  openPos: ShoppingCart,
  overduePos: AlarmClock,
  lockedUsers: Lock,
  activeSessions: MonitorSmartphone,
  failedToday: KeyRound,
  activeUsers: Users,
  auditToday: ScrollText,
  blockedToday: ShieldAlert,
  decidedToday: ListChecks,
  usersWithAccess: ShieldCheck,
}

const TODO_ICON: Record<TodoKind, LucideIcon> = {
  approval: Inbox,
  "late-job": AlarmClock,
  qc: ClipboardCheck,
  ready: CarFront,
  booking: CalendarClock,
  quote: ClipboardList,
  task: Wrench,
  counter: ShoppingCart,
  "counter-invoice": Receipt,
  pickup: CarFront,
  "petty-pending": FileClock,
  mfs: Smartphone,
  overdue: Receipt,
  "bill-hold": FileWarning,
  pdc: Banknote,
  draft: FilePen,
  "voucher-pending": FileClock,
  "payment-pending": FileClock,
  "low-stock": PackageX,
  expiring: CalendarClock,
  grn: PackageCheck,
  "transfer-out": Truck,
  "transfer-in": ArrowLeftRight,
  quarantine: ShieldAlert,
  "po-overdue": AlarmClock,
  "pr-approved": ClipboardCheck,
  "locked-user": UserX,
  "failed-signin": KeyRound,
  "password-change": KeyRound,
  audit: History,
  "access-review": ShieldCheck,
  report: FileSearch,
  dashboard: LayoutDashboard,
}

/** Which sub-line a to-do's moment or day reads as. */
const AT_KEY: Partial<Record<TodoKind, string>> = {
  "late-job": "promised",
  qc: "promised",
  ready: "promised",
  pickup: "promised",
  booking: "starts",
  task: "starts",
}
const DAY_KEY: Partial<Record<TodoKind, string>> = {
  pdc: "due",
  grn: "expected",
  "po-overdue": "expected",
  quote: "validUntil",
}

/**
 * /home: the signed-in user's role home (plan §9): four KPIs and a to-do
 * list for the role, the approvals waiting for this user, the owner's
 * summary and quick links. Studio-bound roles see their studio. Every card
 * and line links to the screen to act on it; everything is live.
 */
export function RoleHome() {
  const db = useDb()
  const { t, tk, num, locale } = useLocale()
  const { userId, locationId } = useSession()
  const { today, nowMs } = useDemoToday()
  const canDashboard = useCan("dashboard.app.view")
  const data = useLiveQuery(
    async () =>
      userId && today
        ? loadRoleHome(db, { userId, today, nowMs, locationId })
        : undefined,
    [db, userId, today, nowMs, locationId]
  )
  const role = data?.role
  const roleRow = useLiveQuery(
    async () =>
      role && role !== "NONE"
        ? db.roles.where("code").equals(role).first()
        : undefined,
    [db, role]
  )
  const scopeIds = data?.scopeIds ?? []
  const scope =
    !data || LOCATIONS.every((l) => scopeIds.includes(l.id))
      ? t("dashboard.home.allLocations")
      : LOCATIONS.filter((l) => scopeIds.includes(l.id))
          .map((l) => l.name[locale])
          .join(", ")
  const approvals = (data?.todos ?? []).filter((x) => x.kind === "approval")
  const todos = (data?.todos ?? []).filter((x) => x.kind !== "approval")
  const landing =
    role && role !== "NONE" ? ROLE_LANDING[role as RoleCode] : null

  return (
    <div
      className="@container/home flex min-w-0 flex-col gap-5"
      data-testid="role-home"
      data-role={role}
      data-location={data?.locationId ?? "all"}
    >
      <PageHeader
        title={t("dashboard.home.title")}
        subtitle={
          roleRow
            ? t("dashboard.home.subtitle", {
                role: locale === "bn" ? roleRow.nameBn : roleRow.nameEn,
                location: scope ?? "",
              })
            : scope
        }
        actions={
          canDashboard ? (
            <Button
              nativeButton={false}
              render={<Link href="/dashboard" />}
              data-testid="home-open-dashboard"
            >
              <LayoutDashboard />
              {t("dashboard.home.owner.open")}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 @min-[30rem]/home:grid-cols-2 @min-[68rem]/home:grid-cols-4">
        {(data?.kpis ?? []).map((k, i) => (
          <HomeKpiCard
            key={k.key}
            kpi={k}
            variant={VARIANTS[i % VARIANTS.length]}
            scope={scopeIds.join(",")}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 @min-[68rem]/home:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard
          title={t("dashboard.home.todo.title")}
          subtitle={
            data
              ? t("dashboard.home.todo.subtitle", { count: num(todos.length) })
              : undefined
          }
          icon={ListChecks}
        >
          {data && !todos.length ? (
            <EmptyState
              icon={BadgeCheck}
              title={t("dashboard.home.todo.empty")}
              size="sm"
            />
          ) : (
            <ul className="flex flex-col" data-testid="todo-list">
              {todos.map((item) => (
                <TodoRow
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  today={today}
                />
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard
            title={t("dashboard.home.approvals.title")}
            icon={Inbox}
            size="sm"
            seeAllHref="/approvals"
          >
            {approvals.length ? (
              <ul
                className="flex flex-col"
                data-testid="home-approvals"
                data-value={approvals.length}
              >
                {approvals.slice(0, 4).map((item) => (
                  <TodoRow key={item.id} item={item} today={today} compact />
                ))}
              </ul>
            ) : (
              <p
                className="py-3 text-center text-sm text-muted-foreground"
                data-testid="home-approvals"
                data-value={0}
              >
                {t("dashboard.home.approvals.empty")}
              </p>
            )}
          </SectionCard>
          {canDashboard ? (
            <SectionCard
              title={t("dashboard.home.owner.title")}
              icon={LayoutDashboard}
              size="sm"
            >
              <p className="mb-3 text-[0.8125rem] text-muted-foreground">
                {t("dashboard.home.owner.body")}
              </p>
              <Link
                href="/dashboard"
                data-testid="home-dashboard-link"
                className="text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
              >
                {t("dashboard.home.owner.open")}
              </Link>
            </SectionCard>
          ) : null}
          <SectionCard
            title={t("dashboard.home.links.title")}
            icon={LayoutGrid}
            size="sm"
          >
            <ul className="flex flex-col">
              {landing && landing !== "/home" ? (
                <ListRow
                  href={landing}
                  icon={Gauge}
                  title={tk(`${landing.split("/")[1]}.name`)}
                />
              ) : null}
              <ListRow
                href="/apps"
                icon={LayoutGrid}
                title={t("dashboard.home.links.apps")}
              />
              <ListRow
                href="/approvals"
                icon={Inbox}
                title={t("dashboard.home.links.approvals")}
              />
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

function HomeKpiCard({
  kpi,
  variant,
  scope,
}: {
  kpi: HomeKpi
  variant: (typeof VARIANTS)[number]
  scope: string
}) {
  const { t, tk } = useLocale()
  return (
    <GradientKpi
      testId="home-kpi"
      drillLabel={t("dashboard.common.open")}
      kind={kpi.key}
      variant={variant}
      icon={KPI_ICON[kpi.key] ?? Package}
      title={tk(`dashboard.home.kpi.${kpi.key}`)}
      value={<FormattedFigure value={kpi.value} format={kpi.format} />}
      amount={kpi.format === "money" ? kpi.value : undefined}
      dataValue={kpi.format === "money" ? undefined : kpi.value}
      flashKey={kpi.value}
      scope={scope}
      href={kpi.href}
    />
  )
}

/**
 * One to-do line, worded in the window's language. `compact` (the approvals
 * rail) leads with the document number and its kind, so a narrow rail still
 * shows which document waits.
 */
function TodoRow({
  item,
  today,
  compact = false,
}: {
  item: TodoItem
  today: string
  compact?: boolean
}) {
  const { tk, num, money, time, dmy, locale } = useLocale()
  const name = item.name
    ? locale === "bn"
      ? item.name.bn
      : item.name.en
    : undefined
  const detail = item.detail
    ? locale === "bn"
      ? item.detail.bn
      : item.detail.en
    : undefined
  const when = (ms: number) =>
    dhakaDate(ms) === today ? time(ms) : `${dmy(ms)} ${time(ms)}`
  const parts: string[] = []
  if (compact && item.labelKey) parts.push(tk(item.labelKey))
  if (name) parts.push(name)
  if (detail) parts.push(detail)
  if (!compact && item.labelKey) parts.push(tk(item.labelKey))
  if (item.at && !compact)
    parts.push(
      tk(`dashboard.home.todo.sub.${AT_KEY[item.kind] ?? "at"}`, {
        time: when(item.at),
      })
    )
  if (item.day)
    parts.push(
      tk(`dashboard.home.todo.sub.${DAY_KEY[item.kind] ?? "dated"}`, {
        date: dmy(item.day),
      })
    )
  if (item.kind === "overdue" && item.count)
    parts.push(
      tk("dashboard.home.todo.sub.daysPastDue", { days: num(item.count) })
    )
  if (item.kind === "locked-user" && item.count)
    parts.push(
      tk("dashboard.home.todo.sub.attempts", { count: num(item.count) })
    )
  if (item.kind === "dashboard" && item.amountP !== undefined)
    parts.push(
      tk("dashboard.home.todo.sub.revenueToday", {
        amount: money(item.amountP),
      })
    )
  const title =
    compact && item.ref
      ? item.ref
      : tk(`dashboard.home.todo.kinds.${item.kind}`, {
          // A locked user reads by name ("Unlock Polash Sarkar"), not by login id.
          ref:
            item.kind === "locked-user" && item.name
              ? item.name[locale]
              : (item.ref ?? ""),
          count: num(item.count ?? 0),
        })
  return (
    <ListRow
      testId="todo-item"
      data={{ kind: item.kind, ref: item.ref, id: item.id }}
      href={item.href}
      icon={TODO_ICON[item.kind] ?? ListChecks}
      tone={item.tone}
      title={
        <span className="flex min-w-0 items-center gap-2">
          {item.tone ? (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                TONE_DOT[item.tone]
              )}
            />
          ) : null}
          <span
            className={cn("truncate", compact && "font-mono text-[0.8125rem]")}
            lang={compact ? "en" : undefined}
          >
            {title}
          </span>
        </span>
      }
      sub={parts.join(" · ")}
      right={
        item.amountP !== undefined && item.kind !== "dashboard" ? (
          <MoneyText poisha={item.amountP} className="font-mono" />
        ) : undefined
      }
    />
  )
}
