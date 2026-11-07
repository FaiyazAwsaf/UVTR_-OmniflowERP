"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { ReportDefinitionRow } from "@/core/db/schema"
import type { Locale } from "@/lib/i18n/config"

/** IRT live queries (useDb + useLiveQuery). */

/** Every report definition: the 33 system reports, then saved ones, by code. */
export function useReportDefinitions(): ReportDefinitionRow[] | undefined {
  const db = useDb()
  return useLiveQuery(
    async () => (await db.reportDefinitions.toArray()).sort((a, b) => a.code.localeCompare(b.code)),
    [db]
  )
}

/** A definition by its code (IRT-16, RPT-0001) or row id. */
export function useReportByCode(code: string): ReportDefinitionRow | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [byCode] = await db.reportDefinitions.where("code").equals(code).toArray()
    return byCode ?? (await db.reportDefinitions.get(code)) ?? null
  }, [db, code])
}

/** A report's name in the window's language. */
export function reportName(def: Pick<ReportDefinitionRow, "nameEn" | "nameBn"> | undefined, locale: Locale): string {
  if (!def) return ""
  return locale === "bn" && def.nameBn ? def.nameBn : def.nameEn
}

/** A report's description in the window's language (may be empty). */
export function reportDescription(
  def: Pick<ReportDefinitionRow, "descriptionEn" | "descriptionBn">,
  locale: Locale
): string {
  return (locale === "bn" ? def.descriptionBn || def.descriptionEn : def.descriptionEn) ?? ""
}
