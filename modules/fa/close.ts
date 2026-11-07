import type { OmniflowDb } from "@/core/db/database"
import { readSetting, getSetting } from "@/core/db/settings"
import type {
  AccountTag,
  ApprovalRow,
  BankStatementRow,
  CashBankAccountRow,
  ISODate,
  Id,
  JournalLineRow,
  JournalRow,
  PeriodRow,
  RecurringJournalRow,
  VatReturnRow,
} from "@/core/db/schema"
import { TABLE_SPECS, type TableName } from "@/core/db/tables"
import type { Tx } from "@/core/engine/types"

import type { CloseCheckItem, CloseChecklistItem } from "./types"

/**
 * The period close checklist (accounting_rules.md §7), computed the same way
 * in the command (inside the commit) and on the periods screen (live):
 *
 * | check                                              | blocking    |
 * | no draft or pending-approval journals in the month | yes         |
 * | no pending approvals on documents dated in it      | yes         |
 * | recurring journals posted for the month            | yes         |
 * | bank reconciliations up to the month end           | warning     |
 * | GRNI listed                                        | information |
 * | VAT return (9.1) submitted for the month           | warning     |
 */

/** What the checklist reads, from a commit or from the live database. */
export type CloseReader = {
  journalsInPeriod(periodId: Id): Promise<JournalRow[]>
  pendingApprovals(): Promise<ApprovalRow[]>
  docDate(docType: string, docId: Id): Promise<ISODate | undefined>
  recurringTemplates(): Promise<RecurringJournalRow[]>
  journalsOfRecurring(recurringId: Id): Promise<JournalRow[]>
  accountLines(accountId: Id): Promise<JournalLineRow[]>
  postingMap(): Promise<Record<AccountTag, Id>>
  cashBankAccounts(): Promise<CashBankAccountRow[]>
  statements(): Promise<BankStatementRow[]>
  vatReturn(month: string): Promise<VatReturnRow | undefined>
}

const isTable = (name: string): name is TableName => Object.prototype.hasOwnProperty.call(TABLE_SPECS, name)

type Dated = { date?: string; orderDate?: string }

export function closeReaderFromTx(tx: Tx): CloseReader {
  return {
    journalsInPeriod: (periodId) => tx.list("journals", "periodId", periodId),
    pendingApprovals: () => tx.list("approvals", "status", "pending"),
    async docDate(docType, docId) {
      if (!isTable(docType)) return undefined
      const doc = (await tx.find(docType, docId)) as Dated | undefined
      return doc?.date ?? doc?.orderDate
    },
    recurringTemplates: () => tx.all("recurringJournals"),
    journalsOfRecurring: (id) => tx.list("journals", "recurringId", id),
    accountLines: (id) => tx.list("journalLines", "accountId", id),
    postingMap: () => getSetting(tx, "postingAccounts"),
    cashBankAccounts: () => tx.all("cashBankAccounts"),
    statements: () => tx.all("bankStatements"),
    async vatReturn(month) {
      return (await tx.list("vatReturns", "month", month))[0]
    },
  }
}

export function closeReaderFromDb(db: OmniflowDb): CloseReader {
  return {
    journalsInPeriod: (periodId) => db.journals.where("periodId").equals(periodId).toArray(),
    pendingApprovals: () => db.approvals.where("status").equals("pending").toArray(),
    async docDate(docType, docId) {
      if (!isTable(docType)) return undefined
      const doc = (await db.table(docType).get(docId)) as Dated | undefined
      return doc?.date ?? doc?.orderDate
    },
    recurringTemplates: () => db.recurringJournals.toArray(),
    journalsOfRecurring: (id) => db.journals.where("recurringId").equals(id).toArray(),
    accountLines: (id) => db.journalLines.where("accountId").equals(id).toArray(),
    postingMap: () => readSetting(db, "postingAccounts"),
    cashBankAccounts: () => db.cashBankAccounts.toArray(),
    statements: () => db.bankStatements.toArray(),
    vatReturn: (month) => db.vatReturns.where("month").equals(month).first(),
  }
}

/** Balance (debit positive) of one account's lines up to a day. */
export function balanceUpTo(lines: JournalLineRow[], day: ISODate): number {
  let sum = 0
  for (const l of lines) if (l.date <= day) sum += l.debitP - l.creditP
  return sum
}

/**
 * Whether a recurring template is due for a period: active, not posted in it
 * yet (a reversed posting does not count), and for prepaid amortisation only
 * while the prepaid balance lasts.
 */
export async function recurringStatus(
  reader: CloseReader,
  period: PeriodRow,
  template: RecurringJournalRow
): Promise<{ posted: JournalRow | undefined; due: boolean; prepaidLeftP?: number }> {
  const posted = (await reader.journalsOfRecurring(template.id)).find(
    (j) => j.periodId === period.id && j.status === "posted"
  )
  if (!template.active || posted) return { posted, due: false }
  if (template.kind === "prepaid-amortisation") {
    const map = await reader.postingMap()
    const left = balanceUpTo(await reader.accountLines(map.PREPAID), period.endsOn)
    return { posted, due: left > 0, prepaidLeftP: Math.max(0, left) }
  }
  return { posted, due: true }
}

/** The checklist for a period (live screen and command alike). */
export async function buildCloseChecklist(reader: CloseReader, period: PeriodRow): Promise<CloseChecklistItem[]> {
  // 1. Draft and pending manual vouchers dated in the period.
  const open = (await reader.journalsInPeriod(period.id))
    .filter((j) => j.status === "draft" || j.status === "pending-approval")
    .sort((a, b) => a.date.localeCompare(b.date))
  const journalItems: CloseCheckItem[] = open.map((j) => ({
    docType: "journals",
    docId: j.id,
    docNo: j.journalNo,
    date: j.date,
    amountP: j.totalP,
  }))

  // 2. Pending approvals of any kind on documents dated in the period.
  const approvalItems: CloseCheckItem[] = []
  for (const a of await reader.pendingApprovals()) {
    const date = await reader.docDate(a.docType, a.docId)
    if (!date || date < period.startsOn || date > period.endsOn) continue
    // A pending manual voucher is already listed under check 1.
    if (a.docType === "journals" && open.some((j) => j.id === a.docId)) continue
    approvalItems.push({ docType: a.docType, docId: a.docId, docNo: a.docNo, date, kind: a.kind, amountP: a.amountP })
  }

  // 3. Recurring journals posted for the period.
  const recurringItems: CloseCheckItem[] = []
  for (const template of (await reader.recurringTemplates()).sort((a, b) => a.code.localeCompare(b.code))) {
    const status = await recurringStatus(reader, period, template)
    if (status.due) recurringItems.push({ docType: "recurringJournals", docId: template.id, docNo: template.code })
  }

  // 4. Bank reconciliations completed up to the period end (each bank account).
  const statements = await reader.statements()
  const bankItems: CloseCheckItem[] = []
  for (const bank of (await reader.cashBankAccounts()).filter((c) => c.kind === "bank" && c.active)) {
    const done = statements.some(
      (s) => s.cashBankAccountId === bank.id && s.status === "reconciled" && s.toDate >= period.endsOn
    )
    if (!done) bankItems.push({ docType: "cashBankAccounts", docId: bank.id, docNo: bank.code })
  }

  // 5. GRNI listed (information): the balance at the period end.
  const map = await reader.postingMap()
  const grniP = -balanceUpTo(await reader.accountLines(map.GRNI), period.endsOn)

  // 6. VAT return submitted for the month.
  const vat = await reader.vatReturn(period.month)

  return [
    { key: "journals", blocking: "yes", ok: journalItems.length === 0, count: journalItems.length, items: journalItems },
    { key: "approvals", blocking: "yes", ok: approvalItems.length === 0, count: approvalItems.length, items: approvalItems },
    { key: "recurring", blocking: "yes", ok: recurringItems.length === 0, count: recurringItems.length, items: recurringItems },
    { key: "bankRecon", blocking: "warning", ok: bankItems.length === 0, count: bankItems.length, items: bankItems },
    { key: "grni", blocking: "info", ok: true, amountP: grniP, items: [{ docType: "accounts", docId: map.GRNI, docNo: "GRNI" }] },
    {
      key: "vatReturn",
      blocking: "warning",
      ok: !!vat,
      items: vat ? [{ docType: "vatReturns", docId: vat.id, docNo: vat.nbrRef }] : [],
    },
  ]
}
