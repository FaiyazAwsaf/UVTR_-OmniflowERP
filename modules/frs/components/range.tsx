"use client"

import * as React from "react"
import Link from "next/link"

import { MoneyText } from "@/components/shared/money-text"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fiscalYearBounds } from "@/config/brand.config"
import type { PeriodRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { PeriodSelect } from "@/modules/fa/components/common"
import { useToday } from "@/modules/fa/queries"

import { monthEnd } from "../queries"

export type Scope = "month" | "ytd"

/** A statement's period: a month, or the fiscal year to the end of that month (never past today). */
export function useStatementRange(initialMonth?: string | null) {
  const today = useToday()
  const ready = today > "2000"
  const [month, setMonth] = React.useState<string>(initialMonth ?? "")
  const [scope, setScope] = React.useState<Scope>("month")
  const current = month || (ready ? today.slice(0, 7) : "")
  const end = current ? monthEnd(current) : ""
  const to = end && end > today ? today : end
  const from = !current ? "" : scope === "ytd" ? fiscalYearBounds(`${current}-01`).startsOn : `${current}-01`
  return { today, ready, month: current, setMonth, scope, setScope, from, to }
}

/** Month picker plus "Month / Fiscal year to date". */
export function RangeControls({
  periods,
  month,
  setMonth,
  scope,
  setScope,
  today,
  showScope = true,
}: {
  periods: PeriodRow[] | undefined
  month: string
  setMonth: (m: string) => void
  scope: Scope
  setScope: (s: Scope) => void
  today: string
  showScope?: boolean
}) {
  const { t } = useLocale()
  return (
    <>
      <PeriodSelect periods={periods} value={month} onChange={setMonth} testId="statement-month" filter={(p) => p.startsOn <= today} />
      {showScope ? (
        <ToggleGroup
          value={[scope]}
          onValueChange={(v) => {
            const next = (Array.isArray(v) ? v[0] : v) as Scope | undefined
            if (next) setScope(next)
          }}
          className="rounded-md bg-surface-raised p-0.5"
        >
          <ToggleGroupItem value="month" className="h-8 px-3 text-xs" data-testid="scope-month">
            {t("frs.common.monthOnly")}
          </ToggleGroupItem>
          <ToggleGroupItem value="ytd" className="h-8 px-3 text-xs" data-testid="scope-ytd">
            {t("frs.common.fiscalYtd")}
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
    </>
  )
}

/** A statement figure that opens its ledger (every figure drills down, plan §11). */
export function DrillAmount({
  href,
  poisha,
  className,
  strong,
}: {
  href?: string
  poisha: number
  className?: string
  strong?: boolean
}) {
  const body = <MoneyText poisha={poisha} colorize className={cn(strong && "font-semibold")} />
  if (!href || poisha === 0) return <span className={cn("font-mono", className)}>{body}</span>
  return (
    <Link href={href} data-testid="drill-link" className={cn("font-mono hover:text-link hover:underline", className)}>
      {body}
    </Link>
  )
}

/** A statement table shell: header band, hairline rows, money right-aligned mono, container-query columns. */
export function StatementTable({
  children,
  testId,
  className,
}: {
  children: React.ReactNode
  testId?: string
  className?: string
}) {
  return (
    <div className={cn("@container/st overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]" data-testid={testId}>
        {children}
      </table>
    </div>
  )
}

export const TH = "h-9 bg-surface-raised px-3 font-medium whitespace-nowrap first:rounded-l-md last:rounded-r-md"
export const TD = "h-9 border-b border-hairline px-3"
