import { z } from "zod"

import { evatSubmissionRef, treasuryChallanRef } from "@/core/connectors/nbr"
import type { AccountTag, Id } from "@/core/db/schema"
import { getSetting } from "@/core/db/settings"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForTaxDeposit, RULE_VOUCHER, vatSettlement } from "@/core/ledger/rules"

import { depositDue, previousMonth, tagLines, vatMonthFigures, type VatMonth } from "./vat"

/**
 * FRS commands (plan §6.2): the simulated e-VAT submission of the monthly
 * return (Mushak 9.1, R27a) and treasury deposits of net VAT, VDS and AIT
 * (R27b), each with a simulated NBR reference.
 */

const month = z.string().regex(/^\d{4}-\d{2}$/)

/** The month's figures from the ledger, inside the commit (same maths as the screens and the seed). */
async function monthFigures(tx: Tx, forMonth: string): Promise<VatMonth> {
  const map = await getSetting(tx, "postingAccounts")
  const tagOf = new Map<Id, AccountTag>()
  for (const [tag, id] of Object.entries(map)) tagOf.set(id, tag as AccountTag)
  const ids = ["VAT_OUTPUT", "VAT_CURRENT", "VDS_PAYABLE", "AIT_PAYABLE"].map((t) => map[t as AccountTag])
  const lines = (await Promise.all(ids.map((id) => tx.list("journalLines", "accountId", id))))
    .flat()
    .filter((l) => l.date.slice(0, 7) === forMonth)
  const journals = new Map<Id, { rule: string }>()
  for (const journalId of new Set(lines.map((l) => l.journalId))) {
    const j = await tx.find("journals", journalId)
    if (j) journals.set(j.id, j)
  }
  const prev = (await tx.list("vatReturns", "month", previousMonth(forMonth)))[0]
  return vatMonthFigures(tagLines(lines, journals, tagOf), forMonth, prev?.carryForwardP ?? 0)
}

/** Refuses a month that has not ended yet (returns and deposits are for whole months). */
function requireEnded(tx: Tx, forMonth: string) {
  if (forMonth >= tx.today().slice(0, 7)) tx.reject("MONTH_NOT_ENDED", { month: forMonth })
}

/**
 * `frs.submitVatReturn`: the Mushak 9.1 return for a month, submitted to the
 * simulated NBR e-VAT service. Writes `vatReturns` with the NBR reference
 * and posts the settlement (R27a): Dr VAT payable, Cr VAT current account
 * for min(output, credits); what is left on output VAT is the net payable,
 * what is left of the credits carries forward. Months go in order.
 */
export const submitVatReturn = defineCommand({
  name: "frs.submitVatReturn",
  permission: "frs.vat.submit",
  input: z.object({ month, idempotencyKey: z.string().min(1) }),
  async run(tx: Tx, input) {
    requireEnded(tx, input.month)
    if ((await tx.list("vatReturns", "month", input.month)).length) {
      tx.reject("VAT_ALREADY_SUBMITTED", { month: input.month })
    }
    const period = (await tx.list("periods", "month", input.month))[0]
    if (!period) tx.reject("NO_PERIOD", { date: `${input.month}-01` })
    // The previous month's return comes first, unless the books start this month.
    const prevMonth = previousMonth(input.month)
    const prevPeriod = (await tx.list("periods", "month", prevMonth))[0]
    if (prevPeriod && !(await tx.list("vatReturns", "month", prevMonth)).length) {
      tx.reject("VAT_PREVIOUS_MONTH", { month: prevMonth })
    }

    const f = await monthFigures(tx, input.month)
    const settlement = vatSettlement({ outputVatP: f.outputVatP, creditsP: f.creditsP })
    const nbrRef = evatSubmissionRef(input.month, tx.commitId)
    const row = tx.insert("vatReturns", {
      periodId: period.id,
      month: input.month,
      outputVatP: f.outputVatP,
      inputVatP: f.inputVatP,
      vdsCreditP: f.vdsCreditP,
      carryInP: f.carryInP,
      netPayableP: settlement.netPayableP,
      carryForwardP: settlement.carryForwardP,
      status: "submitted",
      nbrRef,
      submittedBy: tx.actor.userId,
      submittedAt: tx.now(),
      journalId: "",
    })
    let journalNo: string | undefined
    if (settlement.lines.length) {
      const journal = await postJournal(tx, {
        voucherType: RULE_VOUCHER.R27a,
        date: tx.today(),
        source: { app: "frs", docType: "vatReturns", docId: row.id, docNo: nbrRef },
        narration: `VAT return (Mushak 9.1) settlement for ${input.month}`,
        lines: settlement.lines,
        rule: "R27a",
      })
      await tx.update("vatReturns", row.id, { journalId: journal.id })
      journalNo = journal.journalNo
    }
    tx.emit("VatReturnSubmitted", {
      refs: { vatReturnId: row.id, periodId: period.id },
      params: { month: input.month, ref: nbrRef },
    })
    return { vatReturnId: row.id, nbrRef, netPayableP: settlement.netPayableP, journalNo }
  },
})

/**
 * `frs.payTax`: a treasury deposit (simulated challan) of a month's net VAT
 * (after its return is submitted), or of the VDS or AIT withheld from
 * vendors in that month (R27b: Dr the payable, Cr the bank). The amount is
 * what is still due; each kind and month is paid in full once.
 */
export const payTax = defineCommand({
  name: "frs.payTax",
  permission: "frs.tax.pay",
  input: z.object({
    kind: z.enum(["vat", "vds", "ait"]),
    forMonth: month,
    cashBankAccountId: z.string(),
    idempotencyKey: z.string().min(1),
  }),
  async run(tx: Tx, input) {
    requireEnded(tx, input.forMonth)
    const bank = await tx.get("cashBankAccounts", input.cashBankAccountId)
    if (bank.kind !== "bank" || !bank.active) tx.reject("TAX_BANK_ONLY", { account: bank.code })
    const vatReturn = (await tx.list("vatReturns", "month", input.forMonth))[0]
    if (input.kind === "vat" && !vatReturn) tx.reject("VAT_RETURN_MISSING", { month: input.forMonth })
    const deposits = await tx.list("taxDeposits", "forMonth", input.forMonth)
    const due = depositDue(input.kind, input.forMonth, await monthFigures(tx, input.forMonth), vatReturn, deposits)
    if (due.leftP <= 0) tx.reject("NOTHING_DUE", { month: input.forMonth, kind: input.kind.toUpperCase() })

    const date = tx.today()
    const depositNo = await nextDocNo(tx, "TXD", { date })
    const challanRef = treasuryChallanRef(input.kind, input.forMonth, tx.commitId)
    const row = tx.insert("taxDeposits", {
      depositNo,
      forMonth: input.forMonth,
      kind: input.kind,
      amountP: due.leftP,
      cashBankAccountId: bank.id,
      challanRef,
      date,
      journalId: "",
    })
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R27b,
      date,
      source: { app: "frs", docType: "taxDeposits", docId: row.id, docNo: depositNo },
      narration: `Treasury deposit ${depositNo}: ${input.kind.toUpperCase()} for ${input.forMonth}`,
      lines: linesForTaxDeposit({ kind: input.kind, amountP: due.leftP, bankTag: bank.accountTag }),
      rule: "R27b",
    })
    await tx.update("taxDeposits", row.id, { journalId: journal.id })
    tx.emit("TaxPaid", {
      refs: { taxDepositId: row.id, journalId: journal.id },
      params: { no: depositNo, kind: input.kind.toUpperCase(), month: input.forMonth, amount: Math.round(due.leftP / 100) },
    })
    return { taxDepositId: row.id, depositNo, challanRef, amountP: due.leftP, journalNo: journal.journalNo }
  },
})

export const FRS_COMMANDS = { submitVatReturn, payTax }
