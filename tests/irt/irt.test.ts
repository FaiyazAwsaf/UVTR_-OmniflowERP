import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { recordRun, saveReport, saveSchedule, sendScheduleNow } from "@/modules/irt/commands"
import { irtJobs } from "@/modules/irt/jobs"
import { accessKeyOf, defaultRange, narrowByDate, presetRange, rangeOfPreset } from "@/modules/irt/params"
import { nextRunAfter } from "@/modules/irt/schedule"

import { asSystem } from "../helpers/fixtures"
import { foundationDb, signedIn } from "../helpers/foundation"

/** The E16 report: revenue by service category × studio, last 30 days, bar chart. */
const E16 = {
  nameEn: "Revenue by category and studio",
  nameBn: "ধরন ও স্টুডিও অনুযায়ী আয়",
  dataset: "si.invoiceLines",
  columns: ["category", "location", "netP"],
  groupBy: ["category", "location"],
  totals: ["netP"],
  chart: { kind: "bar" as const, x: "category", y: "netP", series: "location" },
  dateRange: { field: "date", lastDays: 30 },
  shared: true,
}

let db: OmniflowDb
let rashed: Actor
beforeEach(async () => {
  db = await foundationDb("irt")
  rashed = await signedIn(db, "rashed")
})
afterEach(async () => {
  applyClockOffset(0)
  await db.delete()
})

async function sweep(): Promise<void> {
  const ctx = {
    db,
    now: now(),
    commitSystem: ((def: never, input: never) => commit(def, input, { db, actor: SYSTEM_ACTOR })) as never,
  }
  for (const job of irtJobs) await job.run(ctx)
}

describe("irt.saveReport (E16)", () => {
  it("saves the builder's report as RPT-0001 with ReportSaved; the owner edits it", async () => {
    const { result, events } = await commit(saveReport, E16, { db, actor: rashed })
    expect(result.code).toBe("RPT-0001")
    expect(events.map((e) => [e.type, e.refs.reportId])).toEqual([["ReportSaved", result.reportId]])
    const def = (await db.reportDefinitions.get(result.reportId))!
    expect(def).toMatchObject({ isSystem: false, ownerId: rashed.userId, suite: "sdm", app: "si", chart: E16.chart })

    await commit(saveReport, { ...E16, id: def.id, expectedVersion: def.version, nameEn: "Revenue mix" }, { db, actor: rashed })
    expect((await db.reportDefinitions.get(def.id))!.nameEn).toBe("Revenue mix")
    const second = await commit(saveReport, { ...E16, nameEn: "Second" }, { db, actor: rashed })
    expect(second.result.code).toBe("RPT-0002")
  })

  it("needs irt.builder.create, known fields and numeric totals; only the owner edits", async () => {
    const nayeem = await signedIn(db, "nayeem")
    await expect(commit(saveReport, E16, { db, actor: nayeem })).rejects.toMatchObject({ kind: "denied" })
    await expect(commit(saveReport, { ...E16, columns: ["nope"] }, { db, actor: rashed })).rejects.toMatchObject({ code: "IRT_FIELD_UNKNOWN" })
    await expect(commit(saveReport, { ...E16, totals: ["category"] }, { db, actor: rashed })).rejects.toMatchObject({
      code: "IRT_TOTAL_NOT_NUMERIC",
    })
    const { result } = await commit(saveReport, E16, { db, actor: rashed })
    const farzana = await signedIn(db, "farzana")
    await expect(commit(saveReport, { ...E16, id: result.reportId, nameEn: "Mine now" }, { db, actor: farzana })).rejects.toMatchObject({
      code: "IRT_NOT_OWNER",
    })
    await asSystem(db, async (tx) => {
      tx.insert("reportDefinitions", {
        id: "rpt_irt_31",
        code: "IRT-31",
        nameEn: "Login history",
        nameBn: "লগইন ইতিহাস",
        suite: "csc",
        app: "sac",
        dataset: "sac.logins",
        columns: ["date", "user", "result"],
        filters: [],
        totals: [],
        isSystem: true,
        shared: true,
      })
    })
    await expect(commit(saveReport, { ...E16, id: "rpt_irt_31" }, { db, actor: rashed })).rejects.toMatchObject({ code: "IRT_SYSTEM_REPORT" })
  })
})

describe("schedules and the irt.schedules job", () => {
  it("schedules a report, sends it once when due (simulated email), and not again", async () => {
    const report = await commit(saveReport, E16, { db, actor: rashed })
    const { result, events } = await commit(
      saveSchedule,
      { definitionId: report.result.reportId, frequency: "weekly", time: "08:00", recipients: ["Owner@Example.com"], format: "csv" },
      { db, actor: rashed }
    )
    expect(events.map((e) => e.type)).toEqual(["ReportScheduled"])
    expect(result.nextDueAt).toBeGreaterThan(now())
    expect(new Date(result.nextDueAt! + 6 * 3_600_000).getUTCDay()).toBe(0)

    await sweep()
    expect(await db.emails.count()).toBe(0)

    // Eight demo days later the schedule is due: one email, ReportEmailed, next due moved on.
    applyClockOffset(8 * 86_400_000)
    await sweep()
    const emails = await db.emails.toArray()
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({ to: ["owner@example.com"], subjectKey: "irt.email.subject", status: "sent" })
    expect(emails[0].attachments[0]).toMatch(/^RPT-0001-\d{4}-\d{2}-\d{2}\.csv$/)
    const schedule = (await db.reportSchedules.get(result.scheduleId))!
    expect(schedule.lastSentAt).toBeGreaterThan(0)
    expect(schedule.nextDueAt).toBeGreaterThan(now())
    expect((await db.events.where("type").equals("ReportEmailed").count())).toBe(1)
    await sweep()
    expect(await db.emails.count()).toBe(1)

    await commit(sendScheduleNow, { scheduleId: result.scheduleId }, { db, actor: rashed })
    expect(await db.emails.count()).toBe(2)
  })

  it("refuses a bad time, a bad email and users without irt.schedule.edit", async () => {
    const report = await commit(saveReport, E16, { db, actor: rashed })
    const base = { definitionId: report.result.reportId, frequency: "daily" as const, time: "08:00", recipients: ["a@b.co"], format: "pdf" as const }
    await expect(commit(saveSchedule, { ...base, time: "25:00" }, { db, actor: rashed })).rejects.toMatchObject({ code: "IRT_TIME_INVALID" })
    await expect(commit(saveSchedule, { ...base, recipients: ["not-an-email"] }, { db, actor: rashed })).rejects.toMatchObject({
      code: "IRT_EMAIL_INVALID",
    })
    const mahbub = await signedIn(db, "mahbub")
    await expect(commit(saveSchedule, base, { db, actor: mahbub })).rejects.toMatchObject({ kind: "denied" })
  })
})

describe("irt.recordRun", () => {
  it("records a run for anyone who may open IRT", async () => {
    const report = await commit(saveReport, E16, { db, actor: rashed })
    const nayeem = await signedIn(db, "nayeem")
    await commit(recordRun, { definitionId: report.result.reportId, params: { from: "2026-10-01" }, rowCount: 12 }, { db, actor: nayeem })
    const runs = await db.reportRuns.toArray()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ runBy: "usr_nayeem", rowCount: 12, params: { from: "2026-10-01" } })
    const tania = await signedIn(db, "tania")
    await expect(
      commit(recordRun, { definitionId: report.result.reportId, rowCount: 1 }, { db, actor: tania })
    ).rejects.toMatchObject({ kind: "denied" })
  })
})

describe("IRT pure helpers", () => {
  it("next run times: daily, weekly on Sundays, monthly on the 1st (Dhaka)", () => {
    const at = atDhaka("2026-11-04", "09:00") // a Wednesday
    expect(nextRunAfter("daily", "08:00", at)).toBe(atDhaka("2026-11-05", "08:00"))
    expect(nextRunAfter("daily", "10:00", at)).toBe(atDhaka("2026-11-04", "10:00"))
    expect(nextRunAfter("weekly", "08:00", at)).toBe(atDhaka("2026-11-08", "08:00"))
    expect(nextRunAfter("monthly", "08:00", at)).toBe(atDhaka("2026-12-01", "08:00"))
    expect(nextRunAfter("monthly", "08:00", atDhaka("2026-12-15", "09:00"))).toBe(atDhaka("2027-01-01", "08:00"))
  })

  it("date ranges, narrowing and the access key of a dataset", () => {
    expect(presetRange("last30", "2026-11-07")).toEqual({ from: "2026-10-09", to: "2026-11-07" })
    expect(presetRange("mtd", "2026-11-07")).toEqual({ from: "2026-11-01", to: "2026-11-07" })
    expect(presetRange("last-month", "2026-11-07")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
    expect(presetRange("ytd", "2026-11-07")).toEqual({ from: "2026-07-01", to: "2026-11-07" })
    expect(presetRange("ytd", "2027-02-01")).toEqual({ from: "2026-07-01", to: "2027-02-01" })
    expect(defaultRange({ dateRange: { field: "date", lastDays: 7 } }, "2026-11-07")).toEqual({ from: "2026-11-01", to: "2026-11-07" })
    expect(rangeOfPreset("last30", "date")).toEqual({ field: "date", lastDays: 30 })
    const rows = [{ date: "2026-10-31" }, { date: "2026-11-02T10:00" }, { date: null }]
    expect(narrowByDate(rows, "date", { from: "2026-11-01", to: "2026-11-30" })).toEqual([{ date: "2026-11-02T10:00" }, { date: null }])
    expect(accessKeyOf("si.invoiceLines")).toBe("si.app.view")
    expect(accessKeyOf("sac.audit")).toBe("sac.audit.view")
    expect(accessKeyOf(undefined, "/frs/vat")).toBe("frs.app.view")
    expect(dhakaDate(atDhaka("2026-11-07", "23:30"))).toBe("2026-11-07")
  })
})
