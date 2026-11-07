import { addDaysISO } from "@/core/clock/dates"
import type { ISODate, ReportDefinitionRow } from "@/core/db/schema"
import { DATASET_BY_CODE } from "@/core/reports/datasets"
import type { DatasetDef, DatasetField, DatasetRow } from "@/core/reports/types"

/**
 * Report parameters (plan §9 /irt/run): the default date range of a
 * definition relative to today, the dataset access rule, and the date and
 * location narrowing the runner applies after the loader (so a report reads
 * right even when an app's loader ignores the range). Pure.
 */

export type DateRange = { from: ISODate; to: ISODate }

export type RangePreset = "last7" | "last30" | "last90" | "mtd" | "last-month" | "ytd" | "all"

/** Fiscal year start (1 July) of a day. */
export function fiscalStart(day: ISODate): ISODate {
  const [y, m] = day.split("-").map(Number)
  return `${m >= 7 ? y : y - 1}-07-01`
}

function lastMonth(day: ISODate): DateRange {
  const [y, m] = day.split("-").map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const from = `${py}-${String(pm).padStart(2, "0")}-01`
  const to = addDaysISO(`${day.slice(0, 7)}-01`, -1)
  return { from, to }
}

/** The range for a preset on a day; null for "all". */
export function presetRange(preset: RangePreset, today: ISODate): DateRange | null {
  switch (preset) {
    case "last7":
      return { from: addDaysISO(today, -6), to: today }
    case "last30":
      return { from: addDaysISO(today, -29), to: today }
    case "last90":
      return { from: addDaysISO(today, -89), to: today }
    case "mtd":
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case "last-month":
      return lastMonth(today)
    case "ytd":
      return { from: fiscalStart(today), to: today }
    case "all":
      return null
  }
}

/** The definition's stored range as a preset ("last 30 days" → last30). */
export function presetOf(range: ReportDefinitionRow["dateRange"]): RangePreset | null {
  if (!range) return null
  if (range.preset === "mtd") return "mtd"
  if (range.preset === "ytd") return "ytd"
  if (range.preset === "last-month") return "last-month"
  if (range.lastDays === 7) return "last7"
  if (range.lastDays === 30) return "last30"
  if (range.lastDays === 90) return "last90"
  return null
}

/** The stored form of a preset (for saved reports). */
export function rangeOfPreset(
  preset: RangePreset,
  field: string
): ReportDefinitionRow["dateRange"] | undefined {
  switch (preset) {
    case "last7":
      return { field, lastDays: 7 }
    case "last30":
      return { field, lastDays: 30 }
    case "last90":
      return { field, lastDays: 90 }
    case "mtd":
    case "ytd":
    case "last-month":
      return { field, preset }
    case "all":
      return undefined
  }
}

/** The default range of a definition on a day (null: no date range). */
export function defaultRange(def: Pick<ReportDefinitionRow, "dateRange">, today: ISODate): DateRange | null {
  const range = def.dateRange
  if (!range) return null
  if (range.preset) return presetRange(range.preset, today)
  if (range.lastDays) return { from: addDaysISO(today, -(range.lastDays - 1)), to: today }
  return null
}

/** The date field a dataset's range applies to. */
export function dateFieldOf(dataset: DatasetDef | undefined): string | undefined {
  if (!dataset) return undefined
  return dataset.dateField ?? dataset.fields.find((f) => f.type === "date")?.key
}

/**
 * Keeps rows inside the range on the dataset's date field (values may be
 * ISO days or ISO date-times). Rows without a date are kept.
 */
export function narrowByDate(rows: DatasetRow[], field: string | undefined, range: DateRange | null): DatasetRow[] {
  if (!field || !range) return rows
  return rows.filter((row) => {
    const value = row[field]
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return true
    const day = value.slice(0, 10)
    return day >= range.from && day <= range.to
  })
}

/**
 * The key a user needs to run a dataset's report: the view key of the app the
 * data belongs to (the audit trail needs sac.audit.view). The catalogue shows
 * the others locked.
 */
export function accessKeyOf(datasetCode: string | undefined, frsRoute?: string): string {
  if (!datasetCode) return frsRoute ? "frs.app.view" : "irt.app.view"
  if (datasetCode === "sac.audit") return "sac.audit.view"
  const app = DATASET_BY_CODE.get(datasetCode)?.app ?? datasetCode.split(".")[0]
  return `${app}.app.view`
}

/** Fields of a dataset by key. */
export function fieldMap(dataset: DatasetDef): Map<string, DatasetField> {
  return new Map(dataset.fields.map((f) => [f.key, f]))
}

/** Fields that can be totalled (numbers and money). */
export function totalable(field: DatasetField): boolean {
  return field.type === "money" || field.type === "number"
}
