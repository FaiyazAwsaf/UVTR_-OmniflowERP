"use client"

import * as React from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { locations as LOCATIONS, type LocationCode } from "@/config/brand.config"
import { useLocale } from "@/lib/i18n/provider"

import type { RevenueTrend, StudioOps, StudioStatusKey } from "../types"
import { STUDIO_STATUSES } from "../types"

/**
 * Recharts charts styled by the tokens (ui_guidelines.md §4 "Charts"): a
 * smooth turquoise and lavender revenue trend with gradient fills, and
 * grouped bars for jobs by status per studio. Faint grid, muted axes, money
 * axes in lakh and crore, the tooltip on `--tooltip`.
 */

const SERIES_COLOR: Partial<Record<LocationCode, string>> = { GUL: "var(--chart-1)", UTT: "var(--chart-2)", HQ: "var(--chart-3)", CST: "var(--chart-4)" }
const AXIS = { fill: "#77727b", fontSize: 11 }

function useStudioName() {
  const { locale } = useLocale()
  return React.useCallback((code: string) => LOCATIONS.find((l) => l.code === code)?.name[locale] ?? code, [locale])
}

/** Net revenue per day and studio over 30 days (from the IRT-16 dataset). */
export function RevenueTrendChart({ trend, height = 240 }: { trend: RevenueTrend; height?: number }) {
  const { compact, money, dmy, locale } = useLocale()
  const studioName = useStudioName()
  const gradientId = React.useId().replace(/:/g, "")
  const data = React.useMemo(
    () =>
      trend.points.map((p) => {
        const row: Record<string, string | number> = { date: p.date }
        for (const s of trend.series) row[s] = (p[s] ?? 0) / 100
        return row
      }),
    [trend]
  )
  const tick = (iso: string) => {
    const text = `${iso.slice(8, 10)}-${iso.slice(5, 7)}`
    return locale === "bn" ? text.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]) : text
  }
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {trend.series.map((s) => (
              <linearGradient key={s} id={`${gradientId}-${s}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES_COLOR[s] ?? "var(--chart-1)"} stopOpacity={0.35} />
                <stop offset="100%" stopColor={SERIES_COLOR[s] ?? "var(--chart-1)"} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick} minTickGap={18} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `৳${compact(v)}`} />
          <Tooltip
            formatter={(v, name) => [money(Math.round(Number(v) * 100)), studioName(String(name))]}
            labelFormatter={(label) => dmy(String(label))}
            contentStyle={{ background: "var(--tooltip)", border: 0, borderRadius: 8, color: "#fff", fontSize: 12 }}
            labelStyle={{ color: "#fff" }}
            cursor={{ stroke: "var(--primary)", strokeDasharray: "3 3" }}
          />
          {trend.series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(value) => studioName(String(value))} /> : null}
          {trend.series.map((s) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stroke={SERIES_COLOR[s] ?? "var(--chart-1)"}
              strokeWidth={2.5}
              fill={`url(#${gradientId}-${s})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Jobs by status today, bars grouped by studio. */
export function JobsBarChart({ studios, height = 200 }: { studios: StudioOps[]; height?: number }) {
  const { t, num } = useLocale()
  const studioName = useStudioName()
  const data = STUDIO_STATUSES.map((s: StudioStatusKey) => {
    const row: Record<string, string | number> = { status: t(`dashboard.exec.jobs.status.${s}` as "dashboard.exec.jobs.status.booked") }
    for (const st of studios) row[st.code] = st.counts[s]
    return row
  })
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
          <XAxis dataKey="status" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={28} allowDecimals={false} tickFormatter={(v: number) => num(v)} />
          <Tooltip
            formatter={(v, name) => [num(Number(v)), studioName(String(name))]}
            contentStyle={{ background: "var(--tooltip)", border: 0, borderRadius: 8, color: "#fff", fontSize: 12 }}
            labelStyle={{ color: "#fff" }}
            cursor={{ fill: "var(--primary-soft)" }}
          />
          {studios.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(value) => studioName(String(value))} /> : null}
          {studios.map((st) => (
            <Bar key={st.code} dataKey={st.code} fill={SERIES_COLOR[st.code] ?? "var(--chart-1)"} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export { SERIES_COLOR }
