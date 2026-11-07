"use client"

import * as React from "react"
import Link from "next/link"
import { BarChart3, ExternalLink, FileSpreadsheet, LineChart, Lock, PieChart, Play, Plus, Trash2, Wrench } from "lucide-react"
import { toast } from "sonner"

import { AppChip } from "@/components/shared/app-frame"
import { PageHeader } from "@/components/shared/page-header"
import { searchKey } from "@/components/shared/pickers"
import { StatusPill } from "@/components/shared/status"
import { TableSearch } from "@/components/motion/data-table"
import { Button } from "@/components/ui/button"
import type { ReportDefinitionRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { DATASET_BY_CODE } from "@/core/reports/datasets"
import { usePermissions } from "@/core/security/useCan"
import type { SuiteCode } from "@/core/security/types"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { ConfirmDialog, Mono } from "@/modules/sac/components/kit"
import { personName, useUserDirectory } from "@/modules/sac/queries"

import { deleteReport } from "../commands"
import { accessKeyOf } from "../params"
import { reportDescription, reportName, useReportDefinitions } from "../queries"

const SUITES: SuiteCode[] = ["fms", "sdm", "scm", "csc"]
const CHART_ICON = { bar: BarChart3, line: LineChart, donut: PieChart } as const

/**
 * /irt: the report catalogue (plan §9): the 33 standard reports grouped by
 * suite and the saved reports. A report runs when the user may view the app
 * its data belongs to; the others show locked. FRS statements open in FRS.
 */
export function Catalogue() {
  const { t, tk, num } = useLocale()
  const defs = useReportDefinitions()
  const { can } = usePermissions()
  const { userId: me } = useSession()
  const [query, setQuery] = React.useState("")
  const [suite, setSuite] = React.useState<SuiteCode | "all">("all")
  const canBuild = can("irt.builder.create")

  const q = searchKey(query)
  const matches = (d: ReportDefinitionRow) =>
    (suite === "all" || d.suite === suite) &&
    (!q || searchKey(`${d.code} ${d.nameEn} ${d.nameBn} ${d.descriptionEn ?? ""} ${d.dataset ?? ""}`).includes(q))
  const system = (defs ?? []).filter((d) => d.isSystem && matches(d))
  const saved = (defs ?? []).filter((d) => !d.isSystem && (d.shared || d.ownerId === me) && matches(d))

  return (
    <div className="flex flex-col gap-5" data-testid="irt-catalogue">
      <PageHeader
        title={t("irt.catalogue.title")}
        subtitle={t("irt.catalogue.subtitle")}
        actions={
          canBuild ? (
            <Button nativeButton={false} render={<Link href="/irt/builder" />} data-testid="catalogue-builder">
              <Wrench />
              {t("irt.catalogue.builder")}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <TableSearch value={query} onChange={setQuery} placeholder={t("irt.catalogue.search")} />
        <div className="flex flex-wrap gap-1" role="tablist">
          {(["all", ...SUITES] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={suite === s}
              onClick={() => setSuite(s)}
              data-testid={`suite-filter-${s}`}
              className={cn(
                "h-8 rounded-full px-3 text-[0.8125rem] transition-colors",
                suite === s ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "all" ? t("irt.catalogue.allSuites") : <span lang="en">{s.toUpperCase()}</span>}
            </button>
          ))}
        </div>
      </div>

      {SUITES.filter((s) => suite === "all" || s === suite).map((s) => {
        const list = system.filter((d) => d.suite === s)
        if (!list.length) return null
        return (
          <section key={s} className="flex flex-col gap-3" data-testid={`catalogue-suite-${s}`}>
            <h2 className="flex items-baseline gap-2 text-[1.0625rem] font-semibold">
              <span lang="en" className="font-mono text-sm text-link">
                {s.toUpperCase()}
              </span>
              {tk(`irt.suites.${s}`)}
              <span className="text-xs font-normal text-muted-foreground">{t("irt.catalogue.count", { count: num(list.length) })}</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {list.map((d) => (
                <ReportCard key={d.id} def={d} allowed={can(accessKeyOf(d.dataset, d.frsRoute))} />
              ))}
            </div>
          </section>
        )
      })}

      <section className="flex flex-col gap-3" data-testid="catalogue-saved">
        <h2 className="text-[1.0625rem] font-semibold">{t("irt.catalogue.saved")}</h2>
        {saved.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {saved.map((d) => (
              <ReportCard key={d.id} def={d} allowed={can(accessKeyOf(d.dataset))} own={d.ownerId === me} />
            ))}
          </div>
        ) : (
          <p className="surface-card flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <FileSpreadsheet className="size-5" />
            {t("irt.catalogue.savedEmpty")}
            {canBuild ? (
              <Link href="/irt/builder" className="ml-auto inline-flex items-center gap-1 font-medium text-link hover:underline">
                <Plus className="size-4" />
                {t("irt.catalogue.builder")}
              </Link>
            ) : null}
          </p>
        )}
      </section>
    </div>
  )
}

function ReportCard({ def, allowed, own = false }: { def: ReportDefinitionRow; allowed: boolean; own?: boolean }) {
  const { t, tk, locale } = useLocale()
  const directory = useUserDirectory()
  const remove = useCommand(deleteReport)
  const [deleting, setDeleting] = React.useState(false)
  const dataset = def.dataset ? DATASET_BY_CODE.get(def.dataset) : undefined
  const description = reportDescription(def, locale) || (dataset ? tk(dataset.labelKey) : "")
  const ChartIcon = def.chart ? CHART_ICON[def.chart.kind] : null
  const href = def.frsRoute ?? `/irt/run/${def.code}`
  const appLabel = tk(`${def.dataset ? (dataset?.app ?? def.app) : "frs"}.name`)

  return (
    <article
      data-testid="report-card"
      data-code={def.code}
      data-locked={allowed ? "false" : "true"}
      className={cn("surface-card flex min-w-0 flex-col gap-3 p-4 transition-transform", allowed ? "hover:-translate-y-0.5" : "opacity-60")}
    >
      <header className="flex items-center gap-2">
        <Mono className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-link">{def.code}</Mono>
        <AppChip app={def.app} />
        {def.frsRoute ? <StatusPill tone="info" className="h-5 px-2 text-[0.6875rem]">{t("irt.common.frs")}</StatusPill> : null}
        {ChartIcon ? <ChartIcon className="ml-auto size-4 text-muted-foreground" aria-label={t("irt.common.chart")} /> : null}
        {!allowed ? <Lock className={cn("size-4 text-muted-foreground", !ChartIcon && "ml-auto")} /> : null}
      </header>
      <div className="min-w-0 flex-1">
        <h3 className="leading-snug font-semibold">{reportName(def, locale)}</h3>
        <p className="mt-1 line-clamp-2 text-[0.8125rem] text-muted-foreground">{description}</p>
        {!def.isSystem && def.ownerId ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("irt.catalogue.owner", { name: personName(directory?.userById.get(def.ownerId), locale) || def.ownerId })}
          </p>
        ) : null}
      </div>
      <footer className="flex items-center gap-2">
        {allowed ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-link hover:underline"
            data-testid="report-open"
          >
            {def.frsRoute ? <ExternalLink className="size-3.5" /> : <Play className="size-3.5" />}
            {def.frsRoute ? t("irt.catalogue.openFrs") : t("irt.catalogue.run")}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">{t("irt.common.locked", { app: appLabel })}</span>
        )}
        {own ? (
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="xs" nativeButton={false} render={<Link href={`/irt/builder?id=${def.id}`} />}>
              <Wrench />
              {t("irt.common.edit")}
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setDeleting(true)} aria-label={t("irt.common.delete")}>
              <Trash2 />
            </Button>
          </span>
        ) : null}
      </footer>
      {own ? (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={t("irt.common.deleteTitle", { name: reportName(def, locale) })}
          description={t("irt.common.deleteBody")}
          confirmLabel={t("irt.common.delete")}
          destructive
          pending={remove.pending}
          onConfirm={async () => {
            const result = await remove.run({ id: def.id, expectedVersion: def.version })
            setDeleting(false)
            if (result) toast.success(t("irt.common.deleted"))
          }}
        />
      ) : null}
    </article>
  )
}
