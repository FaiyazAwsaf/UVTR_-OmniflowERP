"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { CalendarClock, ClipboardList, GripVertical } from "lucide-react"

import { UserAvatar } from "@/components/shared/avatars"
import { PageHeader } from "@/components/shared/page-header"
import { RegPlate } from "@/components/shared/reg-plate"
import { Button } from "@/components/ui/button"
import { atDhaka, dhakaDate, dhakaTime } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { BayRow, Id, JobTaskRow, SalesOrderLineRow, SalesOrderRow, ServiceRow, UserRow, VehicleRow } from "@/core/db/schema"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { useSyncFlash } from "@/components/shell/use-sync-flash"

import { MINUTE } from "../orders"
import { ClassTag, StudioSelect, useStudio, useUserMap } from "./kit"
import { ScheduleDialog, type ScheduleTarget } from "./schedule-dialog"

const COLUMNS = ["booked", "in-progress", "qc", "ready", "delivered"] as const
type Column = (typeof COLUMNS)[number]
const DELIVERED = new Set(["delivered", "invoiced", "closed"])
const OPEN_DAY = "09:00"
const LANE_HOURS = 12
const SLOT_MIN = 30

type Card = {
  order: SalesOrderRow
  column: Column
  vehicle?: VehicleRow
  partyName: string
  lines: SalesOrderLineRow[]
  tasks: JobTaskRow[]
  schedulable: boolean
}

/**
 * /stl/board: the job board of a studio (plan §9). Columns booked → in
 * progress → QC → ready → delivered (today), cards with the plate, vehicle,
 * class, services, promised time (red when late), bay and technicians; bay
 * lanes 09:00 to 21:00 with the now line. Drag a card onto a lane to
 * schedule it there (dnd-kit); everything is live across windows.
 */
export function JobBoard() {
  const db = useDb()
  const router = useRouter()
  const { t, locale, num } = useLocale()
  const studio = useStudio()
  const loc = studio.locationId
  const users = useUserMap()
  const nowMs = useNow(30_000)
  const today = dhakaDate(nowMs || now())
  const canSchedule = useCan("stl.order.edit", loc)
  const canBook = useCan("stl.order.create", loc)
  const [target, setTarget] = React.useState<ScheduleTarget | null>(null)
  const [dragging, setDragging] = React.useState<Card | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const data = useLiveQuery(async () => {
    if (!loc) return null
    const all = await db.salesOrders.where("locationId").equals(loc).toArray()
    const orders = all.filter(
      (o) => COLUMNS.includes(o.status as Column) || (DELIVERED.has(o.status) && !!o.deliveredAt && dhakaDate(o.deliveredAt) === today)
    )
    const ids = orders.map((o) => o.id)
    const dayStart = atDhaka(today, "00:00")
    const [lines, tasksOfOrders, tasksToday, bays, vehicles, parties, services] = await Promise.all([
      db.salesOrderLines.where("orderId").anyOf(ids).toArray(),
      db.jobTasks.where("orderId").anyOf(ids).toArray(),
      db.jobTasks.where("plannedStart").between(dayStart - 3 * 24 * 60 * MINUTE, dayStart + 24 * 60 * MINUTE).toArray(),
      db.bays.where("locationId").equals(loc).toArray(),
      db.vehicles.bulkGet([...new Set(orders.map((o) => o.vehicleId).filter((v): v is string => !!v))]),
      db.parties.bulkGet([...new Set(orders.map((o) => o.partyId))]),
      db.services.toArray(),
    ])
    const laneOrders = new Map((await db.salesOrders.bulkGet([...new Set(tasksToday.map((x) => x.orderId))])).filter(Boolean).map((o) => [o!.id, o!]))
    return { orders, lines, tasksOfOrders, tasksToday: tasksToday.filter((x) => x.locationId === loc), laneOrders, bays, vehicles, parties, services }
  }, [db, loc, today])

  const cards = React.useMemo<Card[]>(() => {
    if (!data) return []
    const vehicles = new Map(data.vehicles.filter(Boolean).map((v) => [v!.id, v!]))
    const parties = new Map(data.parties.filter(Boolean).map((p) => [p!.id, p!]))
    return data.orders
      .map((order) => {
        const lines = data.lines.filter((l) => l.orderId === order.id).sort((a, b) => a.lineNo - b.lineNo)
        const tasks = data.tasksOfOrders.filter((x) => x.orderId === order.id)
        const taskLines = lines.filter((l) => (l.kind === "service" || l.kind === "add-on") && l.status === "open")
        const schedulable =
          (order.status === "booked" || order.status === "in-progress") &&
          taskLines.some((l) => !tasks.some((x) => x.orderLineId === l.id && x.status !== "queued"))
        const column: Column = DELIVERED.has(order.status) ? "delivered" : (order.status as Column)
        return { order, column, vehicle: order.vehicleId ? vehicles.get(order.vehicleId) : undefined, partyName: nameOf(parties.get(order.partyId), locale), lines, tasks, schedulable }
      })
      .sort((a, b) => a.order.promisedAt - b.order.promisedAt)
  }, [data, locale])
  const serviceById = React.useMemo(() => new Map((data?.services ?? []).map((s) => [s.id, s])), [data?.services])

  const onDragStart = (event: DragStartEvent) => setDragging(cards.find((c) => c.order.id === event.active.id) ?? null)
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    const card = cards.find((c) => c.order.id === event.active.id)
    const over = event.over?.id ? String(event.over.id) : ""
    if (!card || !over.startsWith("slot:")) return
    const [, bayId, start] = over.split(":")
    setTarget({ order: card.order, bayId, start: Number(start) })
  }

  const bays = (data?.bays ?? []).filter((b) => b.active).sort((a, b) => a.code.localeCompare(b.code))
  const studioName = nameOf(studio.studios.find((s) => s.id === loc), locale)

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="board">
      <PageHeader
        title={t("stl.pages.board")}
        subtitle={t("stl.board.subtitle", { studio: studioName, count: num(cards.filter((c) => c.column !== "delivered").length) })}
        actions={
          <>
            <StudioSelect value={loc} onChange={studio.setLocationId} studios={studio.studios} />
            {canBook ? (
              <Button nativeButton={false} render={<Link href="/stl/orders/new" />}>
                <ClipboardList data-icon="inline-start" />
                {t("stl.pages.orderNew")}
              </Button>
            ) : null}
          </>
        }
      />
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <div className="grid min-w-[60rem] grid-cols-5 gap-3">
            {COLUMNS.map((col) => {
              const list = cards.filter((c) => c.column === col)
              return (
                <section key={col} className="flex min-w-0 flex-col gap-2 rounded-lg bg-card/60 p-2.5" data-testid="board-column" data-status={col}>
                  <header className="flex items-center justify-between px-1.5 pt-0.5">
                    <h2 className="text-[0.8125rem] font-semibold">{t(`stl.board.columns.${col}`)}</h2>
                    <span className="count-badge nums">{num(list.length)}</span>
                  </header>
                  <div className="flex flex-col gap-2">
                    {list.map((card) => (
                      <JobCard
                        key={card.order.id}
                        card={card}
                        users={users}
                        services={serviceById}
                        bays={bays}
                        nowMs={nowMs}
                        draggable={canSchedule && card.schedulable}
                        onOpen={() => router.push(`/stl/orders/${card.order.id}`)}
                        onSchedule={() => setTarget({ order: card.order })}
                      />
                    ))}
                    {!list.length ? <p className="px-1.5 py-3 text-center text-xs text-muted-foreground">{t("stl.board.empty")}</p> : null}
                  </div>
                </section>
              )
            })}
          </div>
        </div>

        <section className="surface-card flex min-w-0 flex-col gap-3 p-4" data-testid="bay-lanes">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[0.9375rem] font-semibold">{t("stl.board.lanes")}</h2>
            <span className="text-xs text-muted-foreground">{canSchedule ? t("stl.board.dragHint") : t("stl.board.lanesHint")}</span>
          </header>
          <div className="flex min-w-0 flex-col gap-1.5">
            <HourScale />
            {bays.map((bay) => (
              <BayLane
                key={bay.id}
                bay={bay}
                today={today}
                nowMs={nowMs}
                tasks={(data?.tasksToday ?? []).filter((x) => x.bayId === bay.id && data?.laneOrders.get(x.orderId)?.status !== "cancelled")}
                orders={data?.laneOrders}
                users={users}
                dragging={!!dragging}
              />
            ))}
          </div>
        </section>
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="w-64 rotate-1 opacity-90">
              <JobCardBody card={dragging} users={users} services={serviceById} bays={bays} nowMs={nowMs} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <ScheduleDialog target={target} onClose={() => setTarget(null)} />
    </div>
  )
}

function JobCard({
  card,
  users,
  services,
  bays,
  nowMs,
  draggable,
  onOpen,
  onSchedule,
}: {
  card: Card
  users: Map<Id, UserRow>
  services: Map<Id, ServiceRow>
  bays: BayRow[]
  nowMs: number
  draggable: boolean
  onOpen: () => void
  onSchedule: () => void
}) {
  const { t } = useLocale()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.order.id, disabled: !draggable })
  const flash = useSyncFlash(`${card.order.status}:${card.order.version}`)
  return (
    <div
      ref={setNodeRef}
      data-testid="job-card"
      data-order-no={card.order.orderNo}
      data-status={card.order.status}
      className={cn("group/card relative rounded-lg", isDragging && "opacity-40", flash)}
    >
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()} className="cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 rounded-lg">
        <JobCardBody card={card} users={users} services={services} bays={bays} nowMs={nowMs} />
      </div>
      {draggable ? (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            type="button"
            onClick={onSchedule}
            aria-label={t("stl.board.schedule")}
            title={t("stl.board.schedule")}
            data-testid="job-schedule"
            className="flex size-7 items-center justify-center rounded-md text-link hover:bg-primary-soft"
          >
            <CalendarClock className="size-4" />
          </button>
          <span {...listeners} {...attributes} className="flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-surface-raised" data-testid="job-drag">
            <GripVertical className="size-4" />
          </span>
        </div>
      ) : null}
    </div>
  )
}

function JobCardBody({ card, users, services, bays, nowMs }: { card: Card; users: Map<Id, UserRow>; services: Map<Id, ServiceRow>; bays: BayRow[]; nowMs: number }) {
  const { t, locale } = useLocale()
  const { order, vehicle } = card
  const late = ["booked", "in-progress", "qc"].includes(order.status) && nowMs > 0 && order.promisedAt < nowMs
  const bay = bays.find((b) => b.id === order.bayId)
  const techIds = [...new Set(card.tasks.map((x) => x.technicianId))]
  const chips = card.lines.filter((l) => l.kind !== "item" && l.status !== "cancelled")
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-card p-3 shadow-(--card-shadow)">
      <div className="flex items-start justify-between gap-2 pr-16">
        {vehicle ? <RegPlate regNo={vehicle.regNo} /> : <span className="text-xs text-muted-foreground">{card.partyName}</span>}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
          <span className="truncate">{vehicle ? `${vehicle.make} ${vehicle.model}` : t("stl.board.goods")}</span>
          <ClassTag cls={vehicle?.vehicleClass} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{card.partyName}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {chips.slice(0, 4).map((l) => {
          const sv = l.kind === "service" ? services.get(l.refId) : undefined
          return (
            <span
              key={l.id}
              lang="en"
              title={locale === "bn" ? l.descriptionBn : l.descriptionEn}
              className={cn("rounded-full px-2 py-0.5 font-mono text-[0.625rem]", l.status === "done" ? "bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-success" : "bg-surface-raised")}
            >
              {sv?.code ?? "+"}
            </span>
          )
        })}
        {chips.length > 4 ? <span className="text-[0.625rem] text-muted-foreground">+{chips.length - 4}</span> : null}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn("nums", late ? "font-semibold text-destructive" : "text-muted-foreground")} data-late={late || undefined}>
          {t("stl.board.promised", { time: dhakaTime(order.promisedAt) })}
        </span>
        <span className="flex items-center gap-1.5">
          {bay ? <span lang="en" className="rounded bg-surface-raised px-1.5 font-mono text-[0.625rem]">{bay.code}</span> : null}
          <span className="flex -space-x-1.5">
            {techIds.slice(0, 3).map((id) => {
              const u = users.get(id)
              return u ? <UserAvatar key={id} user={u} role="TECHNICIAN" size={22} className="ring-2 ring-card" /> : null
            })}
          </span>
        </span>
      </div>
      <div lang="en" className="font-mono text-[0.625rem] text-muted-foreground">
        {order.orderNo}
        {techIds.length ? ` · ${techIds.map((id) => userName(users.get(id), locale).split(" ")[0]).join(", ")}` : ""}
      </div>
    </div>
  )
}

const pct = (ms: number, dayStart: number) => ((ms - dayStart) / (LANE_HOURS * 60 * MINUTE)) * 100

function HourScale() {
  const { num } = useLocale()
  return (
    <div className="flex items-end gap-2">
      <span className="w-16 shrink-0" />
      <div className="relative h-4 min-w-0 flex-1">
        {Array.from({ length: LANE_HOURS + 1 }, (_, i) => (
          <span key={i} className={cn("absolute -translate-x-1/2 text-[0.625rem] text-muted-foreground nums", i % 2 === 1 && "hidden @min-[40rem]:inline")} style={{ left: `${(i / LANE_HOURS) * 100}%` }}>
            {num(9 + i)}
          </span>
        ))}
      </div>
    </div>
  )
}

function BayLane({
  bay,
  today,
  nowMs,
  tasks,
  orders,
  users,
  dragging,
}: {
  bay: BayRow
  today: string
  nowMs: number
  tasks: JobTaskRow[]
  orders?: Map<Id, SalesOrderRow>
  users: Map<Id, UserRow>
  dragging: boolean
}) {
  const { locale, t } = useLocale()
  const dayStart = atDhaka(today, OPEN_DAY)
  const dayEnd = dayStart + LANE_HOURS * 60 * MINUTE
  const visible = tasks.filter((x) => x.plannedStart < dayEnd && x.plannedStart + x.plannedMinutes * MINUTE > dayStart)
  const nowPct = nowMs >= dayStart && nowMs <= dayEnd ? pct(nowMs, dayStart) : null
  return (
    <div className="flex items-stretch gap-2" data-testid="bay-lane" data-bay={bay.code}>
      <div className="flex w-16 shrink-0 flex-col justify-center">
        <span lang="en" className="font-mono text-xs font-semibold">{bay.code}</span>
        <span className="truncate text-[0.625rem] text-muted-foreground">{t(`stl.board.bayKind.${bay.kind}`)}</span>
      </div>
      <div className="relative h-11 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-raised/50">
        {Array.from({ length: LANE_HOURS - 1 }, (_, i) => (
          <span key={i} className="absolute inset-y-0 w-px bg-hairline" style={{ left: `${((i + 1) / LANE_HOURS) * 100}%` }} />
        ))}
        {visible.map((x) => {
          const order = orders?.get(x.orderId)
          const left = Math.max(0, pct(x.plannedStart, dayStart))
          const right = Math.min(100, pct(x.plannedStart + x.plannedMinutes * MINUTE, dayStart))
          const tech = users.get(x.technicianId)
          return (
            <Link
              key={x.id}
              href={`/stl/orders/${x.orderId}`}
              data-testid="lane-task"
              data-status={x.status}
              title={`${order?.orderNo ?? ""} · ${userName(tech, locale)} · ${dhakaTime(x.plannedStart)}`}
              className={cn(
                "absolute inset-y-1 flex min-w-0 items-center overflow-hidden rounded px-1.5 text-[0.625rem] leading-tight font-medium",
                x.status === "done" && "bg-[color-mix(in_oklch,var(--success)_22%,transparent)] text-success",
                x.status === "in-progress" && "bg-primary text-primary-foreground",
                x.status === "queued" && "bg-[color-mix(in_oklch,var(--info)_22%,transparent)] text-info"
              )}
              style={{ left: `${left}%`, width: `${Math.max(1.5, right - left)}%` }}
            >
              <span lang="en" className="truncate font-mono">
                {order?.orderNo.slice(-5)} {userName(tech, locale).split(" ")[0]}
              </span>
            </Link>
          )
        })}
        {nowPct !== null ? <span className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-primary" style={{ left: `${nowPct}%` }} data-testid="now-line" /> : null}
        {dragging ? (
          <div className="absolute inset-0 z-20 flex">
            {Array.from({ length: (LANE_HOURS * 60) / SLOT_MIN }, (_, i) => (
              <DropSlot key={i} id={`slot:${bay.id}:${dayStart + i * SLOT_MIN * MINUTE}`} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DropSlot({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return <div ref={setNodeRef} className={cn("h-full flex-1 border-r border-transparent", isOver && "bg-primary/35")} />
}
