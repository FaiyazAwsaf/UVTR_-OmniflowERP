"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronDown, Download, Search } from "lucide-react"

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
 * Small UI kit shared by the WS-FIN apps (PAR, AR, AP, CAB): the shared
 * list table and labelled field (re-exported from components/shared), a
 * native select in the guideline look, segmented pills, a CSV button gated
 * by the app's export key, and the demo-clock day.
 */

/** Today on the demo clock (Dhaka), re-evaluated every minute; "" before hydration. */
export function useToday(): string {
  const ms = useNow(60_000)
  return ms ? dhakaDate(ms) : ""
}

/** A fresh idempotency key per user action: read `key`, call `renew()` after a commit. */
export function useActionKey(prefix: string): {
  key: string
  renew: () => void
} {
  const [key, setKey] = React.useState(() => newId(prefix))
  return {
    key,
    renew: React.useCallback(() => setKey(newId(prefix)), [prefix]),
  }
}

/* ---------------- List table ---------------- */

export { ListTable, type Column } from "@/components/shared/list-table"
export { Field } from "@/components/shared/form-field"

/* ---------------- Inputs ---------------- */

export type Option = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

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
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
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
    <div
      role="radiogroup"
      data-testid={testId}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
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
            o.value === value
              ? "bg-primary text-primary-foreground"
              : "bg-surface-raised text-foreground hover:bg-primary-soft"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
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
    <div
      className={cn("flex min-w-0 flex-col gap-0.5", className)}
      data-testid={testId}
    >
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "nums truncate font-mono text-base font-semibold tabular-nums",
          tone === "warning" &&
            "text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning",
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
        tone === "warning" &&
          "bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-foreground [&_svg]:text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:[&_svg]:text-warning",
        tone === "info" &&
          "bg-[color-mix(in_oklch,var(--info)_14%,transparent)] [&_svg]:text-info",
        tone === "destructive" &&
          "bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] [&_svg]:text-destructive",
        tone === "success" &&
          "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] [&_svg]:text-success",
        className
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Text input in the guideline look. */
export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { testId?: string }
>(function TextInput({ className, testId, ...props }, ref) {
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
})

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
    <Button
      nativeButton={false}
      variant={variant}
      size={size}
      className={className}
      data-testid={testId}
      render={<Link href={href} />}
    >
      {children}
    </Button>
  )
}
