"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarClock, Mail, Pencil, Plus, Send } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { PageHeader } from "@/components/shared/page-header"
import { SearchPicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useDb } from "@/core/db/DbProvider"
import type { EmailRow, ReportDefinitionRow, ReportScheduleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"
import { Field, ListTable, Mono, OptionSelect, type ListColumn } from "@/modules/sac/components/kit"

import { saveSchedule, sendScheduleNow } from "../commands"
import { reportName, useReportDefinitions } from "../queries"
import { HHMM_PATTERN } from "../schedule"

/**
 * /irt/schedules: report schedules (`irt.saveSchedule`, irt.schedule.edit)
 * and the simulated report emails the `irt.schedules` sweeper job sends.
 */
export function Schedules() {
  const { t, tk, num, locale, dmy } = useLocale()
  const db = useDb()
  const defs = useReportDefinitions()
  const canEdit = useCan("irt.schedule.edit")
  const send = useCommand(sendScheduleNow)
  const [editing, setEditing] = React.useState<ReportScheduleRow | "new" | null>(null)
  const schedules = useLiveQuery(async () => (await db.reportSchedules.toArray()).sort((a, b) => (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0)), [db])
  const emails = useLiveQuery(
    async () => (await db.emails.where("at").above(0).reverse().sortBy("at")).filter((e) => e.subjectKey === "irt.email.subject").slice(0, 40),
    [db]
  )
  const defById = new Map((defs ?? []).map((d) => [d.id, d]))

  const columns: ListColumn<ReportScheduleRow>[] = [
    {
      id: "report",
      header: t("irt.schedules.columns.report"),
      cell: (s) => {
        const def = defById.get(s.definitionId)
        return (
          <Link href={def ? `/irt/run/${def.code}` : "/irt"} className="flex min-w-0 flex-col">
            <span className="truncate font-medium hover:underline">{reportName(def, locale) || s.definitionId}</span>
            <Mono className="text-muted-foreground">{def?.code}</Mono>
          </Link>
        )
      },
    },
    {
      id: "when",
      header: t("irt.schedules.columns.when"),
      cell: (s) => (
        <span className="whitespace-nowrap">
          {t("irt.schedules.at", { frequency: tk(`irt.schedules.frequency.${s.frequency}`), time: s.time })}
        </span>
      ),
    },
    {
      id: "recipients",
      header: t("irt.schedules.columns.recipients"),
      hideBelow: "lg",
      cell: (s) => (
        <span title={s.recipients.join(", ")} className="text-muted-foreground">
          {t("irt.schedules.recipientsCount", { count: num(s.recipients.length) })}
        </span>
      ),
    },
    { id: "format", header: t("irt.schedules.columns.format"), hideBelow: "xl", cell: (s) => <Mono className="uppercase">{s.format}</Mono> },
    {
      id: "next",
      header: t("irt.schedules.columns.next"),
      hideBelow: "md",
      cell: (s) =>
        s.active && s.nextDueAt ? <DateText value={s.nextDueAt} variant="dmyTime" /> : <StatusText tone="muted">{t("irt.schedules.paused")}</StatusText>,
    },
    {
      id: "last",
      header: t("irt.schedules.columns.last"),
      hideBelow: "lg",
      cell: (s) =>
        s.lastSentAt ? (
          <DateText value={s.lastSentAt} variant="dmyTime" className="text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground">{t("irt.schedules.never")}</span>
        ),
    },
    {
      id: "active",
      header: t("irt.schedules.columns.active"),
      cell: (s) => (
        <StatusText tone={s.active ? "success" : "muted"} dot>
          {s.active ? t("irt.schedules.activeSwitch") : t("irt.schedules.paused")}
        </StatusText>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (s) =>
        canEdit ? (
          <span className="flex justify-end gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={send.pending}
              onClick={async () => {
                const result = await send.run({ scheduleId: s.id })
                if (result) {
                  toast.success(
                    t("irt.schedules.sent", { name: reportName(defById.get(s.definitionId), locale), count: num(s.recipients.length) })
                  )
                }
              }}
              data-testid="schedule-send"
            >
              <Send />
              {t("irt.schedules.send")}
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setEditing(s)} aria-label={t("irt.common.edit")} data-testid="schedule-edit">
              <Pencil />
            </Button>
          </span>
        ) : null,
    },
  ]

  const emailColumns: ListColumn<EmailRow>[] = [
    { id: "at", header: t("irt.schedules.sentAt"), cell: (e) => <DateText value={e.at} variant="dmyTime" /> },
    {
      id: "subject",
      header: t("irt.schedules.columns.report"),
      cell: (e) => (
        <span className="min-w-0 truncate">
          {t("irt.email.subject", {
            name: String(e.params.name ?? ""),
            code: String(e.params.code ?? ""),
            date: /^\d{4}-\d{2}-\d{2}$/.test(String(e.params.date)) ? dmy(String(e.params.date)) : String(e.params.date ?? ""),
          })}
        </span>
      ),
    },
    {
      id: "to",
      header: t("irt.schedules.to"),
      hideBelow: "md",
      cell: (e) => <Mono className="text-muted-foreground">{e.to.join(", ")}</Mono>,
    },
    { id: "file", header: t("irt.schedules.attachment"), hideBelow: "lg", cell: (e) => <Mono>{e.attachments.join(", ")}</Mono> },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("irt.schedules.title")}
        subtitle={t("irt.schedules.subtitle")}
        actions={
          <>
            <SimulatedBadge />
            {canEdit ? (
              <Button onClick={() => setEditing("new")} data-testid="schedule-new">
                <Plus />
                {t("irt.schedules.new")}
              </Button>
            ) : null}
          </>
        }
      />
      {!canEdit ? <p className="rounded-md bg-surface-raised px-4 py-3 text-sm text-muted-foreground">{t("irt.schedules.readOnly")}</p> : null}
      <SectionCard title={t("irt.schedules.title")} icon={CalendarClock} size="sm">
        <ListTable
          rows={schedules}
          columns={columns}
          rowKey={(s) => s.id}
          rowProps={(s) => ({ "data-testid": "schedule-row", "data-code": defById.get(s.definitionId)?.code, "data-active": String(s.active) })}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("irt.schedules.empty")}</p>}
        />
      </SectionCard>
      <SectionCard title={t("irt.schedules.outbox")} icon={Mail} size="sm" action={<SimulatedBadge />}>
        <ListTable
          rows={emails}
          columns={emailColumns}
          rowKey={(e) => e.id}
          dense
          pageSize={20}
          rowProps={() => ({ "data-testid": "report-email" })}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("irt.schedules.outboxEmpty")}</p>}
        />
      </SectionCard>
      <ScheduleDialog schedule={editing} defs={defs ?? []} onClose={() => setEditing(null)} />
    </div>
  )
}

type Draft = {
  definitionId: string | null
  frequency: ReportScheduleRow["frequency"]
  time: string
  recipients: string
  format: ReportScheduleRow["format"]
  active: boolean
}

function ScheduleDialog({
  schedule,
  defs,
  onClose,
}: {
  schedule: ReportScheduleRow | "new" | null
  defs: ReportDefinitionRow[]
  onClose: () => void
}) {
  const { t, tk, locale, dmy, time } = useLocale()
  const command = useCommand(saveSchedule)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [openedFor, setOpenedFor] = React.useState<string | null>(null)
  const key = schedule === null ? null : schedule === "new" ? "new" : schedule.id
  if (key !== openedFor) {
    setOpenedFor(key)
    setDraft(
      schedule === null
        ? null
        : schedule === "new"
          ? { definitionId: null, frequency: "weekly", time: "08:00", recipients: "", format: "csv", active: true }
          : {
              definitionId: schedule.definitionId,
              frequency: schedule.frequency,
              time: schedule.time,
              recipients: schedule.recipients.join(", "),
              format: schedule.format,
              active: schedule.active,
            }
    )
  }
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [field]: value } : d))
  const runnable = defs.filter((d) => !!d.dataset)
  const recipients = (draft?.recipients ?? "")
    .split(/[,;\s]+/)
    .map((r) => r.trim())
    .filter(Boolean)
  const valid = !!draft?.definitionId && HHMM_PATTERN.test(draft.time) && recipients.length > 0

  const submit = async () => {
    if (!draft?.definitionId) return
    const existing = schedule !== "new" && schedule ? schedule : null
    const result = await command.run({
      id: existing?.id,
      expectedVersion: existing?.version,
      definitionId: draft.definitionId,
      frequency: draft.frequency,
      time: draft.time,
      recipients,
      format: draft.format,
      active: draft.active,
    })
    if (!result) return
    toast.success(
      result.nextDueAt
        ? t("irt.schedules.saved", { next: `${dmy(result.nextDueAt)}, ${time(result.nextDueAt)}` })
        : t("irt.schedules.savedPaused")
    )
    onClose()
  }

  return (
    <Dialog open={schedule !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="schedule-form">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[1.0625rem] font-semibold">
            {schedule === "new" ? t("irt.schedules.formNew") : t("irt.schedules.formEdit")}
            <SimulatedBadge />
          </DialogTitle>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("irt.schedules.report")} className="sm:col-span-2">
              <SearchPicker
                items={runnable}
                value={draft.definitionId}
                onChange={(id) => set("definitionId", id)}
                getId={(d) => d.id}
                searchText={(d) => `${d.code} ${d.nameEn} ${d.nameBn}`}
                renderValue={(d) => `${d.code} · ${reportName(d, locale)}`}
                renderItem={(d) => (
                  <span className="flex items-center gap-2">
                    <Mono className="text-muted-foreground">{d.code}</Mono>
                    <span className="truncate">{reportName(d, locale)}</span>
                  </span>
                )}
                placeholder={t("irt.schedules.pickReport")}
                testId="schedule-report"
              />
            </Field>
            <Field label={t("irt.schedules.columns.when")}>
              <OptionSelect
                value={draft.frequency}
                onChange={(v) => set("frequency", v as Draft["frequency"])}
                label={t("irt.schedules.columns.when")}
                className="w-full"
                testId="schedule-frequency"
                options={(["daily", "weekly", "monthly"] as const).map((f) => ({ value: f, label: tk(`irt.schedules.frequency.${f}`) }))}
              />
            </Field>
            <Field label={t("irt.schedules.time")}>
              <Input
                lang="en"
                value={draft.time}
                onChange={(e) => set("time", e.target.value.replace(/[^\d:]/g, "").slice(0, 5))}
                aria-invalid={!HHMM_PATTERN.test(draft.time) || undefined}
                className="font-mono"
                data-testid="schedule-time"
              />
            </Field>
            <Field label={t("irt.schedules.recipients")} hint={t("irt.schedules.recipientsHint")} className="sm:col-span-2">
              <Input
                lang="en"
                value={draft.recipients}
                onChange={(e) => set("recipients", e.target.value)}
                placeholder="owner@example.com"
                className="font-mono"
                data-testid="schedule-recipients"
              />
            </Field>
            <Field label={t("irt.schedules.format")}>
              <OptionSelect
                value={draft.format}
                onChange={(v) => set("format", v as Draft["format"])}
                label={t("irt.schedules.format")}
                className="w-full"
                options={[
                  { value: "csv", label: "CSV" },
                  { value: "pdf", label: "PDF" },
                ]}
              />
            </Field>
            <label className="flex items-center justify-between gap-3 self-end rounded-md border border-border p-3 text-[0.8125rem]">
              {t("irt.schedules.activeSwitch")}
              <Switch checked={draft.active} onCheckedChange={(on) => set("active", !!on)} />
            </label>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || command.pending} data-testid="schedule-save">
            {t("irt.schedules.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
