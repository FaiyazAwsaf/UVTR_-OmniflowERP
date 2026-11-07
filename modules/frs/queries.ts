"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { OmniflowDb } from "@/core/db/database"
import type { AccountRow, AccountTag, Id, JournalLineRow, PeriodRow } from "@/core/db/schema"
import { readSetting } from "@/core/db/settings"

import { previousMonth, tagLines, vatMonthFigures, type VatMonth } from "./vat"

/**
 * FRS live queries. Statements read posted ledger lines (`journalLines`
 * holds posted lines only) up to a day, plus the chart and the posting map;
 * every commit in any window re-runs them.
 */

export type Books = {
  accounts: AccountRow[]
  lines: JournalLineRow[]
  /** System tag to account id */
  map: Record<AccountTag, Id>
  /** Account id to system tag (through the posting map) */
  tagOf: Map<Id, AccountTag>
  periods: PeriodRow[]
}

export async function loadBooks(db: OmniflowDb, to: string): Promise<Books> {
  const [accounts, lines, map, periods] = await Promise.all([
    db.accounts.orderBy("code").toArray(),
    db.journalLines.where("date").belowOrEqual(to).toArray(),
    readSetting(db, "postingAccounts"),
    db.periods.orderBy("startsOn").toArray(),
  ])
  const tagOf = new Map<Id, AccountTag>()
  for (const [tag, id] of Object.entries(map)) tagOf.set(id, tag as AccountTag)
  return { accounts, lines, map, tagOf, periods }
}

/** The books up to a day (undefined while loading or before the clock is read). */
export function useBooks(to: string | undefined): Books | undefined {
  const db = useDb()
  return useLiveQuery(async () => (to && to > "2000" ? loadBooks(db, to) : undefined), [db, to])
}

/** VAT return figures of a month from the ledger (the same maths as frs.submitVatReturn and the seed). */
export async function loadVatMonth(db: OmniflowDb, month: string): Promise<VatMonth> {
  const map = await readSetting(db, "postingAccounts")
  const tagOf = new Map<Id, AccountTag>()
  for (const [tag, id] of Object.entries(map)) tagOf.set(id, tag as AccountTag)
  const ids = (["VAT_OUTPUT", "VAT_CURRENT", "VDS_PAYABLE", "AIT_PAYABLE"] as AccountTag[]).map((t) => map[t])
  const lines = (await db.journalLines.where("date").between(`${month}-01`, `${month}-31`, true, true).toArray()).filter((l) =>
    ids.includes(l.accountId)
  )
  const journals = new Map(
    (await db.journals.bulkGet([...new Set(lines.map((l) => l.journalId))])).filter(Boolean).map((j) => [j!.id, j!])
  )
  const prev = await db.vatReturns.where("month").equals(previousMonth(month)).first()
  return vatMonthFigures(tagLines(lines, journals, tagOf), month, prev?.carryForwardP ?? 0)
}

/** The account a tag maps to. */
export function accountOfTag(books: Books, tag: AccountTag): AccountRow | undefined {
  const id = books.map[tag]
  return books.accounts.find((a) => a.id === id)
}

/** Last day of a "YYYY-MM" month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  return `${month}-${String(days).padStart(2, "0")}`
}

/** "/fa/ledger?account=…&from=…&to=…[&location=…]" for drill-down. */
export function ledgerHref(accountId: Id, from: string, to: string, locationId?: string | null): string {
  return `/fa/ledger?account=${accountId}&from=${from}&to=${to}${locationId ? `&location=${locationId}` : ""}`
}
