import { getSetting } from "@/core/db/settings"
import type {
  AccountRow,
  AccountTag,
  ISODate,
  Id,
  JournalRow,
  JournalSource,
  JournalStatus,
  TemplateLine,
  VoucherType,
} from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import type { Tx } from "@/core/engine/types"

import { CHART } from "./chart"
import { compact, totals, type LineInput, type RuleCode } from "./rules"

const TAGS = new Set<string>(CHART.flatMap((c) => (c.tag ? [c.tag] : [])))

export function isAccountTag(value: string): value is AccountTag {
  return TAGS.has(value)
}

/**
 * Resolve a system tag to its account id through the posting map in
 * `settings.postingAccounts` (FA settings may remap a tag). Refuses
 * UNKNOWN_TAG when a tag has no mapping.
 */
export async function acct(tx: Tx, tag: AccountTag): Promise<Id> {
  const map = await getSetting(tx, "postingAccounts")
  const id = map[tag]
  if (!id) tx.reject("UNKNOWN_TAG", { tag })
  return id
}

/** An account by tag or id (tags first). */
export async function resolveAccount(tx: Tx, account: AccountTag | Id): Promise<AccountRow> {
  const id = isAccountTag(account) ? await acct(tx, account) : account
  return tx.get("accounts", id)
}

export type PostJournalInput = {
  /** Defaults to the rule's voucher type */
  voucherType: VoucherType
  date: ISODate
  /** The source document (absent for manual vouchers) */
  source?: JournalSource
  narration: string
  lines: LineInput[]
  /** Posting rule that built the lines (R6, R24, ...) */
  rule: RuleCode
  /** Who prepared it (defaults to the actor; approvals keep the maker) */
  preparedBy?: Id
  approvalId?: Id
  recurringId?: Id
  /** Reuse a draft's row (manual vouchers posted after approval) */
  journalId?: Id
}

/** Location to cost centre (lines carrying a location get its cost centre). */
async function costCentreOf(tx: Tx, locationId: Id | undefined, cache: Map<Id, Id | undefined>): Promise<Id | undefined> {
  if (!locationId) return undefined
  if (!cache.has(locationId)) cache.set(locationId, (await tx.find("locations", locationId))?.costCentreId)
  return cache.get(locationId)
}

/**
 * Post a balanced journal in the current commit (plan §3.4): resolves tags,
 * drops zero lines, checks the balance and the period, numbers the voucher
 * (<TYPE>-<FY>-<6>), and writes `journals` plus `journalLines`. The engine's
 * invariants (INV-01 to INV-04) check the result again before commit.
 * Callers store the returned id on their document (`journalId`).
 */
export async function postJournal(tx: Tx, input: PostJournalInput): Promise<JournalRow> {
  const lines = compact(input.lines)
  const sum = totals(lines)
  if (lines.some((l) => (l.debitP ?? 0) > 0 && (l.creditP ?? 0) > 0)) tx.reject("JOURNAL_LINE_BOTH")
  if (sum.debitP <= 0) tx.reject("JOURNAL_EMPTY")
  if (sum.debitP !== sum.creditP) {
    tx.reject("JOURNAL_UNBALANCED", { debitP: sum.debitP, creditP: sum.creditP, debit: sum.debitP, credit: sum.creditP })
  }

  const fiscal = await tx.fiscal(input.date)
  if (!fiscal.period) tx.reject("NO_PERIOD", { date: input.date })
  if (fiscal.period.status !== "open" || fiscal.year?.status === "closed") {
    tx.reject("PERIOD_CLOSED", { period: fiscal.period.code, date: input.date }, { audit: true })
  }

  const journalNo = await nextDocNo(tx, input.voucherType, { date: input.date })
  const now = tx.now()
  const fields = {
    journalNo,
    voucherType: input.voucherType,
    date: input.date,
    periodId: fiscal.period.id,
    source: input.source,
    narration: input.narration,
    status: "posted" as JournalStatus,
    totalP: sum.debitP,
    rule: input.rule,
    approvalId: input.approvalId,
    preparedBy: input.preparedBy ?? tx.actor.userId,
    postedBy: tx.actor.userId,
    postedAt: now,
    recurringId: input.recurringId,
    draftLines: undefined,
  }
  const journal = input.journalId
    ? await tx.update("journals", input.journalId, fields)
    : tx.insert("journals", fields)

  const centres = new Map<Id, Id | undefined>()
  let lineNo = 0
  for (const line of lines) {
    const account = await resolveAccount(tx, line.account)
    lineNo += 1
    tx.insert("journalLines", {
      journalId: journal.id,
      lineNo,
      accountId: account.id,
      debitP: line.debitP ?? 0,
      creditP: line.creditP ?? 0,
      partyId: line.partyId,
      costCentreId: line.costCentreId ?? (await costCentreOf(tx, line.locationId, centres)),
      locationId: line.locationId,
      itemId: line.itemId,
      description: line.description,
      date: input.date,
      periodId: fiscal.period.id,
      voucherType: input.voucherType,
    })
  }
  return journal
}

/**
 * R26: reverse a posted voucher with a new voucher of the same type, debits
 * and credits swapped, linked both ways; the original becomes `reversed`.
 * Only vouchers without a source document (manual, recurring) are reversed;
 * document corrections are credit notes, debit notes or adjustments.
 */
export async function reverseJournal(
  tx: Tx,
  journalId: Id,
  opts: { date: ISODate; reason: string }
): Promise<JournalRow> {
  const original = await tx.get("journals", journalId)
  if (original.status !== "posted") tx.reject("JOURNAL_NOT_POSTED", { no: original.journalNo })
  if (original.source && original.source.docType !== "recurringJournals") {
    tx.reject("REVERSE_SOURCE_DOCUMENT", { no: original.journalNo, doc: original.source.docNo })
  }
  const lines = await tx.list("journalLines", "journalId", original.id)
  const swapped: LineInput[] = lines
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => ({
      account: l.accountId,
      debitP: l.creditP,
      creditP: l.debitP,
      partyId: l.partyId,
      costCentreId: l.costCentreId,
      locationId: l.locationId,
      itemId: l.itemId,
      description: l.description,
    }))
  const reversal = await postJournal(tx, {
    voucherType: original.voucherType,
    date: opts.date,
    source: { app: "fa", docType: "journals", docId: original.id, docNo: original.journalNo },
    narration: `Reversal of ${original.journalNo}: ${opts.reason}`,
    lines: swapped,
    rule: "R26",
  })
  await tx.update("journals", reversal.id, { reversalOfId: original.id })
  await tx.update("journals", original.id, { status: "reversed", reversedById: reversal.id })
  tx.auditContext({ reason: opts.reason })
  return reversal
}

/** Template lines (manual voucher drafts, recurring templates) as rule lines. */
export function templateToLines(lines: TemplateLine[]): LineInput[] {
  return lines.map((l) => ({
    account: l.account,
    debitP: l.debitP,
    creditP: l.creditP,
    partyId: l.partyId,
    costCentreId: l.costCentreId,
    locationId: l.locationId,
    description: l.description,
  }))
}
