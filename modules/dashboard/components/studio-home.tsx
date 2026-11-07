"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { AlarmClock, CalendarClock, CarFront, ClipboardList, Gauge, HandCoins, KanbanSquare, ShoppingCart, Store, TrendingUp } from "lucide-react"

import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { RegPlate } from "@/components/shared/reg-plate"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { locations as LOCATIONS } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import { useCan } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { StudioSelect, useStudio } from "@/modules/stl/components/kit"

import { irtHref, loadStudioHome } from "../queries"
import { STUDIO_STATUSES, type StudioOrder } from "../types"
import { FormattedFigure, GradientKpi, useDemoToday } from "./kit"

/**
 * /stl: the studio home (plan §9): for the window's studio (a studio picker
 * for users at several studios, e.g. HQ users), today's orders by status,
 * today's bookings by start time with bay and technicians, late jobs
 * (promised time passed and not ready), the KPIs (jobs today, revenue
 * today, bay use, deposits taken today) and quick links to the job board,
 * a new booking and the counter. Live across windows.
 */
export function StudioHome() {
  const db = useDb()
  const { t, num, locale } = useLocale()
  const studio = useStudio()
  const loc = studio.locationId
  const { today, nowMs } = useDemoToday()
  const canBook = useCan("stl.order.create", loc)
  const canCounter = useCan("si.counter.checkout", loc)
  const data = useLiveQuery(async () => (loc && today ? loadStudioHome(db, { locationId: loc, today, nowMs }) : undefined), [db, loc, today, nowMs])
  const location = LOCATIONS.find((l) => l.id === loc)
  const todayRange = today ? { from: today, to: today } : null

  if (studio.studios.length === 0 && loc === null) {
    return (
      <div data-testid="studio-home" className="flex flex-col gap-5">
        <PageHeader title={t("dashboard.studio.title")} />
        <EmptyState icon={Store} title={t("dashboard.studio.noStudio")} />
      </div>
    )
  }

  return (
    <div className="@container/studio flex min-w-0 flex-col gap-5" data-testid="studio-home" data-location={loc ?? undefined} data-code={location?.code}>
      <PageHeader
        title={t("dashboard.studio.title")}
        subtitle={location ? t("dashboard.studio.subtitle", { studio: location.name[locale] }) : null}
        actions={
          <>
            <StudioSelect value={loc} onChange={studio.setLocationId} studios={studio.studios} />
            <Button variant="outline" nativeButton={false} render={<Link href="/stl/board" />} data-testid="studio-link-board">
              <KanbanSquare data-icon="inline-start" />
              {t("dashboard.studio.links.board")}
            </Button>
            {canCounter ? (
              <Button variant="outline" nativeButton={false} render={<Link href="/si/counter" />} data-testid="studio-link-counter">
                <ShoppingCart data-icon="inline-start" />
                {t("dashboard.studio.links.counter")}
              </Button>
            ) : null}
            {canBook ? (
              <Button nativeButton={false} render={<Link href="/stl/orders/new" />} data-testid="studio-link-booking">
                <ClipboardList data-icon="inline-start" />
                {t("dashboard.studio.links.newBooking")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 @min-[30rem]/studio:grid-cols-2 @min-[68rem]/studio:grid-cols-4">
        <GradientKpi
          testId="studio-kpi"
          kind="jobs"
          variant="cyan"
          icon={CarFront}
          title={t("dashboard.studio.kpi.jobs")}
          value={<FormattedFigure value={data?.orders.length ?? 0} format="count" />}
          dataValue={data?.orders.length}
          flashKey={data?.orders.length}
          caption={t("dashboard.studio.caption.jobs", { count: num(data?.late.length ?? 0) })}
          href="/stl/board"
        />
        <GradientKpi
          testId="studio-kpi"
          kind="revenue"
          variant="yellow"
          icon={TrendingUp}
          title={t("dashboard.studio.kpi.revenue")}
          value={<FormattedFigure value={data?.revenueTodayP ?? 0} format="money" />}
          amount={data?.revenueTodayP}
          flashKey={data?.revenueTodayP}
          caption={t("dashboard.studio.caption.revenue")}
          href={irtHref("IRT-16", todayRange, loc)}
        />
        <GradientKpi
          testId="studio-kpi"
          kind="bay-use"
          variant="pink"
          icon={Gauge}
          title={t("dashboard.studio.kpi.bayUse")}
          value={<FormattedFigure value={data?.ops.utilisationPct ?? 0} format="pct" />}
          dataValue={data ? Math.round(data.ops.utilisationPct * 10) / 10 : undefined}
          flashKey={data?.ops.scheduledMinutes}
          caption={t("dashboard.studio.caption.bayUse", { minutes: num(data?.ops.scheduledMinutes ?? 0), total: num(data?.ops.bayMinutes ?? 0) })}
          href={irtHref("IRT-21", todayRange, loc)}
        />
        <GradientKpi
          testId="studio-kpi"
          kind="deposits"
          variant="purple"
          icon={HandCoins}
          title={t("dashboard.studio.kpi.deposits")}
          value={<FormattedFigure value={data?.depositsTodayP ?? 0} format="money" />}
          amount={data?.depositsTodayP}
          flashKey={data?.depositsTodayP}
          caption={t("dashboard.studio.caption.deposits", { count: num(data?.depositsCount ?? 0) })}
          href={irtHref("IRT-07", todayRange, loc)}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 @min-[68rem]/studio:grid-cols-[minmax(0,1fr)_21rem]">
        <SectionCard title={t("dashboard.studio.orders.title")} icon={KanbanSquare} size="sm" seeAllHref="/stl/board">
          {data && !data.orders.length ? (
            <EmptyState icon={CarFront} title={t("dashboard.studio.orders.empty")} size="sm" />
          ) : (
            <div className="grid grid-cols-1 gap-3 @min-[34rem]/studio:grid-cols-2 @min-[52rem]/studio:grid-cols-3 @min-[80rem]/studio:grid-cols-5" data-testid="studio-orders">
              {STUDIO_STATUSES.map((s) => {
                const list = (data?.orders ?? []).filter((o) => o.status === s)
                return (
                  <section key={s} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface-raised/40 p-2" data-testid="studio-column" data-status={s} data-value={list.length}>
                    <header className="flex items-center justify-between px-1">
                      <span className="text-[0.8125rem] font-semibold">{t(`dashboard.exec.jobs.status.${s}` as "dashboard.exec.jobs.status.booked")}</span>
                      <span className="count-badge nums min-w-6 px-1.5 text-center text-xs font-semibold">{num(list.length)}</span>
                    </header>
                    <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                      {list.map((o) => (
                        <OrderChip key={o.id} order={o} />
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title={t("dashboard.studio.late.title")} subtitle={t("dashboard.studio.late.subtitle")} icon={AlarmClock} size="sm">
          {data && !data.late.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.studio.late.empty")}</p>
          ) : (
            <ul className="flex flex-col" data-testid="late-jobs">
              {(data?.late ?? []).map((o) => (
                <LateRow key={o.id} order={o} />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title={t("dashboard.studio.bookings.title")} subtitle={t("dashboard.studio.bookings.subtitle")} icon={CalendarClock} size="sm">
        {data && !data.bookings.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.studio.bookings.empty")}</p>
        ) : (
          <BookingsTable rows={data?.bookings ?? []} />
        )}
      </SectionCard>
    </div>
  )
}

function OrderChip({ order }: { order: StudioOrder }) {
  const { t, time } = useLocale()
  return (
    <li data-testid="studio-order" data-status={order.status} data-order-no={order.orderNo} data-late={order.late || undefined}>
      <Link href={`/stl/orders/${order.id}`} className="flex min-w-0 flex-col gap-1 rounded-md bg-card p-2 shadow-(--card-shadow) outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40">
        <span className="flex min-w-0 items-center justify-between gap-1.5">
          {order.regNo ? <RegPlate regNo={order.regNo} className="min-w-0" /> : <span className="truncate text-xs">{order.partyEn}</span>}
          <span lang="en" className="font-mono text-[0.625rem] text-muted-foreground">
            {order.bayCode ?? ""}
          </span>
        </span>
        <span lang="en" className="truncate font-mono text-[0.6875rem]">
          {order.orderNo}
        </span>
        <span className={cn("text-[0.6875rem] nums", order.late ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {t("dashboard.studio.late.promised", { time: time(order.promisedAt) })}
        </span>
      </Link>
    </li>
  )
}

function LateRow({ order }: { order: StudioOrder }) {
  const { t, time, locale } = useLocale()
  return (
    <li data-testid="late-job" data-order-no={order.orderNo} data-status={order.status} className="border-b border-hairline last:border-b-0">
      <Link href={`/stl/orders/${order.id}`} className="flex min-w-0 items-center gap-3 rounded-md px-1 py-2.5 outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40">
        <span className="icon-well flex size-9 shrink-0 items-center justify-center text-destructive">
          <AlarmClock className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span lang="en" className="truncate font-mono text-[0.8125rem] font-semibold">
            {order.orderNo}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {locale === "bn" ? order.partyBn : order.partyEn}
            {order.vehicle ? ` · ${order.vehicle}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs font-semibold text-destructive nums">{t("dashboard.studio.late.promised", { time: time(order.promisedAt) })}</span>
          <DocStatus status={order.status === "delivered" ? "delivered" : order.status} />
        </span>
      </Link>
    </li>
  )
}

function BookingsTable({ rows }: { rows: StudioOrder[] }) {
  const { t, time, locale } = useLocale()
  const th = "h-9 bg-surface-raised px-3 text-left font-medium whitespace-nowrap first:rounded-l-md last:rounded-r-md"
  const td = "h-11 border-b border-hairline px-3"
  return (
    <div className="@container/bk overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]" data-testid="studio-bookings">
        <thead>
          <tr>
            <th className={th}>{t("dashboard.studio.bookings.time")}</th>
            <th className={th}>{t("dashboard.studio.bookings.order")}</th>
            <th className={cn(th, "hidden @min-[40rem]/bk:table-cell")}>{t("dashboard.studio.bookings.customer")}</th>
            <th className={th}>{t("dashboard.studio.bookings.vehicle")}</th>
            <th className={th}>{t("dashboard.studio.bookings.bay")}</th>
            <th className={cn(th, "hidden @min-[48rem]/bk:table-cell")}>{t("dashboard.studio.bookings.technicians")}</th>
            <th className={cn(th, "hidden @min-[56rem]/bk:table-cell")}>{t("dashboard.studio.bookings.promised")}</th>
            <th className={th}>{t("dashboard.studio.bookings.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} data-testid="studio-booking" data-order-no={o.orderNo} className="hover:bg-primary-soft">
              <td className={cn(td, "font-mono nums")}>{time(o.scheduledAt)}</td>
              <td className={td}>
                <Link href={`/stl/orders/${o.id}`} lang="en" className="font-mono text-link hover:underline">
                  {o.orderNo}
                </Link>
              </td>
              <td className={cn(td, "hidden max-w-48 truncate @min-[40rem]/bk:table-cell")}>{locale === "bn" ? o.partyBn : o.partyEn}</td>
              <td className={td}>
                <span className="flex min-w-0 items-center gap-2">
                  {o.regNo ? <RegPlate regNo={o.regNo} /> : null}
                  <span className="hidden truncate text-xs text-muted-foreground @min-[34rem]/bk:inline">{o.vehicle}</span>
                </span>
              </td>
              <td className={cn(td, "font-mono")} lang="en">
                {o.bayCode ?? "-"}
              </td>
              <td className={cn(td, "hidden text-xs @min-[48rem]/bk:table-cell")}>{o.technicians.map((x) => (locale === "bn" ? x.bn : x.en).split(" ")[0]).join(", ") || "-"}</td>
              <td className={cn(td, "hidden nums @min-[56rem]/bk:table-cell", o.late && "font-semibold text-destructive")}>{time(o.promisedAt)}</td>
              <td className={td}>
                <DocStatus status={o.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
