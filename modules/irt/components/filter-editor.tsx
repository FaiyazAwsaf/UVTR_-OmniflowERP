"use client"

import * as React from "react"
import { Plus, X } from "lucide-react"

import { DateField } from "@/components/shared/date-field"
import { MoneyInput } from "@/components/shared/money-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ReportFilter } from "@/core/db/schema"
import type { DatasetDef, DatasetField } from "@/core/reports/types"
import { latinDigits } from "@/lib/i18n/dmy"
import { useLocale } from "@/lib/i18n/provider"
import { OptionSelect } from "@/modules/sac/components/kit"

import { enumValues } from "./use-report"

type Op = "eq" | "neq" | "contains" | "gte" | "lte"

function opsFor(field: DatasetField | undefined): Op[] {
  if (!field) return ["eq"]
  if (field.type === "money" || field.type === "number" || field.type === "date") return ["eq", "gte", "lte"]
  if (field.type === "enum") return ["eq", "neq"]
  return ["contains", "eq", "neq"]
}

function blankValue(field: DatasetField | undefined): string | number {
  if (!field) return ""
  if (field.type === "money" || field.type === "number") return 0
  if (field.type === "enum") return enumValues(field.enumKeys)[0] ?? ""
  return ""
}

/**
 * Free filters on a dataset's filterable fields (plan §9 /irt/run, builder):
 * field, operator and value, typed by the field (money in taka, dates as
 * DD-MM-YYYY, enums as their labels). Values are stored as the dataset holds
 * them (poisha, ISO dates, raw enum values).
 */
export function FilterEditor({
  dataset,
  filters,
  onChange,
  testId = "builder-filter",
}: {
  dataset: DatasetDef
  filters: ReportFilter[]
  onChange: (filters: ReportFilter[]) => void
  testId?: string
}) {
  const { t, tk } = useLocale()
  const fields = dataset.fields.filter((f) => f.filterable !== false)
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const set = (index: number, patch: Partial<ReportFilter>) =>
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)))

  return (
    <div className="flex flex-col gap-2">
      {filters.length === 0 ? <p className="text-xs text-muted-foreground">{t("irt.builder.noFilters")}</p> : null}
      {filters.map((filter, index) => {
        const field = byKey.get(filter.field)
        const ops = opsFor(field)
        return (
          <div key={index} className="flex flex-wrap items-center gap-1.5" data-testid={testId} data-field={filter.field}>
            <OptionSelect
              size="sm"
              value={filter.field}
              onChange={(key) => {
                const next = byKey.get(key)
                set(index, { field: key, op: opsFor(next)[0], value: blankValue(next) })
              }}
              label={t("irt.builder.filters")}
              className="min-w-36 flex-1"
              options={fields.map((f) => ({ value: f.key, label: tk(f.labelKey) }))}
            />
            <OptionSelect
              size="sm"
              value={filter.op}
              onChange={(op) => set(index, { op: op as Op })}
              label={t("irt.builder.filters")}
              className="min-w-24"
              options={ops.map((op) => ({ value: op, label: tk(`irt.ops.${op}`) }))}
            />
            <div className="min-w-32 flex-1">
              <ValueInput field={field} value={filter.value} onChange={(value) => set(index, { value })} />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onChange(filters.filter((_, i) => i !== index))}
              aria-label={t("common.remove")}
            >
              <X />
            </Button>
          </div>
        )
      })}
      <div>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            const first = fields[0]
            onChange([...filters, { field: first.key, op: opsFor(first)[0], value: blankValue(first) }])
          }}
          data-testid={`${testId}-add`}
        >
          <Plus />
          {t("irt.run.addFilter")}
        </Button>
      </div>
    </div>
  )
}

function ValueInput({
  field,
  value,
  onChange,
}: {
  field: DatasetField | undefined
  value: ReportFilter["value"]
  onChange: (value: string | number) => void
}) {
  const { tk } = useLocale()
  const scalar = Array.isArray(value) ? (value[0] ?? "") : value
  if (field?.type === "money") {
    return <MoneyInput valueP={Number(scalar) || 0} onChange={(p) => onChange(p ?? 0)} className="[&_input]:h-8" />
  }
  if (field?.type === "number") {
    return (
      <Input
        inputMode="decimal"
        value={String(scalar)}
        onChange={(e) => {
          const n = Number(latinDigits(e.target.value).replace(/[^\d.-]/g, ""))
          onChange(Number.isFinite(n) ? n : 0)
        }}
        className="h-8 text-right font-mono"
      />
    )
  }
  if (field?.type === "date") {
    return <DateField value={String(scalar)} onChange={(iso) => onChange(iso)} className="h-8" />
  }
  if (field?.type === "enum") {
    const values = enumValues(field.enumKeys)
    return (
      <OptionSelect
        size="sm"
        value={String(scalar)}
        onChange={onChange}
        label={tk(field.labelKey)}
        className="w-full"
        options={values.map((v) => ({ value: v, label: tk(`${field.enumKeys}.${v}`) }))}
      />
    )
  }
  return <Input value={String(scalar)} onChange={(e) => onChange(e.target.value)} className="h-8" />
}
