"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { atDhaka, dhakaDate, dhakaTime } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id, JobTaskRow, SalesOrderRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { useCatalogue } from "@/modules/pc/queries"

import { scheduleOrder } from "../commands"
import { isTaskLine, lineMinutes, MINUTE } from "../orders"
import { Field, useTechnicians } from "./kit"

/** Quarter-hour start times inside studio hours (09:00 to 20:45). */
export const SLOT_TIMES = Array.from({ length: 48 }, (_, i) => {
  const m = 9 * 60 + i * 15
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
})

export type ScheduleTarget = { order: SalesOrderRow; bayId?: Id; start?: number }

const BUSY = new Set(["booked", "in-progress", "qc"])

/**
 * Schedule an order into a bay (stl.scheduleOrder): bay, day and start time,
 * and a technician per service or add-on line. Opened by dropping a job
 * card on a bay lane (prefilled) or from the card's Schedule action.
 */
export function ScheduleDialog({ target, onClose }: { target: ScheduleTarget | null; onClose: () => void }) {
  const db = useDb()
  const { t, locale, num, time: clock } = useLocale()
  const catalogue = useCatalogue()
  const schedule = useCommand(scheduleOrder)
  const order = target?.order
  const technicians = useTechnicians(order?.locationId ?? null)
  const data = useLiveQuery(async () => {
    if (!order) return null
    const [bays, lines, own] = await Promise.all([
      db.bays.where("locationId").equals(order.locationId).toArray(),
      db.salesOrderLines.where("orderId").equals(order.id).sortBy("lineNo"),
      db.jobTasks.where("orderId").equals(order.id).toArray(),
    ])
    const others = (await db.jobTasks.where("locationId").equals(order.locationId).toArray()).filter((x) => x.orderId !== order.id && x.status !== "done")
    const statuses = new Map((await db.salesOrders.bulkGet([...new Set(others.map((x) => x.orderId))])).filter(Boolean).map((o) => [o!.id, o!.status]))
    return {
      bays: bays.filter((b) => b.active).sort((a, b) => a.code.localeCompare(b.code)),
      lines: lines.filter(isTaskLine).filter((l) => l.status !== "done"),
      own,
      others: others.filter((x) => BUSY.has(statuses.get(x.orderId) ?? "")),
    }
  }, [db, order?.id, order?.locationId])

  const [bayId, setBayId] = React.useState<Id | null>(null)
  const [day, setDay] = React.useState("")
  const [time, setTime] = React.useState("11:00")
  const [techs, setTechs] = React.useState<Record<Id, Id>>({})
  const [seen, setSeen] = React.useState<ScheduleTarget | null>(null)

  if (target !== seen) {
    setSeen(target)
    if (target) {
      const start = target.start ?? target.order.scheduledAt
      setBayId(target.bayId ?? target.order.bayId ?? null)
      setDay(dhakaDate(start))
      const hhmm = dhakaTime(start)
      setTime(SLOT_TIMES.find((s) => s >= hhmm) ?? "11:00")
      setTechs({})
    }
  }

  const start = day ? atDhaka(day, time) : 0
  const busyAt = (techId: Id, from: number, to: number, others: JobTaskRow[]) =>
    others.some((x) => x.technicianId === techId && x.plannedStart < to && from < x.plannedStart + x.plannedMinutes * MINUTE)

  // Default each line to its scheduled technician, else the first one free at its slot.
  const assignments = React.useMemo(() => {
    if (!data || !catalogue) return []
    let cursor = start
    return data.lines.map((line) => {
      const minutes = lineMinutes(catalogue, line)
      const from = cursor
      cursor += minutes * MINUTE
      const existing = data.own.find((x) => x.orderLineId === line.id)
      const chosen =
        techs[line.id] ??
        existing?.technicianId ??
        technicians.find((u) => !busyAt(u.id, from, from + minutes * MINUTE, data.others))?.id ??
        technicians[0]?.id ??
        ""
      return { line, minutes, from, technicianId: chosen }
    })
  }, [data, catalogue, start, techs, technicians])

  const submit = async () => {
    if (!order || !bayId || !start) return
    const out = await schedule.run({
      orderId: order.id,
      expectedVersion: order.version,
      bayId,
      start,
      assignments: assignments.map((a) => ({ orderLineId: a.line.id, technicianId: a.technicianId })),
    })
    if (out) {
      const bay = data?.bays.find((b) => b.id === bayId)
      toast.success(t("stl.schedule.done", { no: order.orderNo, bay: bay?.code ?? "" }))
      onClose()
    }
  }

  const bay = data?.bays.find((b) => b.id === bayId)
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="schedule-dialog">
        <DialogHeader>
          <DialogTitle>{t("stl.schedule.title", { no: order?.orderNo ?? "" })}</DialogTitle>
          <DialogDescription>{t("stl.schedule.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("stl.schedule.bay")}>
            <Select value={bayId ?? ""} onValueChange={(v) => v && setBayId(v as Id)}>
              <SelectTrigger data-testid="schedule-bay">
                <SelectValue>{() => (bay ? `${bay.code} · ${nameOf(bay, locale)}` : t("stl.schedule.chooseBay"))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(data?.bays ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id} data-testid="schedule-bay-option">
                    <span lang="en" className="font-mono">{b.code}</span> {nameOf(b, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("common.date")}>
            <DateField value={day} onChange={setDay} data-testid="schedule-day" />
          </Field>
          <Field label={t("common.time")}>
            <Select value={time} onValueChange={(v) => v && setTime(v)}>
              <SelectTrigger data-testid="schedule-time">
                <SelectValue>{() => <span className="nums">{time}</span>}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {SLOT_TIMES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="nums">{s}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t("stl.schedule.technicians")}</span>
          {assignments.map((a) => (
            <div key={a.line.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-raised/60 px-3 py-2" data-testid="schedule-line">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.8125rem] font-medium">{locale === "bn" ? a.line.descriptionBn : a.line.descriptionEn}</div>
                <div className="nums text-xs text-muted-foreground">
                  {clock(a.from)} · {t("stl.quote.minutes", { min: num(a.minutes) })}
                </div>
              </div>
              <Select value={a.technicianId} onValueChange={(v) => v && setTechs((cur) => ({ ...cur, [a.line.id]: v as Id }))}>
                <SelectTrigger className="w-44" data-testid="schedule-technician">
                  <SelectValue>{() => userName(technicians.find((u) => u.id === a.technicianId), locale) || t("stl.schedule.chooseTech")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {technicians.map((u) => {
                    const busy = data ? busyAt(u.id, a.from, a.from + a.minutes * MINUTE, data.others) : false
                    return (
                      <SelectItem key={u.id} value={u.id} data-testid="schedule-technician-option" data-user={u.username}>
                        {userName(u, locale)}
                        {busy ? <span className="ml-auto pl-2 text-xs text-warning">{t("stl.schedule.busy")}</span> : null}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          ))}
          {data && !assignments.length ? <p className="text-sm text-muted-foreground">{t("stl.schedule.nothing")}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!bayId || !start || !assignments.length || schedule.pending || assignments.some((a) => !a.technicianId)} data-testid="schedule-submit">
            {t("stl.schedule.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
