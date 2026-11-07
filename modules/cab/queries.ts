import type { OmniflowDb } from "@/core/db/database"
import type { CashBankAccountRow, ISODate, JournalLineRow, JournalRow, Poisha } from "@/core/db/schema"

import { accountIdOfTag } from "@/modules/ar/queries"

/**
 * CAB read-side queries: the cash and bank book of an account with its
 * running balance, and the cash position across tills, petty cash, banks,
 * wallets and card clearing (balances straight from the GL).
 */

export type BookRow = {
  line: JournalLineRow
  journal: JournalRow | undefined
  /** Source document number, else the voucher number */
  ref: string
  receivedP: Poisha
  paidP: Poisha
  runningP: Poisha
}

export type AccountBook = { openingP: Poisha; rows: BookRow[]; closingP: Poisha }

const byDateThenNo = (a: JournalLineRow, b: JournalLineRow) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt || a.lineNo - b.lineNo

/** The account's GL lines from `from` to `to` with a running balance (opening = everything before `from`). */
export async function accountBook(db: OmniflowDb, account: CashBankAccountRow, from?: ISODate, to?: ISODate): Promise<AccountBook> {
  const glId = await accountIdOfTag(db, account.accountTag)
  if (!glId) return { openingP: 0, rows: [], closingP: 0 }
  const lines = (await db.journalLines.where("accountId").equals(glId).toArray()).sort(byDateThenNo)
  let running = 0
  let openingP = 0
  const shown: JournalLineRow[] = []
  for (const l of lines) {
    if (from && l.date < from) {
      openingP += l.debitP - l.creditP
      continue
    }
    if (to && l.date > to) continue
    shown.push(l)
  }
  running = openingP
  const journals = new Map((await db.journals.bulkGet([...new Set(shown.map((l) => l.journalId))])).filter(Boolean).map((j) => [j!.id, j!]))
  const rows = shown.map((line) => {
    running += line.debitP - line.creditP
    const journal = journals.get(line.journalId)
    return {
      line,
      journal,
      ref: journal?.source?.docNo || journal?.journalNo || "",
      receivedP: line.debitP,
      paidP: line.creditP,
      runningP: running,
    }
  })
  return { openingP, rows, closingP: running }
}

export type PositionRow = {
  account: CashBankAccountRow
  /** Balance at the start of today */
  openingP: Poisha
  inP: Poisha
  outP: Poisha
  balanceP: Poisha
}

/** Balance per cash and bank account, with today's money in and out (daily cash position). */
export async function cashPosition(db: OmniflowDb, today: ISODate): Promise<PositionRow[]> {
  const accounts = (await db.cashBankAccounts.toArray()).filter((a) => a.active)
  const out: PositionRow[] = []
  for (const account of accounts) {
    const glId = await accountIdOfTag(db, account.accountTag)
    const lines = glId ? await db.journalLines.where("accountId").equals(glId).toArray() : []
    let openingP = 0
    let inP = 0
    let outP = 0
    for (const l of lines) {
      if (l.date < today) openingP += l.debitP - l.creditP
      else if (l.date === today) {
        inP += l.debitP
        outP += l.creditP
      }
    }
    out.push({ account, openingP, inP, outP, balanceP: openingP + inP - outP })
  }
  return out
}

export const KIND_ORDER: CashBankAccountRow["kind"][] = ["cash-till", "petty-cash", "bank", "mfs", "card-clearing"]
