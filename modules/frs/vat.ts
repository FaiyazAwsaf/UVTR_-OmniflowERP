import type { AccountTag, Id, JournalLineRow, JournalRow, Poisha, TaxDepositRow, VatReturnRow } from "@/core/db/schema"
import { vatSettlement } from "@/core/ledger/rules"

/**
 * VAT return and withholding figures (accounting_rules.md §4), computed from
 * the ledger the same way the seed computes the history's returns
 * (core/seed/generators/tax.ts), so live and seeded months agree:
 *
 * - output VAT: net credits to VAT_OUTPUT in the month (sales and credit
 *   notes), leaving out openings, settlements and deposits;
 * - input VAT: net debits to VAT_CURRENT from purchase documents (R2b, R13,
 *   R14, R16);
 * - VDS credits: debits to VAT_CURRENT from customer receipts (R8, R10);
 * - carry-forward in: the previous month's return's carry-forward;
 * - net payable = output − (input + VDS credits + carry-in), never below zero.
 *
 * VDS and AIT withheld from vendors in a month are the R15 credits to
 * VDS_PAYABLE and AIT_PAYABLE; each is deposited with its own challan.
 */

export type VatMonth = {
  month: string
  outputVatP: Poisha
  inputVatP: Poisha
  vdsCreditP: Poisha
  carryInP: Poisha
  creditsP: Poisha
  setOffP: Poisha
  netPayableP: Poisha
  carryForwardP: Poisha
  vdsWithheldP: Poisha
  aitWithheldP: Poisha
}

/** Ledger lines with what the figures need: the account's tag and the journal's rule. */
export type TaggedLine = { tag: AccountTag | undefined; rule: string; date: string; debitP: Poisha; creditP: Poisha }

export const PURCHASE_VAT_RULES = ["R2b", "R13", "R14", "R16"]
export const CUSTOMER_VDS_RULES = ["R8", "R10"]
const OUTPUT_EXCLUDED = ["R1a", "R27a", "R27b"]

/** Ledger lines tagged with their account tag and their journal's rule. */
export function tagLines(
  lines: Pick<JournalLineRow, "accountId" | "journalId" | "date" | "debitP" | "creditP">[],
  journals: Map<Id, Pick<JournalRow, "rule">>,
  tagOf: Map<Id, AccountTag | undefined>
): TaggedLine[] {
  return lines.map((l) => ({
    tag: tagOf.get(l.accountId),
    rule: journals.get(l.journalId)?.rule ?? "",
    date: l.date,
    debitP: l.debitP,
    creditP: l.creditP,
  }))
}

/** The previous calendar month of "YYYY-MM". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

/** The month figures for a VAT return (and the withholding of that month). */
export function vatMonthFigures(lines: TaggedLine[], month: string, carryInP: Poisha): VatMonth {
  let outputVatP = 0
  let inputVatP = 0
  let vdsCreditP = 0
  let vdsWithheldP = 0
  let aitWithheldP = 0
  for (const l of lines) {
    if (l.date.slice(0, 7) !== month) continue
    if (l.tag === "VAT_OUTPUT" && !OUTPUT_EXCLUDED.includes(l.rule)) outputVatP += l.creditP - l.debitP
    else if (l.tag === "VAT_CURRENT" && PURCHASE_VAT_RULES.includes(l.rule)) inputVatP += l.debitP - l.creditP
    else if (l.tag === "VAT_CURRENT" && CUSTOMER_VDS_RULES.includes(l.rule)) vdsCreditP += l.debitP - l.creditP
    else if (l.tag === "VDS_PAYABLE" && l.rule === "R15") vdsWithheldP += l.creditP - l.debitP
    else if (l.tag === "AIT_PAYABLE" && l.rule === "R15") aitWithheldP += l.creditP - l.debitP
  }
  const creditsP = inputVatP + vdsCreditP + carryInP
  const s = vatSettlement({ outputVatP, creditsP })
  return {
    month,
    outputVatP,
    inputVatP,
    vdsCreditP,
    carryInP,
    creditsP,
    setOffP: s.setOffP,
    netPayableP: s.netPayableP,
    carryForwardP: s.carryForwardP,
    vdsWithheldP,
    aitWithheldP,
  }
}

export type TaxKind = "vat" | "vds" | "ait"

/** What a deposit for a month and kind should be: due, already deposited, left to pay. */
export function depositDue(
  kind: TaxKind,
  month: string,
  figures: VatMonth,
  vatReturn: Pick<VatReturnRow, "netPayableP"> | undefined,
  deposits: Pick<TaxDepositRow, "kind" | "forMonth" | "amountP">[]
): { dueP: Poisha; paidP: Poisha; leftP: Poisha } {
  const dueP = kind === "vat" ? (vatReturn?.netPayableP ?? 0) : kind === "vds" ? figures.vdsWithheldP : figures.aitWithheldP
  const paidP = deposits.filter((d) => d.kind === kind && d.forMonth === month).reduce((s, d) => s + d.amountP, 0)
  return { dueP, paidP, leftP: Math.max(0, dueP - paidP) }
}

/** The 15th of the month after `month` (returns and deposits are due then, accounting_rules.md §4.1). */
export function dueDateOf(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
  return `${next}-15`
}
