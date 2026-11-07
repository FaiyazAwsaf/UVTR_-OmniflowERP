import { docHref } from "@/components/shared/doc-routes"
import { locations } from "@/config/brand.config"
import type { OmniflowDb } from "@/core/db/database"
import type { DatasetLoaders, DatasetParams, DatasetRow } from "@/core/reports/types"

/**
 * FA report dataset loaders (implementation_plan.md §3.19.1), keyed by
 * dataset code. Fields are registered in core/reports/datasets.ts.
 *
 * - fa.journalLines: one row per posted ledger line, with links to its
 *   voucher (`journalHref`) and to the source document (`sourceHref`), so
 *   every IRT figure drills down to the voucher and its document.
 * - fa.accountBalances: one row per postable account and period in range:
 *   opening, debits, credits, closing (debit positive).
 */

const locationCode = (id: string | undefined) => (id ? (locations.find((l) => l.id === id)?.code ?? id) : "")

async function linesInRange(db: OmniflowDb, params: DatasetParams) {
  const to = params.to ?? "9999-12-31"
  const from = params.from ?? "0000-01-01"
  const lines = await db.journalLines.where("date").between(from, to, true, true).toArray()
  return params.locationId ? lines.filter((l) => l.locationId === params.locationId) : lines
}

export const faDatasetLoaders: DatasetLoaders = {
  async "fa.journalLines"(db, params) {
    const lines = await linesInRange(db, params)
    const [accounts, periods, centres] = await Promise.all([
      db.accounts.toArray(),
      db.periods.toArray(),
      db.costCentres.toArray(),
    ])
    const journals = new Map(
      (await db.journals.bulkGet([...new Set(lines.map((l) => l.journalId))])).filter(Boolean).map((j) => [j!.id, j!])
    )
    const parties = new Map(
      (await db.parties.bulkGet([...new Set(lines.flatMap((l) => (l.partyId ? [l.partyId] : [])))]))
        .filter(Boolean)
        .map((p) => [p!.id, p!])
    )
    const accountOf = new Map(accounts.map((a) => [a.id, a]))
    const periodOf = new Map(periods.map((p) => [p.id, p]))
    const centreOf = new Map(centres.map((c) => [c.id, c]))
    const rows: DatasetRow[] = []
    for (const l of lines.sort((a, b) => a.date.localeCompare(b.date) || a.journalId.localeCompare(b.journalId) || a.lineNo - b.lineNo)) {
      const journal = journals.get(l.journalId)
      const account = accountOf.get(l.accountId)
      const source = journal?.source && journal.source.docType !== "journals" ? journal.source : undefined
      rows.push({
        date: l.date,
        period: periodOf.get(l.periodId)?.code ?? "",
        voucherType: l.voucherType,
        journalNo: journal?.journalNo ?? "",
        journalHref: `/fa/journals/${l.journalId}`,
        accountCode: account?.code ?? "",
        accountName: account?.nameEn ?? "",
        accountType: account?.type ?? "",
        party: l.partyId ? (parties.get(l.partyId)?.nameEn ?? "") : "",
        location: locationCode(l.locationId),
        costCentre: l.costCentreId ? (centreOf.get(l.costCentreId)?.code ?? "") : "",
        debitP: l.debitP,
        creditP: l.creditP,
        sourceApp: source?.app.toUpperCase() ?? "",
        sourceDocNo: source?.docNo ?? "",
        sourceHref: source ? (docHref(source.docType, source.docId) ?? "") : "",
      })
    }
    return rows
  },

  async "fa.accountBalances"(db, params) {
    const to = params.to ?? "9999-12-31"
    const from = params.from ?? "0000-01-01"
    const all = await db.journalLines.where("date").belowOrEqual(to).toArray()
    const lines = params.locationId ? all.filter((l) => l.locationId === params.locationId) : all
    const [accounts, periods] = await Promise.all([db.accounts.orderBy("code").toArray(), db.periods.orderBy("startsOn").toArray()])
    const inRange = periods.filter((p) => p.endsOn >= from && p.startsOn <= to)
    const rows: DatasetRow[] = []
    for (const account of accounts) {
      if (account.isGroup) continue
      const own = lines.filter((l) => l.accountId === account.id)
      for (const period of inRange) {
        let openingP = 0
        let debitP = 0
        let creditP = 0
        for (const l of own) {
          if (l.date < period.startsOn) openingP += l.debitP - l.creditP
          else if (l.date <= period.endsOn) {
            debitP += l.debitP
            creditP += l.creditP
          }
        }
        if (!openingP && !debitP && !creditP) continue
        rows.push({
          accountCode: account.code,
          accountName: account.nameEn,
          accountType: account.type,
          period: period.code,
          openingP,
          debitP,
          creditP,
          closingP: openingP + debitP - creditP,
        })
      }
    }
    return rows
  },
}
