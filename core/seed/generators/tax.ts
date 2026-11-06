import { MONTHLY_BANK_CHARGE_P } from "@/core/connectors/bank"
import type { Id } from "@/core/db/schema"
import { linesForBankCharge, linesForTaxDeposit, vatSettlement } from "@/core/ledger/rules"

import { CBA, LOC, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { periodIdOf } from "./org"
import { addMonthsISO, dhakaAt, firstOfMonth, isoAddDays, lastOfMonth } from "../time"

/**
 * Bank charges and tax (seed_data.md §7.1, R23, R27a, R27b). Each closed
 * month's BRAC and Dutch-Bangla files carry a ৳575 maintenance and SMS
 * charge, posted from the reconciliation. For every month before last
 * month the VAT return is submitted on the 15th of the next month and the
 * net VAT, VDS and AIT deposited the same day; June's opening liabilities
 * are deposited on 15 July. Last month's return is left for the demo.
 */

export const statementId = (bank: "brac" | "dbbl", month: string) => `bst_${bank}_${month.replace("-", "")}`

export function seedBankCharges(w: World): void {
  for (let m = firstOfMonth(w.cal.F); m < w.cal.lastMonthStart; m = addMonthsISO(m, 1)) {
    const end = lastOfMonth(m)
    for (const [bank, tag] of [["brac", "BANK_MAIN"], ["dbbl", "BANK_COLLECTION"]] as const) {
      const sid = statementId(bank, m.slice(0, 7))
      w.ledger.post({
        rule: "R23",
        date: end,
        at: dhakaAt(end, "23:30"),
        lines: linesForBankCharge({ bankTag: tag, amountP: MONTHLY_BANK_CHARGE_P, locationId: LOC.HQ }),
        narration: "Account maintenance and SMS charge (bank statement)",
        source: { app: "cab", docType: "bankStatements", docId: sid, docNo: () => `${bank === "brac" ? "BANKBRAC" : "BANKDBBL"}_${m}_${end}` },
        preparedBy: USR.mahbub,
      })
    }
  }
}

function sumLines(w: World, tag: string, month: string, rules: string[] | null, side: "debit" | "credit", exclude: string[] = []): number {
  let sum = 0
  for (const l of w.ledger.lines) {
    if (l.tag !== tag || l.row.date.slice(0, 7) !== month) continue
    if (exclude.includes(l.journal.rule)) continue
    if (rules && !rules.includes(l.journal.rule)) continue
    sum += side === "debit" ? l.row.debitP - l.row.creditP : l.row.creditP - l.row.debitP
  }
  return sum
}

export function seedTax(w: World): void {
  const { bag } = w.ctx
  const rng = w.rng("tax")
  const deposit = (kind: "vat" | "vds" | "ait", forMonth: string, amountP: number, date: string) => {
    if (amountP <= 0) return
    const at = dhakaAt(date, kind === "vat" ? "12:00" : kind === "vds" ? "12:10" : "12:20")
    const id = w.ctx.seq("txd")
    const row = bag.put("taxDeposits", id, at, {
      depositNo: "",
      forMonth,
      kind,
      amountP,
      cashBankAccountId: CBA.BRAC,
      challanRef: `TR/${date.replace(/-/g, "")}/${rng.int(100000, 999999)}`,
      date,
      journalId: "",
    }, USR.farzana)
    w.number("TXD", { date }, at, (no) => {
      row.depositNo = no
    })
    const journal = w.ledger.post({
      rule: "R27b",
      date,
      at,
      lines: linesForTaxDeposit({ kind, amountP, bankTag: "BANK_MAIN" }),
      narration: () => `Treasury deposit ${row.depositNo}: ${kind.toUpperCase()} for ${forMonth}`,
      source: { app: "frs", docType: "taxDeposits", docId: id, docNo: () => row.depositNo },
      preparedBy: USR.farzana,
    })
    row.journalId = journal.id
  }

  // June's opening liabilities, deposited on 15 July.
  const june = addMonthsISO(w.cal.F, -1).slice(0, 7)
  const julyDay = isoAddDays(w.cal.F, 14)
  deposit("vat", june, 1_85_000_00, julyDay)
  deposit("vds", june, 12_000_00, julyDay)
  deposit("ait", june, 21_000_00, julyDay)

  let carry = 0
  for (let m = firstOfMonth(w.cal.F); m < w.cal.lastMonthStart; m = addMonthsISO(m, 1)) {
    const month = m.slice(0, 7)
    const day = isoAddDays(addMonthsISO(m, 1), 14)
    const output = sumLines(w, "VAT_OUTPUT", month, null, "credit", ["R1a", "R27a", "R27b"])
    const input = sumLines(w, "VAT_CURRENT", month, ["R2b", "R13", "R14", "R16"], "debit")
    const vds = sumLines(w, "VAT_CURRENT", month, ["R8", "R10"], "debit")
    const vdsWithheld = sumLines(w, "VDS_PAYABLE", month, ["R15"], "credit")
    const aitWithheld = sumLines(w, "AIT_PAYABLE", month, ["R15"], "credit")
    const s = vatSettlement({ outputVatP: output, creditsP: input + vds + carry })
    const at = dhakaAt(day, "11:00")
    const id: Id = w.ctx.seq("vat")
    let journalId = ""
    if (s.lines.length) {
      journalId = w.ledger.post({
        rule: "R27a",
        date: day,
        at,
        lines: s.lines,
        narration: `VAT return (Mushak 9.1) settlement for ${month}`,
        source: { app: "frs", docType: "vatReturns", docId: id, docNo: () => `9.1/${month}` },
        preparedBy: USR.farzana,
      }).id
    }
    bag.put("vatReturns", id, at, {
      periodId: periodIdOf(month),
      month,
      outputVatP: output,
      inputVatP: input,
      vdsCreditP: vds,
      carryInP: carry,
      netPayableP: s.netPayableP,
      carryForwardP: s.carryForwardP,
      status: "submitted",
      nbrRef: `NBR-9.1-${month.replace("-", "")}-${rng.int(100000, 999999)}`,
      submittedBy: USR.farzana,
      submittedAt: at,
      journalId,
    }, USR.farzana)
    carry = s.carryForwardP
    deposit("vat", month, s.netPayableP, day)
    deposit("vds", month, vdsWithheld, day)
    deposit("ait", month, aitWithheld, day)
  }
}
