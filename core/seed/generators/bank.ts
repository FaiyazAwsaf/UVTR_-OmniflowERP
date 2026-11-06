import type { AccountTag, StatementLine } from "@/core/db/schema"
import { CHART, accountIdOf } from "@/core/ledger/chart"
import { linesForYearEndClosing, type YearBalance } from "@/core/ledger/rules"

import { CBA, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { addMonthsISO, dhakaAt, firstOfMonth, isoAddDays, lastOfMonth } from "../time"
import { statementId } from "./tax"

/**
 * Reconciled bank statements for every closed month (seed_data.md §7.1, E7):
 * BRAC and Dutch-Bangla, every book line on the account matched (the ৳575
 * charge matched to its R23 voucher), imported and completed early in the
 * next month by Mahbub. Last month's statement is not imported (E7's
 * launcher does it). Line ids follow core/connectors/bank.ts (`bl_<line id>`).
 */
export function seedBankStatements(w: World): void {
  const { bag } = w.ctx
  for (const [bank, accountId, tag, code] of [
    ["brac", CBA.BRAC, "BANK_MAIN", "BANKBRAC"],
    ["dbbl", CBA.DBBL, "BANK_COLLECTION", "BANKDBBL"],
  ] as [("brac" | "dbbl"), string, AccountTag, string][]) {
    const lines = w.ledger.lines.filter((l) => l.tag === tag).sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.row.createdAt - b.row.createdAt))
    let opening = 0
    let i = 0
    for (let m = firstOfMonth(w.cal.F); m < w.cal.lastMonthStart; m = addMonthsISO(m, 1)) {
      const end = lastOfMonth(m)
      while (i < lines.length && lines[i].row.date < m) {
        opening += lines[i].row.debitP - lines[i].row.creditP
        i += 1
      }
      const out: StatementLine[] = []
      let closing = opening
      for (let j = i; j < lines.length && lines[j].row.date <= end; j++) {
        const l = lines[j]
        const amount = l.row.debitP - l.row.creditP
        closing += amount
        const line: StatementLine = {
          lineId: `bl_${l.row.id}`,
          date: l.row.date,
          description: "",
          ref: "",
          amountP: amount,
          matchedJournalLineIds: [l.row.id],
          matchedBy: l.journal.rule === "R23" ? "charge" : "auto",
        }
        out.push(line)
        l.row.reconciledStatementLineId = line.lineId
        const journal = l.journal
        w.fix(() => {
          line.description = journal.narration
          line.ref = journal.source?.docNo || journal.journalNo
        })
      }
      const imported = dhakaAt(isoAddDays(end, 4), "10:00")
      bag.put("bankStatements", statementId(bank, m.slice(0, 7)), imported, {
        cashBankAccountId: accountId,
        fromDate: m,
        toDate: end,
        fileName: `${code}_${m}_${end}.csv`,
        importedAt: imported,
        status: "reconciled",
        openingBalanceP: opening,
        closingBalanceP: closing,
        lines: out,
        reconciledAt: imported + 3 * 3_600_000,
        reconciledBy: USR.mahbub,
      }, USR.mahbub)
    }
  }
}

/**
 * Year-end close (R1b) when the history crosses a fiscal year end and every
 * month of the earlier year is closed (today in August or later): income and
 * expense balances of the year, per location, to retained earnings on 30 June.
 */
export function seedYearEnd(w: World): void {
  const years = w.ctx.bag.all("fiscalYears").filter((y) => y.status === "closed" && y.endsOn < w.cal.fyStart && y.startsOn >= w.cal.F)
  const types = new Map(CHART.filter((c) => !c.group).map((c) => [accountIdOf(c.code), c.type]))
  for (const year of years) {
    const sums = new Map<string, YearBalance>()
    for (const l of w.ledger.lines) {
      if (l.row.date < year.startsOn || l.row.date > year.endsOn) continue
      const type = types.get(l.row.accountId)
      if (type !== "income" && type !== "expense") continue
      const k = `${l.row.accountId}|${l.row.locationId ?? ""}`
      const b = sums.get(k) ?? { account: l.row.accountId, type, balanceP: 0, locationId: l.row.locationId }
      b.balanceP += l.row.debitP - l.row.creditP
      sums.set(k, b)
    }
    w.ledger.post({
      rule: "R1b",
      date: year.endsOn,
      at: dhakaAt(year.endsOn, "23:50"),
      lines: linesForYearEndClosing([...sums.values()].filter((b) => b.balanceP !== 0)),
      narration: `Year-end closing, fiscal year ${year.code}`,
      preparedBy: USR.farzana,
    })
  }
}
