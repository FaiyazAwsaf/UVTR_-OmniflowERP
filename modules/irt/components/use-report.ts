"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import { DATASET_BY_CODE } from "@/core/reports/datasets"
import { DATASET_LOADERS } from "@/core/reports/loaders"
import { shapeReport, type ReportDefinitionLike, type ReportResult } from "@/core/reports/runner"
import type { DatasetParams } from "@/core/reports/types"
import { en } from "@/lib/i18n/en"

import { dateFieldOf, narrowByDate, type DateRange } from "../params"

export type ReportState =
  | { status: "loading" }
  | { status: "ready"; result: ReportResult }
  | { status: "error"; message: string }

/**
 * Runs a report live (plan §3.19): the dataset's loader inside a liveQuery,
 * so a commit in any window re-runs it; then the date range on the dataset's
 * date field (in case a loader ignores it) and the core runner's shaping
 * (filters, sort, groups, totals). A loader that is missing, returns nothing
 * or fails gives an empty result instead of breaking the screen.
 */
export function useReport(
  def: (ReportDefinitionLike & { dataset?: string }) | null,
  params: { range: DateRange | null; locationId?: string | null } | null
): ReportState {
  const db = useDb()
  const key = def && params ? JSON.stringify({ def, params }) : null
  const state = useLiveQuery(async (): Promise<ReportState> => {
    if (!def || !params || !def.dataset) return { status: "loading" }
    const dataset = DATASET_BY_CODE.get(def.dataset)
    if (!dataset) return { status: "error", message: def.dataset }
    const loaderParams: DatasetParams = {
      from: params.range?.from,
      to: params.range?.to,
      locationId: params.locationId ?? undefined,
    }
    let rows: Awaited<ReturnType<NonNullable<(typeof DATASET_LOADERS)[string]>>> = []
    try {
      const loader = DATASET_LOADERS[dataset.code]
      rows = loader ? await loader(db, loaderParams) : []
    } catch (error) {
      console.warn(`report loader ${dataset.code} failed`, error)
      rows = []
    }
    const narrowed = narrowByDate(rows ?? [], dateFieldOf(dataset), params.range)
    return { status: "ready", result: shapeReport(dataset, narrowed, def) }
    // `key` stands for the definition and parameters.
  }, [db, key])
  return state ?? { status: "loading" }
}

/** The raw values of an enum field (from the English dictionary), for filter choices. */
export function enumValues(enumKeys: string | undefined): string[] {
  if (!enumKeys) return []
  let node: unknown = en
  for (const part of enumKeys.split(".")) {
    if (!node || typeof node !== "object") return []
    node = (node as Record<string, unknown>)[part]
  }
  return node && typeof node === "object" ? Object.keys(node as object) : []
}
