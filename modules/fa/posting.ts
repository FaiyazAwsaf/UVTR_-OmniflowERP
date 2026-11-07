import { getLocation } from "@/config/brand.config"
import type { Id, JournalRow, TemplateLine } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import { acct, isAccountTag, postJournal, templateToLines } from "@/core/ledger/post"
import { compact, linesForManualVoucher, totals } from "@/core/ledger/rules"

/**
 * Shared by the FA commands and the journal approval handler: checking a
 * manual voucher's lines and posting it exactly the same way whether the
 * maker posts within limit or an approver releases it (plan §3.7).
 */

/** Manual vouchers are approved against Head Office (accounting approvers hold scope "all"). */
export const HQ_LOCATION_ID: Id = getLocation("HQ").id

/**
 * Checks manual voucher lines (R24): every account active, postable and never
 * a control account (INV-03); a line carries one side only; parties and cost
 * centres exist. Returns the lines with each cost centre's location filled
 * in, so P&L by studio sees manual postings at the right location.
 */
export async function checkManualLines(tx: Tx, lines: TemplateLine[]): Promise<TemplateLine[]> {
  const out: TemplateLine[] = []
  for (const line of lines) {
    if (line.debitP < 0 || line.creditP < 0) tx.reject("JOURNAL_LINE_BOTH")
    if (line.debitP > 0 && line.creditP > 0) tx.reject("JOURNAL_LINE_BOTH")
    const accountId = isAccountTag(line.account) ? await acct(tx, line.account) : line.account
    const account = await tx.find("accounts", accountId)
    if (!account) tx.reject("ACCOUNT_INACTIVE", { account: line.account })
    const label = `${account.code} ${account.nameEn}`
    if (!account.active) tx.reject("ACCOUNT_INACTIVE", { account: label })
    if (account.isGroup) tx.reject("ACCOUNT_GROUP", { account: label })
    if (account.isControl) tx.reject("CONTROL_ACCOUNT", { account: label }, { audit: true })
    if (line.partyId && !(await tx.find("parties", line.partyId))) tx.reject("PARTY_UNKNOWN")
    let locationId = line.locationId
    if (line.costCentreId) {
      const centre = await tx.find("costCentres", line.costCentreId)
      if (!centre) tx.reject("COST_CENTRE_UNKNOWN")
      locationId = centre.locationId ?? locationId
    }
    out.push({
      account: account.id,
      debitP: line.debitP,
      creditP: line.creditP,
      partyId: line.partyId || undefined,
      costCentreId: line.costCentreId || undefined,
      locationId: locationId || undefined,
      description: line.description?.trim() || undefined,
    })
  }
  return out
}

/** Debit and credit totals of draft lines (zero lines ignored). */
export function draftTotals(lines: TemplateLine[] | undefined): { debitP: number; creditP: number } {
  return totals(compact(templateToLines(lines ?? [])))
}

/**
 * Posts a draft or pending manual voucher (R24) on its own row: lines from
 * `draftLines`, the original preparer kept, the number given at creation
 * kept. Emits JournalPosted.
 */
export async function postManualVoucher(
  tx: Tx,
  journal: JournalRow,
  opts: { approvalId?: Id } = {}
): Promise<JournalRow> {
  const lines = linesForManualVoucher(templateToLines(journal.draftLines ?? []))
  const posted = await postJournal(tx, {
    voucherType: journal.voucherType,
    date: journal.date,
    narration: journal.narration,
    lines,
    rule: "R24",
    preparedBy: journal.preparedBy,
    approvalId: opts.approvalId ?? journal.approvalId,
    journalId: journal.id,
  })
  // postJournal numbers every voucher it posts; a manual voucher keeps the
  // number it was given as a draft (the one its maker and approver saw).
  const final =
    posted.journalNo === journal.journalNo
      ? posted
      : await tx.update("journals", journal.id, { journalNo: journal.journalNo })
  tx.emit("JournalPosted", {
    refs: { journalId: journal.id, ...(opts.approvalId ? { approvalId: opts.approvalId } : {}) },
    params: { no: final.journalNo, amount: Math.round(final.totalP / 100) },
  })
  return final
}
