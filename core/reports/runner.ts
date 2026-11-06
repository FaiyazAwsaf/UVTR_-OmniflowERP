import type { OmniflowDb } from "@/core/db/database"
import type { ReportDefinitionRow, ReportFilter } from "@/core/db/schema"

import { DATASET_BY_CODE } from "./datasets"
import { DATASET_LOADERS } from "./loaders"
import type { DatasetDef, DatasetParams, DatasetRow } from "./types"

/**
 * The report runner (plan §3.19): load a dataset, apply filters, sort, group
 * and total. Pure apart from the loader call, so IRT, the dashboard and tests
 * share it.
 */

export type ReportDefinitionLike = Pick<
  ReportDefinitionRow,
  "dataset" | "columns" | "filters" | "groupBy" | "sort" | "totals"
>

export type ReportGroup = {
  /** Values of the group-by fields */
  key: Record<string, string | number | null>
  rows: DatasetRow[]
  /** Sums of the total fields within the group */
  totals: Record<string, number>
  count: number
}

export type ReportResult = {
  dataset: DatasetDef
  columns: string[]
  rows: DatasetRow[]
  groups: ReportGroup[] | null
  totals: Record<string, number>
  rowCount: number
}

function matches(row: DatasetRow, filter: ReportFilter): boolean {
  const value = row[filter.field]
  const want = filter.value
  switch (filter.op) {
    case "eq":
      return value === want
    case "neq":
      return value !== want
    case "in":
      return Array.isArray(want) && want.includes(value as string | number)
    case "gte":
      return value !== null && value !== undefined && value >= (want as string | number)
    case "lte":
      return value !== null && value !== undefined && value <= (want as string | number)
    case "between":
      return (
        Array.isArray(want) &&
        value !== null &&
        value !== undefined &&
        value >= want[0] &&
        value <= want[1]
      )
    case "contains":
      return String(value ?? "")
        .toLowerCase()
        .includes(String(want).toLowerCase())
  }
}

/** Filter, sort, group and total rows already loaded (pure). */
export function shapeReport(dataset: DatasetDef, rows: DatasetRow[], def: ReportDefinitionLike): ReportResult {
  let out = rows.filter((row) => def.filters.every((flt) => matches(row, flt)))
  if (def.sort) {
    const { field, dir } = def.sort
    const sign = dir === "desc" ? -1 : 1
    out = [...out].sort((a, b) => {
      const va = a[field] ?? ""
      const vb = b[field] ?? ""
      return va < vb ? -sign : va > vb ? sign : 0
    })
  }
  const sum = (list: DatasetRow[]) => {
    const t: Record<string, number> = {}
    for (const key of def.totals) t[key] = list.reduce((s, r) => s + (Number(r[key]) || 0), 0)
    return t
  }
  let groups: ReportGroup[] | null = null
  if (def.groupBy?.length) {
    const map = new Map<string, ReportGroup>()
    for (const row of out) {
      const key: Record<string, string | number | null> = {}
      for (const g of def.groupBy) key[g] = (row[g] ?? null) as string | number | null
      const id = JSON.stringify(key)
      const group = map.get(id) ?? { key, rows: [], totals: {}, count: 0 }
      group.rows.push(row)
      group.count += 1
      map.set(id, group)
    }
    groups = [...map.values()].map((g) => ({ ...g, totals: sum(g.rows) }))
  }
  const columns = def.columns.length ? def.columns : dataset.fields.map((fd) => fd.key)
  return { dataset, columns, rows: out, groups, totals: sum(out), rowCount: out.length }
}

/** Load a dataset (through its app's loader) and shape it. */
export async function runReport(
  db: OmniflowDb,
  def: ReportDefinitionLike,
  params: DatasetParams = {}
): Promise<ReportResult> {
  const code = def.dataset
  const dataset = code ? DATASET_BY_CODE.get(code) : undefined
  if (!code || !dataset) throw new Error(`Unknown dataset ${code}`)
  const loader = DATASET_LOADERS[code]
  const rows = loader ? await loader(db, params) : []
  return shapeReport(dataset, rows, def)
}
