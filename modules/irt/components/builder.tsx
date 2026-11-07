"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/shared/page-header"
import { ReportView } from "@/components/shared/report-view"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { ReportDefinitionRow, ReportFilter } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { DATASETS, DATASET_BY_CODE } from "@/core/reports/datasets"
import type { DatasetDef } from "@/core/reports/types"
import { usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { Field, OptionSelect } from "@/modules/sac/components/kit"

import { saveReport } from "../commands"
import { accessKeyOf, dateFieldOf, presetOf, presetRange, rangeOfPreset, totalable, type RangePreset } from "../params"
import { reportName, useReportDefinitions } from "../queries"
import { FilterEditor } from "./filter-editor"
import { ReportChart, type ChartSpec } from "./report-chart"
import { useReport } from "./use-report"

const PRESETS: RangePreset[] = ["last7", "last30", "last90", "mtd", "last-month", "ytd", "all"]

type ChartKind = ChartSpec["kind"] | "none"

type Draft = {
  dataset: string
  columns: string[]
  filters: ReportFilter[]
  group1: string
  group2: string
  totals: string[]
  chartKind: ChartKind
  chartX: string
  chartY: string
  chartSeries: string
  sortField: string
  sortDir: "asc" | "desc"
  preset: RangePreset
}

function freshDraft(dataset: DatasetDef): Draft {
  const columns = dataset.fields.map((f) => f.key)
  const firstGroupable = dataset.fields.find((f) => f.groupable && f.type !== "date")?.key ?? ""
  const firstMoney = dataset.fields.find((f) => f.type === "money")?.key ?? dataset.fields.find(totalable)?.key ?? ""
  return {
    dataset: dataset.code,
    columns,
    filters: [],
    group1: "none",
    group2: "none",
    totals: dataset.fields.filter((f) => f.type === "money").map((f) => f.key),
    chartKind: "none",
    chartX: firstGroupable,
    chartY: firstMoney,
    chartSeries: "none",
    sortField: "none",
    sortDir: "desc",
    preset: dateFieldOf(dataset) ? "last30" : "all",
  }
}

function draftFromDef(def: ReportDefinitionRow): Draft | null {
  const dataset = def.dataset ? DATASET_BY_CODE.get(def.dataset) : undefined
  if (!dataset) return null
  const base = freshDraft(dataset)
  return {
    ...base,
    columns: def.columns.length ? def.columns : base.columns,
    filters: def.filters,
    group1: def.groupBy?.[0] ?? "none",
    group2: def.groupBy?.[1] ?? "none",
    totals: def.totals,
    chartKind: def.chart?.kind ?? "none",
    chartX: def.chart?.x ?? base.chartX,
    chartY: def.chart?.y ?? base.chartY,
    chartSeries: def.chart?.series ?? "none",
    sortField: def.sort?.field ?? "none",
    sortDir: def.sort?.dir ?? "desc",
    preset: presetOf(def.dateRange) ?? (def.dateRange ? "last30" : "all"),
  }
}

/**
 * /irt/builder: the report builder (plan §9, E16): dataset, columns,
 * filters, group by, totals, chart and date range, with a live preview;
 * saved through `irt.saveReport` (irt.builder.create) and exported as CSV
 * with irt.export.
 */
export function Builder() {
  const { t, tk, num, locale } = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const defs = useReportDefinitions()
  const { can } = usePermissions()
  const { userId: me } = useSession()
  const save = useCommand(saveReport)
  const [today] = React.useState(() => dhakaDate(now()))

  const editId = params.get("id")
  const fromCode = params.get("from")
  const source = defs?.find((d) => (editId ? d.id === editId : fromCode ? d.code === fromCode : false))
  const editing = source && editId && !source.isSystem && source.ownerId === me ? source : null

  const datasets = DATASETS.filter((d) => can(accessKeyOf(d.code)))
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [loadedKey, setLoadedKey] = React.useState<string | null>(null)
  const sourceKey = editId ? `id:${editId}` : fromCode ? `from:${fromCode}` : "blank"
  if (sourceKey !== loadedKey) {
    if (sourceKey === "blank") {
      setLoadedKey(sourceKey)
      setDraft(null)
    } else if (source) {
      setLoadedKey(sourceKey)
      setDraft(draftFromDef(source))
    } else if (defs !== undefined) {
      setLoadedKey(sourceKey)
    }
  }
  const [saving, setSaving] = React.useState(false)
  const [names, setNames] = React.useState({ nameEn: "", nameBn: "", shared: true })

  const dataset = draft ? DATASET_BY_CODE.get(draft.dataset) : undefined
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d))
  const fields = dataset?.fields ?? []

  const defLike =
    draft && dataset
      ? {
          dataset: dataset.code,
          columns: dataset.fields.map((f) => f.key).filter((k) => draft.columns.includes(k)),
          filters: draft.filters,
          groupBy: [draft.group1, draft.group2].filter((g) => g !== "none"),
          sort: draft.sortField !== "none" ? { field: draft.sortField, dir: draft.sortDir } : undefined,
          totals: draft.totals.filter((k) => draft.columns.includes(k)),
        }
      : null
  const range = draft ? presetRange(draft.preset, today) : null
  const state = useReport(defLike, defLike ? { range } : null)
  const chart: ChartSpec | null =
    draft && draft.chartKind !== "none" && draft.chartX && draft.chartY
      ? {
          kind: draft.chartKind,
          x: draft.chartX,
          y: draft.chartY,
          ...(draft.chartSeries !== "none" && draft.chartKind !== "donut" ? { series: draft.chartSeries } : {}),
        }
      : null

  const openSave = () => {
    setNames({
      nameEn: editing?.nameEn ?? (source ? `${source.nameEn}` : ""),
      nameBn: editing?.nameBn ?? (source ? source.nameBn : ""),
      shared: editing?.shared ?? true,
    })
    setSaving(true)
  }
  const submit = async () => {
    if (!draft || !defLike || !dataset) return
    const dateField = dateFieldOf(dataset)
    const result = await save.run({
      id: editing?.id,
      expectedVersion: editing?.version,
      nameEn: names.nameEn,
      nameBn: names.nameBn || undefined,
      dataset: dataset.code,
      columns: defLike.columns,
      filters: draft.filters,
      groupBy: defLike.groupBy,
      sort: defLike.sort ?? null,
      totals: defLike.totals,
      chart,
      dateRange: dateField ? (rangeOfPreset(draft.preset, dateField) ?? null) : null,
      shared: names.shared,
    })
    if (!result) return
    setSaving(false)
    toast.success(t("irt.builder.saved", { name: names.nameEn, code: result.code }))
    // Keep the draft on screen: the saved report is now the one being edited.
    setLoadedKey(`id:${result.reportId}`)
    router.replace(`/irt/builder?id=${result.reportId}`)
  }

  const groupable = fields.filter((f) => f.groupable)
  const numeric = fields.filter(totalable)

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="report-builder">
      <PageHeader
        title={t("irt.builder.title")}
        subtitle={t("irt.builder.subtitle")}
        actions={
          <>
            {editing ? (
              <StatusPill tone="primary">{t("irt.builder.editing", { code: editing.code })}</StatusPill>
            ) : source ? (
              <StatusPill tone="muted">{t("irt.builder.fromReport", { code: source.code })}</StatusPill>
            ) : null}
            {draft ? (
              <Button
                variant="neutral"
                onClick={() => {
                  router.replace("/irt/builder")
                  setDraft(null)
                  setLoadedKey("blank")
                }}
              >
                <RotateCcw />
                {t("irt.builder.reset")}
              </Button>
            ) : null}
            <Button onClick={openSave} disabled={!draft || !defLike?.columns.length} data-testid="builder-save">
              <Save />
              {t("irt.builder.save")}
            </Button>
          </>
        }
      />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("irt.builder.steps.data")} size="sm">
            <div className="flex flex-col gap-4">
              <Field label={t("irt.builder.dataset")}>
                <OptionSelect
                  value={draft?.dataset ?? ""}
                  onChange={(code) => {
                    const ds = DATASET_BY_CODE.get(code)
                    if (ds) setDraft(freshDraft(ds))
                  }}
                  label={t("irt.builder.pickDataset")}
                  className="w-full"
                  testId="builder-dataset"
                  options={datasets.map((d) => ({ value: d.code, label: tk(d.labelKey) }))}
                />
              </Field>
              {draft && dataset ? (
                <Field label={t("irt.builder.columns")}>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {fields.map((f) => (
                      <label key={f.key} className="flex min-w-0 items-center gap-2 py-0.5 text-[0.8125rem]">
                        <Checkbox
                          checked={draft.columns.includes(f.key)}
                          onCheckedChange={(on) =>
                            set("columns", on ? [...draft.columns, f.key] : draft.columns.filter((k) => k !== f.key))
                          }
                          data-testid="builder-column"
                          data-field={f.key}
                        />
                        <span className="truncate">{tk(f.labelKey)}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              ) : null}
              {draft && dataset ? (
                <Field label={t("irt.builder.filters")}>
                  <FilterEditor dataset={dataset} filters={draft.filters} onChange={(filters) => set("filters", filters)} />
                </Field>
              ) : null}
            </div>
          </SectionCard>

          {draft && dataset ? (
            <SectionCard title={t("irt.builder.steps.shape")} size="sm">
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("irt.builder.group")}>
                    <span data-testid="builder-group" data-level="1">
                      <OptionSelect
                        size="sm"
                        value={draft.group1}
                        onChange={(v) => setDraft({ ...draft, group1: v, group2: v === "none" ? "none" : draft.group2 })}
                        label={t("irt.builder.group")}
                        className="w-full"
                        testId="builder-group-1"
                        options={[{ value: "none", label: t("irt.builder.noGroup") }, ...groupable.map((f) => ({ value: f.key, label: tk(f.labelKey) }))]}
                      />
                    </span>
                  </Field>
                  <Field label={t("irt.builder.group2")}>
                    <span data-testid="builder-group" data-level="2">
                      <OptionSelect
                        size="sm"
                        value={draft.group2}
                        onChange={(v) => set("group2", v)}
                        label={t("irt.builder.group2")}
                        className="w-full"
                        testId="builder-group-2"
                        disabled={draft.group1 === "none"}
                        options={[
                          { value: "none", label: t("irt.builder.noGroup") },
                          ...groupable.filter((f) => f.key !== draft.group1).map((f) => ({ value: f.key, label: tk(f.labelKey) })),
                        ]}
                      />
                    </span>
                  </Field>
                </div>
                <Field label={t("irt.builder.totals")}>
                  {numeric.length ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {numeric.map((f) => (
                        <label key={f.key} className="flex min-w-0 items-center gap-2 py-0.5 text-[0.8125rem]">
                          <Checkbox
                            checked={draft.totals.includes(f.key)}
                            onCheckedChange={(on) => set("totals", on ? [...draft.totals, f.key] : draft.totals.filter((k) => k !== f.key))}
                            data-testid="builder-total"
                            data-field={f.key}
                          />
                          <span className="truncate">{tk(f.labelKey)}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("irt.builder.noTotals")}</p>
                  )}
                </Field>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <Field label={t("irt.builder.sort")}>
                    <OptionSelect
                      size="sm"
                      value={draft.sortField}
                      onChange={(v) => set("sortField", v)}
                      label={t("irt.builder.sort")}
                      className="w-full"
                      testId="builder-sort"
                      options={[{ value: "none", label: t("irt.builder.noSort") }, ...fields.map((f) => ({ value: f.key, label: tk(f.labelKey) }))]}
                    />
                  </Field>
                  <Field label={<span aria-hidden>{"\u00a0"}</span>}>
                    <OptionSelect
                      size="sm"
                      value={draft.sortDir}
                      onChange={(v) => set("sortDir", v as Draft["sortDir"])}
                      label={t("irt.builder.sort")}
                      disabled={draft.sortField === "none"}
                      options={[
                        { value: "asc", label: t("irt.builder.asc") },
                        { value: "desc", label: t("irt.builder.desc") },
                      ]}
                    />
                  </Field>
                </div>
              </div>
            </SectionCard>
          ) : null}

          {draft && dataset ? (
            <SectionCard title={t("irt.builder.steps.visual")} size="sm">
              <div className="flex flex-col gap-4">
                <Field label={t("irt.builder.chart")}>
                  <OptionSelect
                    size="sm"
                    value={draft.chartKind}
                    onChange={(v) => set("chartKind", v as ChartKind)}
                    label={t("irt.builder.chartKind")}
                    className="w-full"
                    testId="builder-chart"
                    options={(["none", "bar", "line", "donut"] as const).map((k) => ({ value: k, label: tk(`irt.charts.${k}`) }))}
                  />
                </Field>
                {draft.chartKind !== "none" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("irt.builder.chartX")}>
                      <OptionSelect
                        size="sm"
                        value={draft.chartX}
                        onChange={(v) => set("chartX", v)}
                        label={t("irt.builder.chartX")}
                        className="w-full"
                        testId="builder-chart-x"
                        options={groupable.map((f) => ({ value: f.key, label: tk(f.labelKey) }))}
                      />
                    </Field>
                    <Field label={t("irt.builder.chartY")}>
                      <OptionSelect
                        size="sm"
                        value={draft.chartY}
                        onChange={(v) => set("chartY", v)}
                        label={t("irt.builder.chartY")}
                        className="w-full"
                        testId="builder-chart-y"
                        options={numeric.map((f) => ({ value: f.key, label: tk(f.labelKey) }))}
                      />
                    </Field>
                    {draft.chartKind !== "donut" ? (
                      <Field label={t("irt.builder.chartSeries")} className="col-span-2">
                        <OptionSelect
                          size="sm"
                          value={draft.chartSeries}
                          onChange={(v) => set("chartSeries", v)}
                          label={t("irt.builder.chartSeries")}
                          className="w-full"
                          testId="builder-chart-series"
                          options={[
                            { value: "none", label: t("irt.builder.noSeries") },
                            ...groupable.filter((f) => f.key !== draft.chartX).map((f) => ({ value: f.key, label: tk(f.labelKey) })),
                          ]}
                        />
                      </Field>
                    ) : null}
                  </div>
                ) : null}
                {dateFieldOf(dataset) ? (
                  <Field label={t("irt.builder.range")}>
                    <OptionSelect
                      size="sm"
                      value={draft.preset}
                      onChange={(v) => set("preset", v as RangePreset)}
                      label={t("irt.builder.range")}
                      className="w-full"
                      testId="builder-range"
                      options={PRESETS.map((p) => ({ value: p, label: tk(`irt.presets.${p}`) }))}
                    />
                  </Field>
                ) : null}
              </div>
            </SectionCard>
          ) : null}
        </div>

        <SectionCard
          title={t("irt.builder.preview")}
          subtitle={t("irt.builder.previewHint")}
          icon={Eye}
          size="sm"
          className="min-w-0"
          action={
            state.status === "ready" ? (
              <span className="text-xs text-muted-foreground" data-testid="builder-rows" data-rows={state.result.rowCount}>
                {t("irt.common.rows", { count: num(state.result.rowCount) })}
              </span>
            ) : null
          }
        >
          {!draft || !dataset ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("irt.builder.pickDataset")}</p>
          ) : state.status === "ready" ? (
            <div className="flex min-w-0 flex-col gap-4" data-testid="builder-preview">
              {state.result.rowCount === 0 ? (
                <p className="rounded-md bg-surface-raised px-4 py-3 text-sm text-muted-foreground">{t("irt.common.noRowsYet")}</p>
              ) : null}
              {chart && state.result.rowCount ? <ReportChart rows={state.result.rows} dataset={dataset} chart={chart} /> : null}
              <ReportView
                result={state.result}
                title={names.nameEn || reportName(source, locale) || tk(dataset.labelKey)}
                chart={null}
                canExport={can("irt.export")}
              />
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("irt.common.loading")}</p>
          )}
        </SectionCard>
      </div>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent data-testid="builder-save-dialog">
          <DialogHeader>
            <DialogTitle className="text-[1.0625rem] font-semibold">{t("irt.builder.saveTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label={t("irt.builder.nameEn")}>
              <Input value={names.nameEn} onChange={(e) => setNames((n) => ({ ...n, nameEn: e.target.value }))} data-testid="builder-name-en" />
            </Field>
            <Field label={t("irt.builder.nameBn")}>
              <Input value={names.nameBn} onChange={(e) => setNames((n) => ({ ...n, nameBn: e.target.value }))} data-testid="builder-name-bn" />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[0.8125rem]">
              {t("irt.builder.sharedSwitch")}
              <Switch checked={names.shared} onCheckedChange={(on) => setNames((n) => ({ ...n, shared: !!on }))} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="neutral" onClick={() => setSaving(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={names.nameEn.trim().length < 2 || save.pending} data-testid="builder-save-confirm">
              {t("irt.builder.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
