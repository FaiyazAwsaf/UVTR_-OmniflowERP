import type { CashBankAccountRow, Id, ISODate, Poisha, StatementLine } from "@/core/db/schema"

import { daysBetween } from "@/modules/ar/lib"

/**
 * CAB pure helpers: the reconciliation auto-match (amount equal, date within
 * ± `rules.reconMatchDays`, and the reference), the reconciled state of a
 * statement line, how a contra transfer is classed, and which accounts a
 * user's CAB view scope covers.
 */

/** Head Office: banks, wallets and card clearing (accounts without a location) belong to it for scope. */
export const CAB_HQ: Id = "loc_hq"

/** The location an account counts as for scope: its own, else Head Office. */
export function accountScopeLocation(account: Pick<CashBankAccountRow, "locationId">): Id {
  return account.locationId ?? CAB_HQ
}

/** A permission check at a location, as `usePermissions().can` or `grantAllows` give it. */
export type CanAt = (permission: string, locationId?: Id | null) => boolean

/**
 * Whether a user's CAB view covers an account (plan §3.9 scope): own-location
 * roles (a studio's cashier or manager) see their location's till and petty
 * cash only; Head Office and all-scope roles see every account.
 */
export function canSeeAccount(can: CanAt, account: Pick<CashBankAccountRow, "locationId"> | undefined): boolean {
  return !!account && can("cab.app.view", accountScopeLocation(account))
}

/** A transfer shows to whoever sees either side of it (a till deposit shows to the studio and to HQ). */
export function canSeeTransfer(
  can: CanAt,
  accounts: Map<Id, Pick<CashBankAccountRow, "locationId">>,
  transfer: { fromAccountId: Id; toAccountId: Id }
): boolean {
  return canSeeAccount(can, accounts.get(transfer.fromAccountId)) || canSeeAccount(can, accounts.get(transfer.toAccountId))
}

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
