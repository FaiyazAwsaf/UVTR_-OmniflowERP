import type { DatasetLoaders, DatasetRow } from "@/core/reports/types"

import { accountBook, KIND_ORDER } from "./queries"

/**
 * CAB report dataset loaders (implementation_plan.md §3.19.1), keyed by
 * dataset code (fields registered in core/reports/datasets.ts).
 */
export const cabDatasetLoaders: DatasetLoaders = {
  /** Cash and bank book lines with a running balance per account (params: from, to, accountId, kind). */
  "cab.bookLines": async (db, params) => {
    const accounts = (await db.cashBankAccounts.toArray())
      .filter((a) => a.active && (!params.accountId || a.id === params.accountId) && (!params.kind || a.kind === params.kind))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.code.localeCompare(b.code))
    const rows: DatasetRow[] = []
    for (const account of accounts) {
      const book = await accountBook(db, account, params.from, params.to)
      for (const r of book.rows) {
        rows.push({
          account: account.nameEn,
          accountHref: `/cab/accounts/${account.id}`,
          accountKind: account.kind,
          date: r.line.date,
          reference: r.ref,
          referenceHref: r.journal ? `/fa/journals/${r.journal.id}` : undefined,
          receivedP: r.receivedP,
          paidP: r.paidP,
          runningP: r.runningP,
        })
      }
    }
    return rows
  },
  /** The cheque register: received and issued cheques. */
  "cab.cheques": async (db, params) => {
    const cheques = (await db.cheques.toArray()).filter(
      (c) => (!params.from || c.chequeDate >= params.from) && (!params.to || c.chequeDate <= params.to)
    )
    const parties = new Map((await db.parties.bulkGet([...new Set(cheques.map((c) => c.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return cheques
      .sort((a, b) => (a.chequeDate < b.chequeDate ? -1 : a.chequeDate > b.chequeDate ? 1 : a.chequeNo.localeCompare(b.chequeNo)))
      .map((c) => ({
        direction: c.direction,
        party: parties.get(c.partyId)?.nameEn ?? c.partyId,
        partyHref: `/par/${c.partyId}`,
        chequeNo: c.chequeNo,
        chequeHref: `/cab/cheques?id=${c.id}`,
        amountP: c.amountP,
        chequeDate: c.chequeDate,
        status: c.status,
        invoiceHref: c.receiptId ? `/ar/receipts?id=${c.receiptId}` : undefined,
        billHref: c.paymentId ? `/ap/payments/${c.paymentId}` : undefined,
      }))
  },
}
