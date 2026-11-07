"use client"

import * as React from "react"
import { Check, Download, TriangleAlert } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { locations } from "@/config/brand.config"
import type { PeriodRow } from "@/core/db/schema"
import { downloadCsv, toCsv } from "@/core/reports/csv"
import type { DatasetRow } from "@/core/reports/types"
import { useCan } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { useMonthLabel } from "../queries"

/** "Balanced ✓" in success, or the difference in destructive (ui_guidelines §4 "Voucher lines"). */
export function BalanceCheck({
  debitP,
  creditP,
  balanced,
  testId,
  className,
}: {
  debitP: number
  creditP: number
  /** Overrides debit = credit (statements check more than the two totals) */
  balanced?: boolean
  testId?: string
  className?: string
}) {
  const { t, money } = useLocale()
  const ok = balanced ?? (debitP === creditP && debitP > 0)
  // An empty voucher is not "out of balance by ৳0": say so neutrally until amounts are entered.
  if (balanced === undefined && debitP === 0 && creditP === 0) {
    return (
      <span
        data-testid={testId}
        data-balanced="false"
        className={cn(
          "inline-flex items-center gap-1 text-muted-foreground",
          className
        )}
      >
        {t("fa.common.noAmounts")}
      </span>
    )
  }
  return (
    <span
      data-testid={testId}
      data-balanced={ok ? "true" : "false"}
      className={cn(
        "inline-flex items-center gap-1 font-semibold",
        ok ? "text-success" : "text-destructive",
        className
      )}
    >
      {ok ? (
        <>
          {t("fa.common.balanced")} <Check className="size-4" />
        </>
      ) : (
        <>
          <TriangleAlert className="size-4" />
          {t("fa.common.notBalanced", {
            amount: money(Math.abs(debitP - creditP)),
          })}
        </>
      )}
    </span>
  )
}

/** A signed balance as "৳1,23,456.00 Dr" / "Cr" (debit positive). */
export function DrCr({
  balanceP,
  className,
}: {
  balanceP: number
  className?: string
}) {
  const { t } = useLocale()
  if (balanceP === 0) return <MoneyText poisha={0} className={className} />
  return (
    <span className={cn("nums whitespace-nowrap", className)}>
      <MoneyText poisha={Math.abs(balanceP)} />{" "}
      <span className="text-[0.6875rem] text-muted-foreground">
        {balanceP > 0 ? t("fa.common.dr") : t("fa.common.cr")}
      </span>
    </span>
  )
}

/** Month picker over the periods (newest first), labelled "November 2026". */
export function PeriodSelect({
  periods,
  value,
  onChange,
  testId,
  className,
  filter,
}: {
  periods: PeriodRow[] | undefined
  value: string
  onChange: (month: string) => void
  testId?: string
  className?: string
  filter?: (p: PeriodRow) => boolean
}) {
  const { t, date } = useLocale()
  const label = useMonthLabel(date)
  const list = [...(periods ?? [])]
    .filter((p) => !filter || filter(p))
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn))
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as string)}>
      <SelectTrigger
        className={cn("min-w-44", className)}
        data-testid={testId}
        aria-label={t("fa.common.period")}
      >
        <SelectValue>
          {() => (value ? label(value) : t("fa.periods.selectPeriod"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {list.map((p) => (
          <SelectItem key={p.id} value={p.month}>
            {label(p.month)}
            <span
              lang="en"
              className="ml-auto pl-3 font-mono text-xs text-muted-foreground"
            >
              {p.code}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Location filter with "All locations" (statements, ledger). */
export function LocationFilter({
  value,
  onChange,
  testId,
  className,
}: {
  value: string
  onChange: (locationId: string) => void
  testId?: string
  className?: string
}) {
  const { t, locale } = useLocale()
  const current = locations.find((l) => l.id === value)
  return (
    <Select
      value={value || "all"}
      onValueChange={(v) => onChange(!v || v === "all" ? "" : (v as string))}
    >
      <SelectTrigger
        className={cn("min-w-40", className)}
        data-testid={testId}
        aria-label={t("fa.common.location")}
      >
        <SelectValue>
          {() => (current ? current.name[locale] : t("fa.common.allLocations"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("fa.common.allLocations")}</SelectItem>
        {locations.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name[locale]}
            <span
              lang="en"
              className="ml-auto pl-3 font-mono text-xs text-muted-foreground"
            >
              {l.code}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** CSV export, shown only to holders of the app's export key (fa.export, frs.export). */
export function CsvButton({
  exportKey,
  fileName,
  rows,
  columns,
  testId = "export-csv",
}: {
  exportKey: string
  fileName: string
  rows: () => DatasetRow[]
  columns: { key: string; label: string }[]
  testId?: string
}) {
  const { t } = useLocale()
  const canExport = useCan(exportKey)
  if (!canExport) return null
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid={testId}
      onClick={() => downloadCsv(fileName, toCsv(rows(), columns))}
    >
      <Download />
      {t("fa.common.exportCsv")}
    </Button>
  )
}

/** A filter toolbar row that wraps into stacked controls on a 960x600 window. */
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 print:hidden",
        className
      )}
    >
      {children}
    </div>
  )
}

/** A small muted field label above a control. */
export function Field({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
