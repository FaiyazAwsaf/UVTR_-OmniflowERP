"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { newId } from "@/core/db/ids"
import { downloadCsv, toCsv } from "@/core/reports/csv"
import type { DatasetRow } from "@/core/reports/types"
import { useCan } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * Small UI kit shared by the WS-FIN apps (PAR, AR, AP, CAB): a list table
 * with row test ids and container-query column hiding, a native select in
 * the guideline look, segmented pills, a labelled field, a CSV button gated
 * by the app's export key, and the demo-clock day.
 */

/** Today on the demo clock (Dhaka), re-evaluated every minute; "" before hydration. */
export function useToday(): string {
  const ms = useNow(60_000)
  return ms ? dhakaDate(ms) : ""
}

/** A fresh idempotency key per user action: read `key`, call `renew()` after a commit. */
export function useActionKey(prefix: string): { key: string; renew: () => void } {
  const [key, setKey] = React.useState(() => newId(prefix))
  return { key, renew: React.useCallback(() => setKey(newId(prefix)), [prefix]) }
}

/* ---------------- List table ---------------- */

export type Column<T> = {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  align?: "right"
  /** Hide below this container width (960x600 keeps the table readable) */
  hide?: "sm" | "md" | "lg"
  className?: string
  /** Enables sorting on this column */
  sortValue?: (row: T) => string | number
}

const HIDE: Record<"sm" | "md" | "lg", string> = {
  sm: "hidden @min-[30rem]/list:table-cell",
  md: "hidden @min-[42rem]/list:table-cell",
  lg: "hidden @min-[56rem]/list:table-cell",
}

/**
 * The guideline table (ui_guidelines.md §4): raised header band, hairline
 * rows, money right-aligned, status as coloured text. Rows carry a test id
 * and extra data attributes for e2e tests; columns hide by container width.
 */
export function ListTable<T>({
  rows,
  columns,
  rowKey,
  rowTestId,
  rowAttrs,
  onRowClick,
  rowClassName,
  pageSize = 25,
  footer,
  empty,
  dense = false,
  className,
}: {
  rows: T[] | undefined
  columns: Column<T>[]
  rowKey: (row: T) => string
  rowTestId?: string
  rowAttrs?: (row: T) => Record<string, string | number | boolean | undefined>
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  pageSize?: number
  /** Cells of a totals row, keyed by column key */
  footer?: Partial<Record<string, React.ReactNode>>
  empty?: React.ReactNode
  dense?: boolean
  className?: string
}) {
  const { t, num } = useLocale()
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [page, setPage] = React.useState(0)
  const list = React.useMemo(() => {
    const base = rows ?? []
    if (!sort) return base
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return base
    return [...base].sort((a, b) => {
      const x = col.sortValue!(a)
      const y = col.sortValue!(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [rows, sort, columns])
  const pages = Math.max(1, Math.ceil(list.length / pageSize))
  const current = Math.min(page, pages - 1)
  const shown = list.slice(current * pageSize, current * pageSize + pageSize)
  const h = dense ? "h-9" : "h-11"

  return (
    <div className={cn("@container/list flex min-w-0 flex-col", className)} data-slot="list-table">
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
          <thead>
            <tr>
              {columns.map((c) => {
                const sorted = sort?.key === c.key ? sort.dir : 0
                return (
                  <th
                    key={c.key}
                    scope="col"
                    onClick={
                      c.sortValue
                        ? () => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))
                        : undefined
                    }
                    className={cn(
                      "bg-surface-raised px-3 font-medium whitespace-nowrap first:rounded-l-md last:rounded-r-md",
                      h,
                      c.align === "right" ? "text-right" : "text-left",
                      c.sortValue && "cursor-pointer select-none hover:text-link",
                      c.hide && HIDE[c.hide]
                    )}
                  >
                    <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                      {c.header}
                      {sorted === 1 ? <ArrowUp className="size-3.5 text-primary" /> : sorted === -1 ? <ArrowDown className="size-3.5 text-primary" /> : null}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const attrs = rowAttrs?.(row) ?? {}
              const data: Record<string, string> = {}
              for (const [k, v] of Object.entries(attrs)) if (v !== undefined) data[`data-${k}`] = String(v)
              return (
                <tr
                  key={rowKey(row)}
                  data-testid={rowTestId}
                  {...data}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "transition-colors hover:bg-primary-soft",
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "border-b border-hairline px-3 align-middle",
                        h,
                        c.align === "right" && "nums text-right whitespace-nowrap tabular-nums",
                        c.hide && HIDE[c.hide],
                        c.className
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {footer && shown.length ? (
            <tfoot>
              <tr>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "bg-surface-raised px-3 font-semibold first:rounded-l-md last:rounded-r-md",
                      h,
                      c.align === "right" && "nums text-right whitespace-nowrap tabular-nums",
                      c.hide && HIDE[c.hide]
                    )}
                  >
                    {footer[c.key] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {rows && !list.length ? (
        empty ?? <EmptyState icon={<Search />} title={t("common.noResults")} description={t("common.noResultsHint")} size="sm" />
      ) : null}
      {pages > 1 ? (
        <div className="flex h-11 items-center gap-2 pt-2">
          <span className="nums text-xs text-muted-foreground">
            {num(current * pageSize + 1)} - {num(Math.min((current + 1) * pageSize, list.length))} {t("common.of")} {num(list.length)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={t("common.previous")} disabled={current === 0} onClick={() => setPage(current - 1)}>
              <ChevronLeft />
            </Button>
            <span className="nums px-1 text-xs text-muted-foreground">
              {num(current + 1)} / {num(pages)}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.next")} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ---------------- Inputs ---------------- */

export type Option = { value: string; label: React.ReactNode; disabled?: boolean }

/** A native select in the guideline look (outlined, chevron right); easy to drive in tests. */
export function NativeSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  testId,
  disabled,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; disabled?: boolean }[]
  placeholder?: string
  className?: string
  testId?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full min-w-0 appearance-none rounded-md border border-border bg-transparent pr-8 pl-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60 [&>option]:bg-popover [&>option]:text-popover-foreground"
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

/** Segmented choice as pills (selected pill turquoise), e.g. a receipt method. */
export function Pills({
  value,
  onChange,
  options,
  testId,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: Option[]
  testId?: string
  className?: string
}) {
  return (
    <div role="radiogroup" data-testid={testId} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 rounded-full px-3 text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50",
            o.value === value ? "bg-primary text-primary-foreground" : "bg-surface-raised text-foreground hover:bg-primary-soft"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A labelled form field (label above, hint or error below). */
export function Field({
  label,
  hint,
  error,
  group = false,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  /** A group of controls (pills, checkboxes): a labelled group instead of a <label> */
  group?: boolean
  children: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  const foot = error ? <span className="text-xs text-destructive">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null
  if (group) {
    return (
      <div role="group" aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <span id={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {children}
        {foot}
      </div>
    )
  }
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {foot}
    </label>
  )
}

/** Filled search input for list toolbars. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  testId,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  testId?: string
  className?: string
}) {
  const { t } = useLocale()
  return (
    <div className={cn("relative w-full max-w-96 min-w-40 flex-1", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t("common.search")}
        className="h-10 w-full rounded-md border border-border bg-input pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
      />
    </div>
  )
}

/** CSV export of rows, shown only to holders of the app's export key. */
export function CsvButton({
  exportKey,
  fileName,
  rows,
  columns,
}: {
  exportKey: string
  fileName: string
  rows: DatasetRow[] | undefined
  columns: { key: string; label: string }[]
}) {
  const { t } = useLocale()
  const allowed = useCan(exportKey)
  if (!allowed) return null
  return (
    <Button
      variant="neutral"
      size="sm"
      data-testid="csv-export"
      disabled={!rows?.length}
      onClick={() => rows && downloadCsv(fileName, toCsv(rows, columns))}
    >
      <Download />
      {t("common.exportCsv")}
    </Button>
  )
}

/** A compact stat (label and value) for header strips and right rails. */
export function Stat({
  label,
  value,
  tone,
  testId,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  tone?: "warning" | "destructive" | "success" | "info"
  testId?: string
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)} data-testid={testId}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "nums truncate font-mono text-base font-semibold tabular-nums",
          tone === "warning" && "text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning",
          tone === "destructive" && "text-destructive",
          tone === "success" && "text-success",
          tone === "info" && "text-info"
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** A warning-tint banner (credit hold, on-hold bills, closed periods). */
export function Banner({
  tone = "warning",
  icon,
  children,
  testId,
  className,
}: {
  tone?: "warning" | "info" | "destructive" | "success"
  icon?: React.ReactNode
  children: React.ReactNode
  testId?: string
  className?: string
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-3 rounded-lg px-4 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "warning" && "bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-foreground [&_svg]:text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:[&_svg]:text-warning",
        tone === "info" && "bg-[color-mix(in_oklch,var(--info)_14%,transparent)] [&_svg]:text-info",
        tone === "destructive" && "bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] [&_svg]:text-destructive",
        tone === "success" && "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] [&_svg]:text-success",
        className
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Text input in the guideline look. */
export const TextInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input"> & { testId?: string }>(
  function TextInput({ className, testId, ...props }, ref) {
    return (
      <input
        ref={ref}
        data-testid={testId}
        {...props}
        className={cn(
          "h-10 w-full min-w-0 rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-60",
          className
        )}
      />
    )
  }
)

/** A link styled as a button (primary by default). */
export function LinkButton({
  href,
  children,
  variant,
  size,
  testId,
  className,
}: {
  href: string
  children: React.ReactNode
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  testId?: string
  className?: string
}) {
  return (
    <Button nativeButton={false} variant={variant} size={size} className={className} data-testid={testId} render={<Link href={href} />}>
      {children}
    </Button>
  )
}
