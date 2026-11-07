"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { History as HistoryIcon, RotateCw } from "lucide-react"

import { locations } from "@/config/brand.config"
import { DateText } from "@/components/shared/date-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { useDb } from "@/core/db/DbProvider"
import type { ReportRunRow } from "@/core/db/schema"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { ListTable, Mono, type ListColumn } from "@/modules/sac/components/kit"
import { personName, useUserDirectory } from "@/modules/sac/queries"

import { reportName, useReportDefinitions } from "../queries"

/** /irt/history: every report run with its parameters and row count (plan §9). */
export function RunHistory() {
  const { t, num, locale, dmy } = useLocale()
  const db = useDb()
  const { userId: me } = useSession()
  const defs = useReportDefinitions()
  const directory = useUserDirectory()
  const [scope, setScope] = React.useState<"mine" | "everyone">("mine")
  const runs = useLiveQuery(async () => {
    const list = scope === "mine" && me ? await db.reportRuns.where("runBy").equals(me).toArray() : await db.reportRuns.toArray()
    return list.sort((a, b) => b.at - a.at)
  }, [db, scope, me])
  const defById = new Map((defs ?? []).map((d) => [d.id, d]))

  const paramsText = (run: ReportRunRow) => {
    const p = run.params as { from?: string | null; to?: string | null; locationId?: string | null; filters?: unknown[] }
    const parts: string[] = []
    if (p.from || p.to) parts.push(`${p.from ? dmy(p.from) : "-"} → ${p.to ? dmy(p.to) : "-"}`)
    else parts.push(t("irt.run.noDate"))
    if (p.locationId) parts.push(locations.find((l) => l.id === p.locationId)?.name[locale] ?? p.locationId)
    if (p.filters?.length) parts.push(t("irt.history.filters", { count: num(p.filters.length) }))
    return parts.join(" · ")
  }
  const againHref = (run: ReportRunRow) => {
    const def = defById.get(run.definitionId)
    if (!def) return null
    const p = run.params as { from?: string | null; to?: string | null; locationId?: string | null }
    const q = new URLSearchParams()
    if (p.from) q.set("from", p.from)
    if (p.to) q.set("to", p.to)
    if (p.locationId) q.set("loc", p.locationId)
    const query = q.toString()
    return `/irt/run/${def.code}${query ? `?${query}` : ""}`
  }

  const columns: ListColumn<ReportRunRow>[] = [
    { id: "at", header: t("irt.history.columns.at"), cell: (r) => <DateText value={r.at} variant="dmyTime" /> },
    {
      id: "report",
      header: t("irt.history.columns.report"),
      cell: (r) => {
        const def = defById.get(r.definitionId)
        return def ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{reportName(def, locale)}</span>
            <Mono className="text-muted-foreground">{def.code}</Mono>
          </span>
        ) : (
          <span className="text-muted-foreground">{t("irt.history.deleted")}</span>
        )
      },
    },
    {
      id: "by",
      header: t("irt.history.columns.by"),
      hideBelow: "md",
      cell: (r) => personName(directory?.userById.get(r.runBy), locale) || r.runBy,
    },
    { id: "params", header: t("irt.history.columns.params"), hideBelow: "lg", className: "text-muted-foreground", cell: paramsText },
    { id: "rows", header: t("irt.history.columns.rows"), align: "right", cell: (r) => num(r.rowCount) },
    {
      id: "again",
      header: "",
      align: "right",
      cell: (r) => {
        const href = againHref(r)
        return href ? (
          <Link href={href} className="inline-flex items-center gap-1 text-[0.8125rem] font-medium whitespace-nowrap text-link hover:underline">
            <RotateCw className="size-3.5" />
            {t("irt.history.again")}
          </Link>
        ) : null
      },
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("irt.history.title")} subtitle={t("irt.history.subtitle")} />
      <SectionCard
        title={t("irt.history.title")}
        icon={HistoryIcon}
        size="sm"
        action={
          <div className="flex gap-1" role="tablist">
            {(["mine", "everyone"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scope === s}
                onClick={() => setScope(s)}
                data-testid={`history-${s}`}
                className={cn(
                  "h-7 rounded-full px-3 text-xs transition-colors",
                  scope === s ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground hover:text-foreground"
                )}
              >
                {t(s === "mine" ? "irt.history.mine" : "irt.history.everyone")}
              </button>
            ))}
          </div>
        }
      >
        <ListTable
          rows={runs}
          columns={columns}
          rowKey={(r) => r.id}
          rowProps={(r) => ({ "data-testid": "history-row", "data-code": defById.get(r.definitionId)?.code })}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("irt.history.empty")}</p>}
        />
      </SectionCard>
    </div>
  )
}
