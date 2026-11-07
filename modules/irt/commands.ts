import { z } from "zod"

import { dhakaDate } from "@/core/clock/dates"
import { queueEmail } from "@/core/connectors/email"
import type { ReportDefinitionRow, ReportScheduleRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { DATASET_BY_CODE } from "@/core/reports/datasets"
import { suiteOf, type AppCode, type SuiteCode } from "@/core/security/types"

import { HHMM_PATTERN, nextRunAfter } from "./schedule"

/**
 * IRT commands (implementation_plan.md §6.2): saved reports from the
 * builder, schedules (simulated email), run history, and the system command
 * the `irt.schedules` sweeper job uses to send what is due.
 */

const filter = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "in", "gte", "lte", "between", "contains"]),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
})

const reportInput = z.object({
  id: z.string().optional(),
  expectedVersion: z.number().int().optional(),
  nameEn: z.string().trim().min(2).max(80),
  nameBn: z.string().trim().max(80).optional(),
  descriptionEn: z.string().trim().max(200).optional(),
  descriptionBn: z.string().trim().max(200).optional(),
  dataset: z.string().min(1),
  columns: z.array(z.string()).min(1),
  filters: z.array(filter).default([]),
  groupBy: z.array(z.string()).max(2).default([]),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
  totals: z.array(z.string()).default([]),
  chart: z
    .object({
      kind: z.enum(["bar", "line", "donut"]),
      x: z.string(),
      y: z.string(),
      series: z.string().optional(),
    })
    .nullable()
    .optional(),
  dateRange: z
    .object({
      field: z.string(),
      lastDays: z.number().int().positive().optional(),
      preset: z.enum(["mtd", "ytd", "last-month"]).optional(),
    })
    .nullable()
    .optional(),
  shared: z.boolean().default(true),
})

function suiteOfDataset(app: string): SuiteCode {
  try {
    return suiteOf(app as AppCode)
  } catch {
    return "csc"
  }
}

/** The saved report's own (non-system) definition, editable only by its owner. */
async function ownReport(tx: Tx, id: string, expectedVersion?: number): Promise<ReportDefinitionRow> {
  const def = await tx.get("reportDefinitions", id, { expectedVersion })
  if (def.isSystem) tx.reject("IRT_SYSTEM_REPORT", { name: def.nameEn })
  if (def.ownerId !== tx.actor.userId) tx.reject("IRT_NOT_OWNER", { name: def.nameEn })
  return def
}

/* ------------------------------------------------------------------ *
 * irt.saveReport
 * ------------------------------------------------------------------ */

export const saveReport = defineCommand({
  name: "irt.saveReport",
  permission: "irt.builder.create",
  input: reportInput,
  async run(tx, input) {
    const dataset = DATASET_BY_CODE.get(input.dataset)
    if (!dataset) return tx.reject("IRT_DATASET_UNKNOWN", { dataset: input.dataset })
    const fields = new Map(dataset.fields.map((f) => [f.key, f]))
    const known = (key: string) => {
      if (!fields.has(key)) tx.reject("IRT_FIELD_UNKNOWN", { field: key, dataset: input.dataset })
    }
    input.columns.forEach(known)
    input.groupBy.forEach(known)
    input.filters.forEach((f) => known(f.field))
    for (const key of input.totals) {
      known(key)
      const type = fields.get(key)!.type
      if (type !== "money" && type !== "number") tx.reject("IRT_TOTAL_NOT_NUMERIC", { field: key })
    }
    if (input.sort) known(input.sort.field)
    if (input.chart) {
      known(input.chart.x)
      known(input.chart.y)
      if (input.chart.series) known(input.chart.series)
    }
    if (input.dateRange) known(input.dateRange.field)

    const body = {
      nameEn: input.nameEn,
      nameBn: input.nameBn?.trim() || input.nameEn,
      descriptionEn: input.descriptionEn || undefined,
      descriptionBn: input.descriptionBn || undefined,
      suite: suiteOfDataset(dataset.app),
      app: dataset.app,
      dataset: dataset.code,
      columns: input.columns,
      filters: input.filters,
      groupBy: input.groupBy.length ? input.groupBy : undefined,
      sort: input.sort ?? undefined,
      totals: input.totals,
      chart: input.chart ?? undefined,
      dateRange: input.dateRange ?? undefined,
      shared: input.shared,
    }

    let def: ReportDefinitionRow
    if (input.id) {
      await ownReport(tx, input.id, input.expectedVersion)
      def = await tx.update("reportDefinitions", input.id, body)
    } else {
      const serial = await tx.nextNumber("irt:report")
      def = tx.insert("reportDefinitions", {
        ...body,
        code: `RPT-${String(serial).padStart(4, "0")}`,
        isSystem: false,
        ownerId: tx.actor.userId,
      })
    }
    tx.emit("ReportSaved", { refs: { reportId: def.id }, params: { name: def.nameEn, code: def.code }, locationId: null })
    return { reportId: def.id, code: def.code }
  },
})

export const deleteReport = defineCommand({
  name: "irt.deleteReport",
  permission: "irt.builder.create",
  input: z.object({ id: z.string().min(1), expectedVersion: z.number().int().optional() }),
  async run(tx, input) {
    const def = await ownReport(tx, input.id, input.expectedVersion)
    for (const schedule of await tx.list("reportSchedules", "definitionId", def.id)) {
      await tx.remove("reportSchedules", schedule.id)
    }
    await tx.remove("reportDefinitions", def.id)
    return { deleted: true }
  },
})

/* ------------------------------------------------------------------ *
 * irt.recordRun
 * ------------------------------------------------------------------ */

export const recordRun = defineCommand({
  name: "irt.recordRun",
  permission: "irt.app.view",
  input: z.object({
    definitionId: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
    rowCount: z.number().int().min(0),
  }),
  async run(tx, input) {
    await tx.get("reportDefinitions", input.definitionId)
    const run = tx.insert("reportRuns", {
      definitionId: input.definitionId,
      runBy: tx.actor.userId,
      at: tx.now(),
      params: input.params,
      rowCount: input.rowCount,
    })
    return { runId: run.id }
  },
})

/* ------------------------------------------------------------------ *
 * Schedules
 * ------------------------------------------------------------------ */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const saveSchedule = defineCommand({
  name: "irt.saveSchedule",
  permission: "irt.schedule.edit",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: z.number().int().optional(),
    definitionId: z.string().min(1),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    time: z.string(),
    recipients: z.array(z.string().trim().toLowerCase()).min(1),
    format: z.enum(["csv", "pdf"]),
    active: z.boolean().default(true),
  }),
  async run(tx, input) {
    const def = await tx.get("reportDefinitions", input.definitionId)
    if (!HHMM_PATTERN.test(input.time)) tx.reject("IRT_TIME_INVALID", { time: input.time })
    const recipients = [...new Set(input.recipients.filter(Boolean))]
    if (!recipients.length) tx.reject("IRT_RECIPIENTS_REQUIRED")
    const bad = recipients.find((r) => !EMAIL.test(r))
    if (bad) tx.reject("IRT_EMAIL_INVALID", { email: bad })
    const body = {
      definitionId: def.id,
      frequency: input.frequency,
      time: input.time,
      recipients,
      format: input.format,
      active: input.active,
      nextDueAt: input.active ? nextRunAfter(input.frequency, input.time, tx.now()) : undefined,
    }
    let schedule: ReportScheduleRow
    if (input.id) {
      await tx.get("reportSchedules", input.id, { expectedVersion: input.expectedVersion })
      schedule = await tx.update("reportSchedules", input.id, body)
    } else {
      schedule = tx.insert("reportSchedules", { ...body, ownerId: tx.actor.userId })
    }
    tx.emit("ReportScheduled", {
      refs: { reportId: def.id },
      params: { name: def.nameEn, code: def.code, frequency: input.frequency },
      locationId: null,
    })
    return { scheduleId: schedule.id, nextDueAt: schedule.nextDueAt ?? null }
  },
})

/** "Sends" one schedule (simulated email with the report named as an attachment). */
async function send(tx: Tx, schedule: ReportScheduleRow, advance: boolean): Promise<void> {
  const def = await tx.find("reportDefinitions", schedule.definitionId)
  const day = dhakaDate(tx.now())
  const name = def?.nameEn ?? schedule.definitionId
  const code = def?.code ?? "RPT"
  queueEmail(tx, {
    to: schedule.recipients,
    subjectKey: "irt.email.subject",
    params: { name, code, date: day },
    attachments: [`${code}-${day}.${schedule.format}`],
    refs: { reportId: schedule.definitionId },
  })
  await tx.update("reportSchedules", schedule.id, {
    lastSentAt: tx.now(),
    ...(advance ? { nextDueAt: nextRunAfter(schedule.frequency, schedule.time, tx.now()) } : {}),
  })
  tx.emit("ReportEmailed", {
    refs: { reportId: schedule.definitionId },
    params: { name, code, count: schedule.recipients.length },
    locationId: null,
  })
}

/** "Send now" from the schedules screen (does not move the next due time). */
export const sendScheduleNow = defineCommand({
  name: "irt.sendScheduleNow",
  permission: "irt.schedule.edit",
  input: z.object({ scheduleId: z.string().min(1) }),
  async run(tx, input) {
    const schedule = await tx.get("reportSchedules", input.scheduleId)
    await send(tx, schedule, false)
    return { sent: true }
  },
})

/** The sweeper job's command: sends every active schedule that is due (once each). */
export const sendDueSchedules = defineCommand({
  name: "irt.sendDueSchedules",
  permission: "system",
  input: z.object({ ids: z.array(z.string()) }),
  async run(tx, input) {
    let sent = 0
    for (const id of input.ids) {
      const schedule = await tx.find("reportSchedules", id)
      if (!schedule || !schedule.active || !schedule.nextDueAt || schedule.nextDueAt > tx.now()) continue
      await send(tx, schedule, true)
      sent += 1
    }
    return { sent }
  },
})
