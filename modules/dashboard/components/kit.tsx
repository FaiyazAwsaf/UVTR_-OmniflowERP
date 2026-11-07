"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Lock,
  type LucideIcon,
} from "lucide-react"

import { NumberTicker } from "@/components/motion/number-ticker"
import type { KpiVariant } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { Skeleton } from "@/components/ui/skeleton"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { routeAllowed } from "@/core/security/routes"
import { usePermissions } from "@/core/security/useCan"
import { SYSTEM_REPORTS } from "@/core/seed/generators/reports"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { accessKeyOf } from "@/modules/irt/params"

import type { HomeKpiFormat, Tone } from "../types"

/**
 * Building blocks of the dashboard, the role homes and the studio home: the
 * drill-down link (every figure opens the report or screen that proves it),
 * gradient KPI cards with live flash (ui_guidelines.md §4 "KPI card", §5),
 * calm tiles, period pills and list rows.
 */

/** Today on the demo clock ("" before the clock is read), refreshed every minute. */
export function useDemoToday(): { today: string; nowMs: number } {
  const nowMs = useNow(60_000)
  return { today: nowMs ? dhakaDate(nowMs) : "", nowMs }
}

/** Whether this window's user may open a route (and, for an IRT report, its dataset). */
export function useMayOpen(): (href: string) => boolean {
  const { can } = usePermissions()
  return React.useCallback(
    (href: string) => {
      const path = href.split("?")[0]
      if (!routeAllowed(path, can)) return false
      const irt = /^\/irt\/run\/([^/?]+)$/.exec(path)
      if (irt) {
        const def = SYSTEM_REPORTS.find((r) => r.code === irt[1])
        if (def) return can(accessKeyOf(def.dataset, def.frsRoute))
      }
      return true
    },
    [can]
  )
}

/**
 * The drill-down link of a tile (`data-testid="drill-link"`, `data-href`).
 * When the user cannot open the target it stays visible but muted, with a
 * lock, so the figure never points at an access-denied page.
 */
export function DrillLink({
  href,
  label,
  className,
  tone = "link",
}: {
  href: string
  label?: React.ReactNode
  className?: string
  tone?: "link" | "inherit"
}) {
  const { t } = useLocale()
  const mayOpen = useMayOpen()
  const text = label ?? t("dashboard.common.drill")
  if (!mayOpen(href)) {
    return (
      <span
        data-testid="drill-link"
        data-href={href}
        aria-disabled="true"
        title={t("dashboard.common.drillLocked")}
        className={cn(
          "inline-flex items-center gap-1 text-xs opacity-60",
          className
        )}
      >
        <Lock className="size-3" />
        {text}
      </span>
    )
  }
  return (
    <Link
      href={href}
      data-testid="drill-link"
      data-href={href}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 text-xs font-medium underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        tone === "link" ? "text-link" : "text-inherit",
        className
      )}
    >
      {text}
      <ChevronRight className="size-3.5" />
    </Link>
  )
}

/**
 * "flash-sync" for about 1.2 s when a live figure changes (ui_guidelines.md
 * §5), but not when the screen's own filters changed it: for two seconds
 * after `scope` (the period and location) changes, a new value only becomes
 * the baseline. The first loaded value never flashes.
 */
export function useScopedFlash(
  value: unknown,
  scope: string,
  durationMs = 1200
): string {
  const last = React.useRef<{
    scope: string
    value: unknown
    scopedAt: number
  } | null>(null)
  const [flashKey, setFlashKey] = React.useState(0)
  React.useEffect(() => {
    if (value === undefined) return
    const at = performance.now()
    const prev = last.current
    if (!prev) {
      last.current = { scope, value, scopedAt: -Infinity }
      return
    }
    if (prev.scope !== scope) {
      last.current = { scope, value, scopedAt: at }
      return
    }
    if (Object.is(prev.value, value)) return
    last.current = { ...prev, value }
    if (at - prev.scopedAt < 2000) return
    const start = window.setTimeout(() => setFlashKey((k) => k + 1), 0)
    const stop = window.setTimeout(() => setFlashKey(0), durationMs)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(stop)
      setFlashKey(0)
    }
  }, [value, scope, durationMs])
  return flashKey > 0 ? "flash-sync" : ""
}

/** Whole taka for a big animated figure (exact poisha stay in `data-amount`). */
/** A figure whose data is still loading: a bar the size of a number, never a misleading 0. */
export function FigureSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("inline-block h-[0.9em] w-[5.5ch] align-middle", className)}
      data-testid="figure-loading"
    />
  )
}

export function MoneyFigure({
  poisha,
  className,
}: {
  poisha: number | undefined
  className?: string
}) {
  if (poisha === undefined) return <FigureSkeleton className={className} />
  return (
    <NumberTicker
      value={Math.round(poisha / 100)}
      prefix={poisha < 0 ? "-৳" : "৳"}
      format={{ maximumFractionDigits: 0 }}
      className={className}
    />
  )
}

/** A calm tile's amount (no ticker), with the loading bar until it is known. */
export function MoneyValue({
  poisha,
  className,
}: {
  poisha: number | undefined
  className?: string
}) {
  if (poisha === undefined) return <FigureSkeleton className={className} />
  return <MoneyText poisha={poisha} className={className} />
}

/** A KPI's value in its format. */
export function FormattedFigure({
  value,
  format,
  className,
}: {
  value: number | undefined
  format: HomeKpiFormat
  className?: string
}) {
  const { pct } = useLocale()
  if (value === undefined) return <FigureSkeleton className={className} />
  if (format === "money")
    return <MoneyFigure poisha={value} className={className} />
  if (format === "pct")
    return <span className={cn("nums", className)}>{pct(value, 1)}</span>
  return <NumberTicker value={value} className={className} />
}

/** Signed percentage chip on a gradient card. */
export function DeltaChip({ value }: { value: number }) {
  const { num } = useLocale()
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="kpi-chip nums inline-flex h-6 shrink-0 items-center gap-1 px-2 text-[0.6875rem] font-semibold tabular-nums">
      <Icon className="size-3.5" />
      {up ? "+" : ""}
      {num(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
    </span>
  )
}

/**
 * A gradient KPI card for a home screen's top row, with its drill-down link
 * in the footer and the turquoise ring flash when another window's commit
 * moves the figure. `data-amount` (poisha) or `data-value` carry the exact figure.
 */
export function GradientKpi({
  testId,
  kind,
  variant,
  icon: Icon,
  title,
  value,
  amount,
  dataValue,
  flashKey,
  scope = "",
  delta,
  caption,
  href,
  drillLabel,
  className,
}: {
  testId: string
  kind?: string
  variant: KpiVariant
  icon: LucideIcon
  title: React.ReactNode
  value: React.ReactNode
  amount?: number
  dataValue?: number | string
  flashKey?: unknown
  /** The filters the figure depends on (changes there never flash) */
  scope?: string
  delta?: number | null
  caption?: React.ReactNode
  href: string
  drillLabel?: React.ReactNode
  className?: string
}) {
  const flash = useScopedFlash(flashKey, scope)
  return (
    <div
      data-testid={testId}
      data-kind={kind}
      data-amount={amount}
      data-value={dataValue}
      data-flash={flash ? "true" : undefined}
      className={cn(
        "kpi @container/kpi relative flex min-h-[8.5rem] min-w-0 flex-col justify-between gap-3 p-4 transition-shadow duration-300 @min-[15rem]/kpi:p-5",
        `kpi-${variant}`,
        flash && "shadow-[0_0_0_3px_var(--primary),0_0_22px_var(--primary)]",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="kpi-well flex size-9 shrink-0 items-center justify-center [&_svg]:size-[1.125rem]">
          <Icon />
        </span>
        <span className="min-w-0 truncate text-[0.9375rem] leading-snug font-semibold">
          {title}
        </span>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <span className="figure min-w-0 truncate text-[1.625rem] leading-none @min-[17rem]/kpi:text-[1.75rem]">
          {value}
        </span>
        {typeof delta === "number" && Number.isFinite(delta) ? (
          <DeltaChip value={delta} />
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate opacity-80">{caption}</span>
        <DrillLink
          href={href}
          label={drillLabel}
          tone="inherit"
          className="font-semibold"
        />
      </div>
    </div>
  )
}

/** A calm figure tile (surface card): label, figure, caption and its drill-down link. */
export function FigureTile({
  testId,
  icon: Icon,
  title,
  value,
  amount,
  dataValue,
  flashKey,
  scope = "",
  caption,
  note,
  href,
  tone,
  children,
}: {
  testId: string
  icon: LucideIcon
  title: React.ReactNode
  value: React.ReactNode
  amount?: number
  dataValue?: number | string
  flashKey?: unknown
  scope?: string
  caption?: React.ReactNode
  note?: React.ReactNode
  href: string
  tone?: Tone
  children?: React.ReactNode
}) {
  const flash = useScopedFlash(flashKey, scope)
  return (
    <section
      data-testid={testId}
      data-amount={amount}
      data-value={dataValue}
      className={cn("surface-card flex min-w-0 flex-col gap-2.5 p-4", flash)}
    >
      <header className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="icon-well flex size-8 shrink-0 items-center justify-center text-link">
            <Icon className="size-4" />
          </span>
          <span className="truncate text-[0.8125rem] font-medium text-muted-foreground">
            {title}
          </span>
        </span>
        {note ? (
          <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-[0.625rem] text-muted-foreground">
            {note}
          </span>
        ) : null}
      </header>
      <div
        className={cn(
          "figure truncate text-[1.375rem] leading-tight",
          tone && TONE_TEXT[tone]
        )}
      >
        {value}
      </div>
      {children}
      <footer className="mt-auto flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {caption}
        </span>
        <DrillLink href={href} />
      </footer>
    </section>
  )
}

export const TONE_TEXT: Record<Tone, string> = {
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
  success: "text-success",
  muted: "text-muted-foreground",
}

export const TONE_DOT: Record<Tone, string> = {
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  success: "bg-success",
  muted: "bg-muted-foreground",
}

/** Pills for a small set of options (the selected one turquoise), each with a test id. */
export function Pills<T extends string>({
  options,
  value,
  onChange,
  testId,
  label,
}: {
  options: { value: T; label: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
  testId: string
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      data-value={value}
      className="flex items-center gap-1 rounded-full bg-surface-raised p-1"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            data-testid={`${testId}-${o.value}`}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-7 shrink-0 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A right-rail style list row: icon well, title, sub-line, a right-hand figure and a chevron, the whole row a link. */
export function ListRow({
  href,
  icon: Icon,
  tone = "muted",
  title,
  sub,
  right,
  testId,
  data,
}: {
  href: string
  icon: LucideIcon
  tone?: Tone
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
  testId?: string
  data?: Record<string, string | number | undefined>
}) {
  const mayOpen = useMayOpen()
  const attrs = Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v])
  )
  const body = (
    <>
      <span
        className={cn(
          "icon-well flex size-9 shrink-0 items-center justify-center",
          TONE_TEXT[tone]
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.875rem] font-semibold">{title}</span>
        {sub ? (
          <span className="truncate text-xs text-muted-foreground">{sub}</span>
        ) : null}
      </span>
      {right ? (
        <span className="shrink-0 text-right text-[0.8125rem]">{right}</span>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </>
  )
  const cls =
    "flex min-w-0 items-center gap-3 border-b border-hairline px-1 py-2.5 last:border-b-0"
  if (!mayOpen(href)) {
    return (
      <li
        data-testid={testId}
        {...attrs}
        data-href={href}
        className={cn(cls, "opacity-70")}
      >
        {body}
      </li>
    )
  }
  return (
    <li data-testid={testId} {...attrs} data-href={href}>
      <Link
        href={href}
        className={cn(
          cls,
          "rounded-md outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40"
        )}
      >
        {body}
      </Link>
    </li>
  )
}

/** A thin horizontal share bar (0 to 100). */
export function ShareBar({
  pct,
  className,
  color = "var(--primary)",
}: {
  pct: number
  className?: string
  color?: string
}) {
  const width = Math.max(0, Math.min(100, pct))
  return (
    <span
      className={cn(
        "block h-1.5 w-full overflow-hidden rounded-full bg-surface-raised",
        className
      )}
    >
      <span
        className="block h-full rounded-full transition-[width] duration-500"
        style={{ width: `${width}%`, background: color }}
      />
    </span>
  )
}
