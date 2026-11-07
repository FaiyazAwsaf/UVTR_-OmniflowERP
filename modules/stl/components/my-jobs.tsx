"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Wrench } from "lucide-react"

import { UserAvatar } from "@/components/shared/avatars"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { atDhaka, dhakaDate, dhakaTime } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { BayRow, JobTaskRow, SalesOrderLineRow, SalesOrderRow, VehicleRow } from "@/core/db/schema"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { recipeFor } from "@/modules/pc/pricing"
import { useCatalogue } from "@/modules/pc/queries"
import { useSyncFlash } from "@/components/shell/use-sync-flash"

import { MINUTE } from "../orders"
import { ClassTag, useStudio, useUserMap, VehicleCell } from "./kit"
import { ExtraConsumptionButton, TaskActions } from "./job-parts"

type Job = { task: JobTaskRow; order: SalesOrderRow; line?: SalesOrderLineRow; vehicle?: VehicleRow; bay?: BayRow }

/**
 * /stl/my-jobs: the technician's own tasks today (the studio manager sees
 * every task at the studio): start, finish (the recipe is issued at
 * finish), record extra consumables or returns.
 */
export function MyJobs() {
  const db = useDb()
  const { t, locale, num } = useLocale()
  const { userId } = useSession()
  const studio = useStudio()
  const users = useUserMap()
  const isManager = useCan("stl.qc.check", studio.locationId)
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs || Date.now())
  const jobs = useLiveQuery(async () => {
    if (!userId) return []
    const dayStart = atDhaka(today, "00:00")
    const dayEnd = dayStart + 24 * 60 * MINUTE
    const tasks = isManager && studio.locationId
      ? await db.jobTasks.where("locationId").equals(studio.locationId).toArray()
      : await db.jobTasks.where("technicianId").equals(userId).toArray()
    const mine = tasks.filter(
      (x) =>
        x.status === "in-progress" ||
        (x.status === "queued" && x.plannedStart < dayEnd) ||
        (x.status === "done" && (x.finishedAt ?? 0) >= dayStart)
    )
    const orders = new Map((await db.salesOrders.bulkGet([...new Set(mine.map((x) => x.orderId))])).filter(Boolean).map((o) => [o!.id, o!]))
    const live = mine.filter((x) => {
      const o = orders.get(x.orderId)
      return o && o.status !== "cancelled" && (x.status !== "queued" || o.status === "booked" || o.status === "in-progress")
    })
    const [lines, vehicles, bays] = await Promise.all([
      db.salesOrderLines.bulkGet(live.map((x) => x.orderLineId)),
      db.vehicles.bulkGet([...new Set([...orders.values()].map((o) => o.vehicleId).filter((v): v is string => !!v))]),
      db.bays.toArray(),
    ])
    const vm = new Map(vehicles.filter(Boolean).map((v) => [v!.id, v!]))
    return live
      .map((task, i) => {
        const order = orders.get(task.orderId)!
        return { task, order, line: lines[i] ?? undefined, vehicle: order.vehicleId ? vm.get(order.vehicleId) : undefined, bay: bays.find((b) => b.id === task.bayId) }
      })
      .sort((a, b) => a.task.plannedStart - b.task.plannedStart)
  }, [db, userId, isManager, studio.locationId, today])

  const groups: { key: "inProgress" | "upNext" | "done"; list: Job[] }[] = [
    { key: "inProgress", list: (jobs ?? []).filter((j) => j.task.status === "in-progress") },
    { key: "upNext", list: (jobs ?? []).filter((j) => j.task.status === "queued") },
    { key: "done", list: (jobs ?? []).filter((j) => j.task.status === "done") },
  ]
  const me = userId ? users.get(userId) : undefined

  return (
    <div className="flex flex-col gap-4" data-testid="my-jobs">
      <PageHeader
        title={t("stl.pages.myJobs")}
        subtitle={isManager ? t("stl.jobs.managerSubtitle") : t("stl.jobs.subtitle", { name: userName(me, locale) })}
      />
      {jobs && !jobs.length ? <EmptyState icon={Wrench} title={t("stl.jobs.none")} description={t("stl.jobs.noneHint")} /> : null}
      {groups.map((g) =>
        g.list.length ? (
          <SectionCard key={g.key} title={`${t(`stl.jobs.groups.${g.key}`)} · ${num(g.list.length)}`} size="sm">
            <div className="grid gap-3 @container/jobs lg:grid-cols-2">
              {g.list.map((job) => (
                <JobTile key={job.task.id} job={job} showTech={isManager} techName={userName(users.get(job.task.technicianId), locale)} tech={users.get(job.task.technicianId)} />
              ))}
            </div>
          </SectionCard>
        ) : null
      )}
    </div>
  )
}

function JobTile({ job, showTech, techName, tech }: { job: Job; showTech: boolean; techName: string; tech?: Parameters<typeof UserAvatar>[0]["user"] }) {
  const { t, locale, num } = useLocale()
  const catalogue = useCatalogue()
  const flash = useSyncFlash(`${job.task.status}:${job.task.version}`)
  const { task, order, line, vehicle, bay } = job
  const recipe = catalogue && line?.kind === "service" ? recipeFor(catalogue, line.refId, line.vehicleClass ?? "SD") : []
  return (
    <article className={cn("flex flex-col gap-3 rounded-lg bg-surface-raised/50 p-4", flash)} data-testid="job-task" data-status={task.status} data-order-no={order.orderNo}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <VehicleCell vehicle={vehicle} />
            <ClassTag cls={vehicle?.vehicleClass} />
          </div>
          <div className="mt-1 text-[0.9375rem] font-semibold">{locale === "bn" ? line?.descriptionBn : line?.descriptionEn}</div>
          <div className="nums text-xs text-muted-foreground">
            <Link href={`/stl/orders/${order.id}`} lang="en" className="font-mono text-link hover:underline">
              {order.orderNo}
            </Link>{" "}
            · <span lang="en" className="font-mono">{bay?.code}</span> · {dhakaTime(task.plannedStart)} · {t("stl.quote.minutes", { min: num(task.plannedMinutes) })}
          </div>
          {showTech ? (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {tech ? <UserAvatar user={tech} role="TECHNICIAN" size={20} /> : null}
              {techName}
            </div>
          ) : null}
        </div>
        <DocStatus status={task.status} />
      </div>
      {recipe.length && task.status !== "done" ? (
        <div className="rounded-md bg-card/70 px-3 py-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t("stl.jobs.recipe")}</div>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
            {recipe.map((r) => {
              const item = catalogue?.items.get(r.itemId)
              return (
                <li key={r.itemId} className="flex justify-between gap-2">
                  <span className="truncate">{nameOf(item, locale)}</span>
                  <span className="nums shrink-0 font-mono">
                    {num(r.qtyBase)} {item?.baseUom}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <TaskActions task={task} orderStatus={order.status} />
        {task.status === "in-progress" ? <ExtraConsumptionButton order={order} taskId={task.id} /> : null}
        {task.status === "done" && task.minutes ? <span className="text-xs text-muted-foreground">{t("stl.jobs.took", { min: num(task.minutes) })}</span> : null}
      </div>
    </article>
  )
}
