"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { useNow } from "@/core/clock/useNow"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { AccountRow, AccountTag, CostCentreRow, Id, JournalLineRow, PeriodRow } from "@/core/db/schema"
import { readSetting } from "@/core/db/settings"

/**
 * FA live queries (useDb + useLiveQuery). Every screen reads through these,
 * so a posting in any window updates every open ledger, list and statement.
 */

/** Today on the demo clock (re-renders as the clock moves). */
export function useToday(): string {
  const at = useNow(60_000)
  return dhakaDate(at)
}

/** The chart of accounts, by code. */
export function useAccounts(): AccountRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.accounts.orderBy("code").toArray(), [db])
}

export function useCostCentres(): CostCentreRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.costCentres.orderBy("code").toArray(), [db])
}

/** Months (periods) in order, with their fiscal years. */
export function usePeriods(): PeriodRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.periods.orderBy("startsOn").toArray(), [db])
}

/** The posting map: system tag to account id. */
export function usePostingMap(): Record<AccountTag, Id> | undefined {
  const db = useDb()
  return useLiveQuery(() => readSetting(db, "postingAccounts"), [db])
}

/** Posted ledger lines dated on or before `to` (every statement's input). */
export function useLedgerLines(to: string | undefined, from?: string): JournalLineRow[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!to) return []
    if (from) return db.journalLines.where("date").between(from, to, true, true).toArray()
    return db.journalLines.where("date").belowOrEqual(to).toArray()
  }, [db, to, from])
}

/** Balance (debit positive) per account id over every posted line. */
export function useAccountBalances(): Map<Id, number> | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const out = new Map<Id, number>()
    await db.journalLines.each((l) => {
      out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.debitP - l.creditP)
    })
    return out
  }, [db])
}

/** "YYYY-MM" of a day. */
export const monthOf = (day: string) => day.slice(0, 7)

/** The period of a month, from a list. */
export function periodOfMonth(periods: PeriodRow[] | undefined, month: string): PeriodRow | undefined {
  return periods?.find((p) => p.month === month)
}

/** A stable callback that formats "YYYY-MM" as "November 2026" in the window's language. */
export function useMonthLabel(date: (value: string, options?: Intl.DateTimeFormatOptions) => string) {
  return React.useCallback(
    (month: string) => date(`${month}-15T12:00:00+06:00`, { month: "long", year: "numeric" }),
    [date]
  )
}

/**
 * "flash-sync" for about 1.2 s when a live figure changes after it first
 * loaded (ui_guidelines.md §5): a commit in another window tints it, the
 * first load does not.
 */
export function useLiveFlash(value: unknown): string {
  const [flash, setFlash] = React.useState(false)
  const previous = React.useRef<unknown>(undefined)
  React.useEffect(() => {
    if (value === undefined) return
    const before = previous.current
    previous.current = value
    if (before === undefined || Object.is(before, value)) return
    const on = window.setTimeout(() => setFlash(true), 0)
    const off = window.setTimeout(() => setFlash(false), 1200)
    return () => {
      window.clearTimeout(on)
      window.clearTimeout(off)
    }
  }, [value])
  return flash ? "flash-sync" : ""
}
