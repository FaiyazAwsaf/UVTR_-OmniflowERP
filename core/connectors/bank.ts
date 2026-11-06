import type { OmniflowDb } from "@/core/db/database"
import type { ISODate, Id, Poisha, StatementLine } from "@/core/db/schema"

/**
 * Simulated bank statement file (plan §3.17, CAB reconciliation): the bank's
 * view of a period, generated from the books (every posted line on the
 * account's GL account becomes a statement line on the same day with the
 * document number as its reference), plus planted lines the books do not
 * have yet (charges) and lines the bank dates differently (a deposit the
 * bank credited days later). Shown with the Simulated badge.
 */

export type StatementFile = {
  fileName: string
  fromDate: ISODate
  toDate: ISODate
  openingBalanceP: Poisha
  closingBalanceP: Poisha
  lines: StatementLine[]
}

export type StatementOptions = {
  cashBankAccountId: Id
  fromDate: ISODate
  toDate: ISODate
  /** Lines the books do not have (bank charges, interest) */
  extra?: { date: ISODate; description: string; ref: string; amountP: Poisha }[]
  /** Book lines the bank dates differently (journal line id to the bank's date) */
  redate?: Record<Id, ISODate>
  /** Book lines the bank does not show in this period */
  omit?: Id[]
}

export async function generateStatement(db: OmniflowDb, opts: StatementOptions): Promise<StatementFile> {
  const account = await db.cashBankAccounts.get(opts.cashBankAccountId)
  if (!account) throw new Error(`Unknown cash or bank account ${opts.cashBankAccountId}`)
  const map = (await db.settings.get("postingAccounts"))?.value as Record<string, Id> | undefined
  const glId = map?.[account.accountTag]
  if (!glId) throw new Error(`No GL account for ${account.accountTag}`)
  const lines = await db.journalLines.where("accountId").equals(glId).toArray()
  const journals = new Map((await db.journals.bulkGet([...new Set(lines.map((l) => l.journalId))])).filter(Boolean).map((j) => [j!.id, j!]))
  const omit = new Set(opts.omit ?? [])
  let opening = 0
  const out: StatementLine[] = []
  for (const l of lines) {
    const amount = l.debitP - l.creditP
    if (l.date < opts.fromDate) {
      opening += amount
      continue
    }
    if (omit.has(l.id)) continue
    const date = opts.redate?.[l.id] ?? l.date
    if (date > opts.toDate || l.date > opts.toDate) continue
    const journal = journals.get(l.journalId)
    out.push({
      lineId: `bl_${l.id}`,
      date,
      description: journal?.narration ?? "",
      ref: journal?.source?.docNo ?? journal?.journalNo ?? "",
      amountP: amount,
      matchedJournalLineIds: [],
    })
  }
  for (const [i, e] of (opts.extra ?? []).entries()) {
    out.push({ lineId: `bx_${opts.toDate}_${i}`, date: e.date, description: e.description, ref: e.ref, amountP: e.amountP, matchedJournalLineIds: [] })
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.lineId.localeCompare(b.lineId)))
  const closing = opening + out.reduce((s, l) => s + l.amountP, 0)
  const code = account.code.replace(/[^A-Z0-9]/gi, "")
  return {
    fileName: `${code}_${opts.fromDate}_${opts.toDate}.csv`,
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    openingBalanceP: opening,
    closingBalanceP: closing,
    lines: out,
  }
}

/** The monthly maintenance and SMS charge every BRAC and Dutch-Bangla file carries (seed_data.md §7.1). */
export const MONTHLY_BANK_CHARGE_P = 575_00
