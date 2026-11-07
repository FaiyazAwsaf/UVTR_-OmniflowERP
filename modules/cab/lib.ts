import type { CashBankAccountRow, ISODate, Poisha, StatementLine } from "@/core/db/schema"

import { daysBetween } from "@/modules/ar/lib"

/**
 * CAB pure helpers: the reconciliation auto-match (amount equal, date within
 * ± `rules.reconMatchDays`, and the reference), the reconciled state of a
 * statement line, and how a contra transfer is classed.
 */

/** A book line on the bank's GL account, as the matcher sees it. */
export type BookLine = {
  id: string
  date: ISODate
  /** Signed: + money in (debit), − money out (credit) */
  amountP: Poisha
  /** Source document number, else the voucher number */
  ref: string
  journalNo: string
}

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase()

/**
 * Pairs unmatched statement lines with unreconciled book lines: same amount,
 * dates within `days`, and the same reference (a line without a reference
 * matches only when exactly one candidate fits). Each book line is used once.
 */
export function autoMatch(
  lines: Pick<StatementLine, "lineId" | "date" | "ref" | "amountP" | "matchedJournalLineIds" | "note">[],
  book: BookLine[],
  days: number
): { lineId: string; journalLineId: string }[] {
  const used = new Set<string>()
  const out: { lineId: string; journalLineId: string }[] = []
  for (const line of lines) {
    if (line.matchedJournalLineIds.length || line.note) continue
    const candidates = book.filter(
      (b) => !used.has(b.id) && b.amountP === line.amountP && Math.abs(daysBetween(b.date, line.date)) <= days
    )
    if (!candidates.length) continue
    let pick: BookLine | undefined
    if (line.ref) {
      const ref = norm(line.ref)
      pick = candidates.find((b) => norm(b.ref) === ref || norm(b.journalNo) === ref)
    } else if (candidates.length === 1) {
      pick = candidates[0]
    }
    if (!pick) continue
    used.add(pick.id)
    out.push({ lineId: line.lineId, journalLineId: pick.id })
  }
  return out
}

/** A statement line is settled when it is matched to book lines or explained with a note. */
export function lineSettled(line: Pick<StatementLine, "matchedJournalLineIds" | "note">): boolean {
  return line.matchedJournalLineIds.length > 0 || !!line.note
}

/** Contra transfer class from the two accounts' kinds (R17). */
export function transferKind(from: Pick<CashBankAccountRow, "kind">, to: Pick<CashBankAccountRow, "kind">): "deposit" | "withdrawal" | "transfer" | "top-up" {
  if (to.kind === "petty-cash") return "top-up"
  if (from.kind === "cash-till" && to.kind === "bank") return "deposit"
  if (from.kind === "bank" && to.kind === "cash-till") return "withdrawal"
  return "transfer"
}

/** The first and last day of the month before `today`. */
export function lastMonthRange(today: ISODate): { from: ISODate; to: ISODate } {
  const [y, m] = today.split("-").map(Number)
  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  const from = `${prevY}-${String(prevM).padStart(2, "0")}-01`
  const last = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate()
  return { from, to: `${prevY}-${String(prevM).padStart(2, "0")}-${String(last).padStart(2, "0")}` }
}
