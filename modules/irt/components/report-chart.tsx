"use client"

import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { useCellFormatter } from "@/components/shared/report-view"
import type { ReportDefinitionRow } from "@/core/db/schema"
import type { DatasetDef, DatasetRow } from "@/core/reports/types"
import { useLocale } from "@/lib/i18n/provider"

export type ChartSpec = NonNullable<ReportDefinitionRow["chart"]>

const COLORS = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`)
const MAX_SERIES = 7

type Point = Record<string, string | number>

/**
 * The report chart (ui_guidelines.md §4 "Charts"): bars for comparisons
 * (grouped by a series such as the studio), a smooth line, or a donut.
 * Money values plot in taka with compact lakh and crore ticks.
 */
export function ReportChart({
  rows,
  dataset,
  chart,
  height = 280,
}: {
  rows: DatasetRow[]
  dataset: DatasetDef
  chart: ChartSpec
  height?: number
}) {
  const { locale, compact, money, num } = useLocale()
  const format = useCellFormatter()
  const fields = React.useMemo(() => new Map(dataset.fields.map((f) => [f.key, f])), [dataset])
  const yField = fields.get(chart.y)
  const isMoney = yField?.type === "money"
  const scale = (v: number) => (isMoney ? v / 100 : v)

  const { data, series } = React.useMemo(() => {
    const label = (key: string, row: DatasetRow) => format(fields.get(key), row[key]) || "-"
    if (!chart.series || chart.kind === "donut") {
      const sums = new Map<string, number>()
      for (const row of rows) {
        const x = label(chart.x, row)
        sums.set(x, (sums.get(x) ?? 0) + (Number(row[chart.y]) || 0))
      }
      return { data: [...sums].map(([x, y]) => ({ x, y: scale(y) }) as Point), series: ["y"] }
    }
    const totals = new Map<string, number>()
    for (const row of rows) {
      const s = label(chart.series, row)
      totals.set(s, (totals.get(s) ?? 0) + Math.abs(Number(row[chart.y]) || 0))
    }
    const ranked = [...totals].sort((a, b) => b[1] - a[1]).map(([s]) => s)
    const kept = new Set(ranked.slice(0, MAX_SERIES))
    const other = locale === "bn" ? "অন্যান্য" : "Other"
    const byX = new Map<string, Point>()
    for (const row of rows) {
      const x = label(chart.x, row)
      const s0 = label(chart.series, row)
      const s = kept.has(s0) ? s0 : other
      const point = byX.get(x) ?? { x }
      point[s] = Number(point[s] ?? 0) + scale(Number(row[chart.y]) || 0)
      byX.set(x, point)
    }
    const names = [...ranked.filter((s) => kept.has(s)), ...(ranked.length > MAX_SERIES ? [other] : [])]
    return { data: [...byX.values()], series: names }
    // `format` is stable per locale; rows and the spec drive the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, chart, fields, locale])

  if (!data.length) return null

  const tick = (v: number) => (isMoney ? `৳${compact(v)}` : compact(v))
  const tip = (v: unknown) => (isMoney ? money(Math.round(Number(v) * 100)) : num(Number(v)))
  const axis = { fill: "#77727b", fontSize: 11 }
  const tooltip = (
    <Tooltip
      formatter={(v) => tip(v)}
      contentStyle={{ background: "var(--tooltip)", border: 0, borderRadius: 8, color: "#fff" }}
      labelStyle={{ color: "#fff" }}
      cursor={{ fill: "var(--primary-soft)" }}
    />
  )

  return (
    <div className="surface-card p-4" style={{ height }} data-testid="report-chart-irt" data-kind={chart.kind} data-series={series.length}>
      <ResponsiveContainer width="100%" height="100%">
        {chart.kind === "donut" ? (
          <PieChart>
            {tooltip}
            <Pie data={data} dataKey="y" nameKey="x" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : chart.kind === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="x" tick={axis} tickLine={false} axisLine={false} />
            <YAxis tick={axis} tickFormatter={tick} tickLine={false} axisLine={false} width={64} />
            {tooltip}
            {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
            {series.map((s, i) => (
              <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="x" tick={axis} tickLine={false} axisLine={false} interval={0} />
            <YAxis tick={axis} tickFormatter={tick} tickLine={false} axisLine={false} width={64} />
            {tooltip}
            {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={36} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
