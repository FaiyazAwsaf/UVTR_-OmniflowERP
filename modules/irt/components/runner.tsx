"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ExternalLink, FileQuestion, LoaderCircle, Play, Printer, Save, Wrench } from "lucide-react"

import { locations } from "@/config/brand.config"
import { AppChip } from "@/components/shared/app-frame"
import { DateField } from "@/components/shared/date-field"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { ReportView } from "@/components/shared/report-view"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { ReportDefinitionRow, ReportFilter } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { DATASET_BY_CODE } from "@/core/reports/datasets"
import { usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field, Mono, OptionSelect } from "@/modules/sac/components/kit"
import { personName, useUserDirectory } from "@/modules/sac/queries"

import { recordRun } from "../commands"
import { accessKeyOf, defaultRange, presetOf, presetRange, type RangePreset } from "../params"
import { reportDescription, reportName, useReportByCode } from "../queries"
import { FilterEditor } from "./filter-editor"
import { PrintPreview } from "./print-preview"
import { ReportChart } from "./report-chart"
import { useReport } from "./use-report"

const PRESETS: RangePreset[] = ["last7", "last30", "mtd", "last-month", "ytd", "all"]

type Params = { preset: RangePreset | "custom"; from: string; to: string; location: string; filters: ReportFilter[] }

function initialParams(def: ReportDefinitionRow, today: string, search: URLSearchParams): Params {
  const from = search.get("from")
  const to = search.get("to")
  const location = search.get("loc") ?? "all"
  if (from || to) return { preset: "custom", from: from ?? "", to: to ?? "", location, filters: [] }
  const preset = presetOf(def.dateRange) ?? (def.dateRange ? "custom" : "all")
  const range = defaultRange(def, today)
  return { preset, from: range?.from ?? "", to: range?.to ?? "", location, filters: [] }
}

/** /irt/run/[code]: parameters, the report with totals and chart, print preview and CSV (plan §9). */
export function Runner({ code }: { code: string }) {
  const { t, tk, locale } = useLocale()
  const search = useSearchParams()
  const def = useReportByCode(code)
  const { can } = usePermissions()
  const [today] = React.useState(() => dhakaDate(now()))

  if (def === undefined) return <p className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
  if (def === null) {
    return (
      <EmptyState icon={FileQuestion} title={t("irt.run.notFound", { code })} action={{ label: t("irt.run.back"), href: "/irt" }} />
    )
  }
  const allowed = can(accessKeyOf(def.dataset, def.frsRoute))
  if (def.frsRoute || !def.dataset) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={reportName(def, locale)} subtitle={reportDescription(def, locale)} />
        <SectionCard title={t("irt.run.frsTitle")} icon={ExternalLink} size="sm">
          <p className="mb-4 text-sm text-muted-foreground">{t("irt.run.frsBody")}</p>
          {def.frsRoute ? (
            <Button nativeButton={false} render={<Link href={def.frsRoute} />} data-testid="report-open-frs">
              <ExternalLink />
              {t("irt.catalogue.openFrs")}
            </Button>
          ) : null}
        </SectionCard>
      </div>
    )
  }
  if (!allowed) {
    const dataset = DATASET_BY_CODE.get(def.dataset)
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("irt.common.locked", { app: tk(`${dataset?.app ?? def.app}.name`) })}
        action={{ label: t("irt.run.back"), href: "/irt" }}
      />
    )
  }
  return <RunnerBody key={def.id} def={def} initial={initialParams(def, today, search)} today={today} />
}

function RunnerBody({ def, initial, today }: { def: ReportDefinitionRow; initial: Params; today: string }) {
  const { t, tk, num, locale, dmy, time } = useLocale()
  const { can } = usePermissions()
  const { userId: me } = useSession()
  const directory = useUserDirectory()
  const { run: recordRunNow } = useCommand(recordRun)
  const dataset = DATASET_BY_CODE.get(def.dataset!)!
  const [draft, setDraft] = React.useState<Params>(initial)
  const [applied, setApplied] = React.useState<Params>(initial)
  const [runToken, setRunToken] = React.useState(1)
  const [printing, setPrinting] = React.useState(false)
  const recorded = React.useRef(0)

  const range = applied.from || applied.to ? { from: applied.from || "0000-01-01", to: applied.to || "9999-12-31" } : null
  const shaped = React.useMemo(
    () => ({ ...def, filters: [...def.filters, ...applied.filters] }),
    [def, applied.filters]
  )
  const state = useReport(shaped, { range, locationId: applied.location === "all" ? null : applied.location })

  // One reportRuns row per run (the first view and each "Run report").
  React.useEffect(() => {
    if (state.status !== "ready" || recorded.current === runToken) return
    recorded.current = runToken
    void recordRunNow(
      {
        definitionId: def.id,
        params: {
          from: applied.from || null,
          to: applied.to || null,
          locationId: applied.location === "all" ? null : applied.location,
          filters: applied.filters,
        },
        rowCount: state.result.rowCount,
      },
      { silent: true }
    )
  }, [state, runToken, def.id, applied, recordRunNow])

  const setPreset = (preset: RangePreset) => {
    const r = presetRange(preset, today)
    setDraft((d) => ({ ...d, preset, from: r?.from ?? "", to: r?.to ?? "" }))
  }
  const run = () => {
    setApplied(draft)
    setRunToken((n) => n + 1)
  }

  const name = reportName(def, locale)
  const own = !def.isSystem && def.ownerId === me
  const paramsLine = range
    ? t("irt.run.paramsLine", { from: applied.from ? dmy(applied.from) : "-", to: applied.to ? dmy(applied.to) : "-" })
    : t("irt.run.noDate")
  const locationLine =
    applied.location === "all" ? t("irt.common.allLocations") : (locations.find((l) => l.id === applied.location)?.name[locale] ?? "")
  const generatedAt = now()

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="report-runner" data-code={def.code}>
      <PageHeader
        title={name}
        subtitle={reportDescription(def, locale) || tk(dataset.labelKey)}
        actions={
          <>
            <Button variant="neutral" onClick={() => setPrinting(true)} disabled={state.status !== "ready"} data-testid="report-print-preview">
              <Printer />
              {t("irt.run.printPreview")}
            </Button>
            {own ? (
              <Button variant="outline" nativeButton={false} render={<Link href={`/irt/builder?id=${def.id}`} />}>
                <Wrench />
                {t("irt.run.editReport")}
              </Button>
            ) : can("irt.builder.create") ? (
              <Button variant="outline" nativeButton={false} render={<Link href={`/irt/builder?from=${def.code}`} />} data-testid="report-save-as">
                <Save />
                {t("irt.run.saveAs")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Mono className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-link">{def.code}</Mono>
        <AppChip app={def.app} />
        <span>
          {t("irt.common.dataset")}: {tk(dataset.labelKey)}
        </span>
      </div>

      <SectionCard title={t("irt.run.params")} size="sm" className="@container/params">
        <div className="flex flex-col gap-4" data-testid="report-params">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                aria-pressed={draft.preset === p}
                data-testid={`preset-${p}`}
                className={cn(
                  "h-7 rounded-full px-3 text-xs transition-colors",
                  draft.preset === p ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground hover:text-foreground"
                )}
              >
                {tk(`irt.presets.${p}`)}
              </button>
            ))}
          </div>
          <div className="grid gap-3 @min-[36rem]/params:grid-cols-3">
            <Field label={t("irt.run.from")}>
              <DateField
                value={draft.from}
                onChange={(from) => setDraft((d) => ({ ...d, from, preset: "custom" }))}
                max={draft.to || undefined}
                data-testid="report-from"
              />
            </Field>
            <Field label={t("irt.run.to")}>
              <DateField
                value={draft.to}
                onChange={(to) => setDraft((d) => ({ ...d, to, preset: "custom" }))}
                min={draft.from || undefined}
                data-testid="report-to"
              />
            </Field>
            <Field label={t("irt.run.location")}>
              <OptionSelect
                value={draft.location}
                onChange={(location) => setDraft((d) => ({ ...d, location }))}
                label={t("irt.run.location")}
                className="w-full"
                testId="report-location"
                options={[
                  { value: "all", label: t("irt.common.allLocations") },
                  ...locations.map((l) => ({ value: l.id, label: l.name[locale] })),
                ]}
              />
            </Field>
          </div>
          <Field label={t("irt.run.filters")}>
            <FilterEditor
              dataset={dataset}
              filters={draft.filters}
              onChange={(filters) => setDraft((d) => ({ ...d, filters }))}
              testId="report-filter"
            />
          </Field>
          <div className="flex justify-end">
            <Button onClick={run} data-testid="report-run" disabled={state.status === "loading"}>
              {state.status === "loading" ? <LoaderCircle className="animate-spin" /> : <Play />}
              {state.status === "loading" ? t("irt.run.running") : t("irt.run.run")}
            </Button>
          </div>
        </div>
      </SectionCard>

      {state.status === "ready" ? (
        <section className="flex min-w-0 flex-col gap-4" data-testid="report-result" data-rows={state.result.rowCount}>
          <p className="text-xs text-muted-foreground">
            {paramsLine} · {locationLine}
          </p>
          {state.result.rowCount === 0 ? (
            <p className="rounded-md bg-surface-raised px-4 py-3 text-sm text-muted-foreground">{t("irt.common.noRowsYet")}</p>
          ) : null}
          {def.chart && state.result.rowCount ? <ReportChart rows={state.result.rows} dataset={dataset} chart={def.chart} /> : null}
          <div className="surface-card min-w-0 p-4">
            <ReportView result={state.result} title={`${def.code} ${def.nameEn}`} chart={null} canExport={can("irt.export")} />
          </div>
          <PrintPreview
            open={printing}
            onOpenChange={setPrinting}
            result={state.result}
            title={name}
            code={def.code}
            meta={
              <>
                <div>
                  {paramsLine} · {locationLine}
                </div>
                <div>
                  {t("irt.run.generated", {
                    date: dmy(generatedAt),
                    time: time(generatedAt),
                    name: personName(directory?.userById.get(me ?? ""), locale),
                  })}
                </div>
                <div>{t("irt.common.rows", { count: num(state.result.rowCount) })}</div>
              </>
            }
          />
        </section>
      ) : state.status === "loading" ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("irt.common.loading")}</p>
      ) : null}
    </div>
  )
}
