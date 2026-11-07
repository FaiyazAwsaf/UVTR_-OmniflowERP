import { z } from "zod"

import { fiscalYearTag } from "@/config/brand.config"
import { requireApproval } from "@/core/approvals/approvals"
import type { AccountRow, AccountTag, AccountType, Id, JournalRow, RecurringJournalRow } from "@/core/db/schema"
import { getSetting } from "@/core/db/settings"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { CHART } from "@/core/ledger/chart"
import { postJournal, reverseJournal as reverseLedgerJournal, templateToLines } from "@/core/ledger/post"
import { compact, linesForRecurring, totals } from "@/core/ledger/rules"

import { buildCloseChecklist, closeReaderFromTx, recurringStatus } from "./close"
import { checkManualLines, draftTotals, HQ_LOCATION_ID, postManualVoucher } from "./posting"
import { closeAllowed, MANUAL_VOUCHER_TYPES } from "./types"

/**
 * FA Core Accounting commands (plan §6.2), each guarded by a key from the
 * catalogue (plan §3.9). Manual vouchers post R24 (within the preparer's
 * `journal` limit, else a queued approval); reversals R26; recurring R25.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const draftLine = z.object({
  account: z.string().min(1),
  debitP: z.number().int().min(0),
  creditP: z.number().int().min(0),
  partyId: z.string().optional(),
  costCentreId: z.string().optional(),
  description: z.string().max(200).optional(),
})

/* ================================================================== *
 * Manual vouchers
 * ================================================================== */

/**
 * `fa.saveJournal`: create or edit a draft manual voucher. Lines are kept in
 * `journals.draftLines` (no ledger lines until it posts); the voucher gets
 * its number at creation (nextDocNo of its type), so maker and approver
 * talk about the same number. A draft may be unbalanced; submitting checks.
 */
export const saveJournal = defineCommand({
  name: "fa.saveJournal",
  permission: "fa.journal.create",
  input: z.object({
    journalId: z.string().optional(),
    expectedVersion: z.number().int().optional(),
    voucherType: z.enum(MANUAL_VOUCHER_TYPES),
    date: isoDate,
    narration: z.string().trim().min(1).max(300),
    lines: z.array(draftLine).min(1).max(40),
  }),
  async run(tx: Tx, input) {
    const fiscal = await tx.fiscal(input.date)
    if (!fiscal.period) tx.reject("NO_PERIOD", { date: input.date })
    if (fiscal.period.status !== "open" || fiscal.year?.status === "closed") {
      tx.reject("PERIOD_CLOSED", { period: fiscal.period.code, date: input.date }, { audit: true })
    }
    const lines = await checkManualLines(tx, input.lines)
    const totalP = totals(lines).debitP

    if (!input.journalId) {
      const journalNo = await nextDocNo(tx, input.voucherType, { date: input.date })
      const journal = tx.insert("journals", {
        journalNo,
        voucherType: input.voucherType,
        date: input.date,
        periodId: fiscal.period.id,
        narration: input.narration,
        status: "draft",
        totalP,
        rule: "R24",
        preparedBy: tx.actor.userId,
        draftLines: lines,
      })
      return { journalId: journal.id, journalNo, version: journal.version }
    }

    const current = await tx.get("journals", input.journalId, { expectedVersion: input.expectedVersion })
    if (current.status !== "draft") tx.reject("JOURNAL_NOT_DRAFT", { no: current.journalNo })
    if (current.preparedBy !== tx.actor.userId) tx.reject("NOT_PREPARER", { no: current.journalNo }, { audit: true })
    // A new type or fiscal year means a new number in that series.
    const renumber = current.voucherType !== input.voucherType || fiscalYearTag(current.date) !== fiscalYearTag(input.date)
    const journalNo = renumber ? await nextDocNo(tx, input.voucherType, { date: input.date }) : current.journalNo
    const journal = await tx.update("journals", current.id, {
      journalNo,
      voucherType: input.voucherType,
      date: input.date,
      periodId: fiscal.period.id,
      narration: input.narration,
      totalP,
      draftLines: lines,
    })
    return { journalId: journal.id, journalNo, version: journal.version }
  },
})

/**
 * `fa.submitJournal`: the preparer submits a balanced draft. Within their
 * `journal` limit it posts at once (R24, reusing the draft's row and number);
 * above it the voucher waits for an approver (queued, plan §3.7).
 */
export const submitJournal = defineCommand({
  name: "fa.submitJournal",
  permission: "fa.journal.create",
  input: z.object({
    journalId: z.string(),
    expectedVersion: z.number().int(),
    idempotencyKey: z.string().min(1),
    reason: z.string().max(300).optional(),
  }),
  async run(tx: Tx, input) {
    const journal = await tx.get("journals", input.journalId, { expectedVersion: input.expectedVersion })
    if (journal.status !== "draft") tx.reject("JOURNAL_NOT_DRAFT", { no: journal.journalNo })
    if (journal.preparedBy !== tx.actor.userId) tx.reject("NOT_PREPARER", { no: journal.journalNo }, { audit: true })
    const fiscal = await tx.fiscal(journal.date)
    if (!fiscal.period) tx.reject("NO_PERIOD", { date: journal.date })
    if (fiscal.period.status !== "open" || fiscal.year?.status === "closed") {
      tx.reject("PERIOD_CLOSED", { period: fiscal.period.code, date: journal.date }, { audit: true })
    }
    // Accounts may have changed since the draft was saved.
    const lines = await checkManualLines(tx, journal.draftLines ?? [])
    const sum = totals(compact(templateToLines(lines)))
    if (sum.debitP <= 0) tx.reject("JOURNAL_EMPTY")
    if (sum.debitP !== sum.creditP) {
      tx.reject("JOURNAL_UNBALANCED", { debitP: sum.debitP, creditP: sum.creditP, debit: sum.debitP, credit: sum.creditP })
    }
    const fresh = await tx.update("journals", journal.id, { draftLines: lines, totalP: sum.debitP })

    const outcome = await requireApproval(tx, {
      kind: "journal",
      docType: "journals",
      docId: journal.id,
      docNo: journal.journalNo,
      locationId: HQ_LOCATION_ID,
      amountP: sum.debitP,
      reason: input.reason?.trim() || journal.narration,
    })
    if (outcome.status === "pending") {
      await tx.update("journals", journal.id, { status: "pending-approval", approvalId: outcome.approvalId })
      tx.emit("JournalSubmitted", {
        refs: { journalId: journal.id, approvalId: outcome.approvalId },
        params: { no: journal.journalNo, amount: Math.round(sum.debitP / 100) },
      })
      return { status: "pending-approval" as const, journalNo: journal.journalNo, approvalId: outcome.approvalId }
    }
    const approvalId = outcome.status === "approved" ? outcome.approvalId : undefined
    const posted = await postManualVoucher(tx, fresh, { approvalId })
    return { status: "posted" as const, journalNo: posted.journalNo, approvalId }
  },
})

/**
 * `fa.discardJournal`: takes a draft (or a voucher still waiting for
 * approval, whose approval is then cancelled) out of use. Nothing posts; the
 * row stays, marked discarded, with its number.
 */
export const discardJournal = defineCommand({
  name: "fa.discardJournal",
  permission: "fa.journal.create",
  input: z.object({
    journalId: z.string(),
    expectedVersion: z.number().int(),
    reason: z.string().max(300).optional(),
  }),
  async run(tx: Tx, input) {
    const journal = await tx.get("journals", input.journalId, { expectedVersion: input.expectedVersion })
    if (journal.status !== "draft" && journal.status !== "pending-approval") {
      tx.reject("JOURNAL_NOT_DRAFT", { no: journal.journalNo })
    }
    if (journal.status === "pending-approval" && journal.approvalId) {
      const approval = await tx.find("approvals", journal.approvalId)
      if (approval?.status === "pending") {
        // Withdrawn with the voucher, not decided: no decider (INV-07).
        await tx.update("approvals", approval.id, {
          status: "cancelled",
          decidedAt: tx.now(),
          decisionReason: input.reason?.trim() || "Voucher discarded",
        })
      }
    }
    await tx.update("journals", journal.id, { status: "discarded" })
    if (input.reason?.trim()) tx.auditContext({ reason: input.reason.trim() })
    tx.emit("JournalDiscarded", { refs: { journalId: journal.id }, params: { no: journal.journalNo } })
    return { journalNo: journal.journalNo }
  },
})

/**
 * `fa.reverseJournal` (R26): a posted manual or recurring voucher is
 * reversed by a new voucher of the same type, debits and credits swapped,
 * linked both ways. Document vouchers are corrected by their documents.
 */
export const reverseJournal = defineCommand({
  name: "fa.reverseJournal",
  permission: "fa.journal.reverse",
  input: z.object({
    journalId: z.string(),
    expectedVersion: z.number().int(),
    date: isoDate.optional(),
    reason: z.string().trim().min(3).max(300),
    idempotencyKey: z.string().min(1),
  }),
  async run(tx: Tx, input) {
    const original = await tx.get("journals", input.journalId, { expectedVersion: input.expectedVersion })
    const reversal = await reverseLedgerJournal(tx, original.id, { date: input.date ?? tx.today(), reason: input.reason })
    tx.emit("JournalReversed", {
      refs: { journalId: original.id },
      params: { no: original.journalNo, reversal: reversal.journalNo },
    })
    return { journalId: reversal.id, journalNo: reversal.journalNo }
  },
})

/* ================================================================== *
 * Periods
 * ================================================================== */

/**
 * `fa.closePeriod`: closes a month that has ended, in order, when its
 * checklist has no blocking item (accounting_rules.md §7). INV-02 then
 * refuses any posting dated in it (PERIOD_CLOSED); INV-13 re-checks drafts
 * and pending approvals inside the commit.
 */
export const closePeriod = defineCommand({
  name: "fa.closePeriod",
  permission: "fa.period.close",
  input: z.object({ periodId: z.string(), expectedVersion: z.number().int() }),
  async run(tx: Tx, input) {
    const period = await tx.get("periods", input.periodId, { expectedVersion: input.expectedVersion })
    if (period.status === "closed") tx.reject("PERIOD_ALREADY_CLOSED", { period: period.code })
    if (period.endsOn >= tx.today()) tx.reject("PERIOD_NOT_ENDED", { period: period.code, date: period.endsOn })
    const earlierOpen = (await tx.all("periods")).filter((p) => p.startsOn < period.startsOn && p.status === "open")
    if (earlierOpen.length) tx.reject("PERIOD_ORDER", { period: period.code })

    const checklist = await buildCloseChecklist(closeReaderFromTx(tx), period)
    if (!closeAllowed(checklist)) {
      const count = (key: string) => checklist.find((c) => c.key === key)?.count ?? 0
      tx.reject(
        "CLOSE_BLOCKED",
        { period: period.code, journals: count("journals"), approvals: count("approvals"), recurring: count("recurring") },
        { audit: true }
      )
    }
    await tx.update("periods", period.id, {
      status: "closed",
      closedBy: tx.actor.userId,
      closedAt: tx.now(),
      closeChecklist: checklist.map(({ key, blocking, ok, count }) => ({ key, blocking, ok, count })),
      reopenReason: undefined,
    })
    tx.emit("PeriodClosed", { refs: { periodId: period.id }, params: { period: period.code } })
    return { period: period.code }
  },
})

/** `fa.reopenPeriod`: reopens the latest closed month of an open fiscal year, with a reason. */
export const reopenPeriod = defineCommand({
  name: "fa.reopenPeriod",
  permission: "fa.period.reopen",
  input: z.object({
    periodId: z.string(),
    expectedVersion: z.number().int(),
    reason: z.string().trim().min(3).max(300),
  }),
  async run(tx: Tx, input) {
    const period = await tx.get("periods", input.periodId, { expectedVersion: input.expectedVersion })
    if (period.status !== "closed") tx.reject("PERIOD_NOT_CLOSED", { period: period.code })
    const year = await tx.find("fiscalYears", period.fiscalYearId)
    if (year?.status === "closed") tx.reject("YEAR_CLOSED", { year: year.code }, { audit: true })
    const laterClosed = (await tx.all("periods")).filter((p) => p.startsOn > period.startsOn && p.status === "closed")
    if (laterClosed.length) tx.reject("REOPEN_ORDER", { period: period.code })
    await tx.update("periods", period.id, {
      status: "open",
      closedBy: undefined,
      closedAt: undefined,
      reopenReason: input.reason,
    })
    tx.auditContext({ reason: input.reason })
    tx.emit("PeriodReopened", { refs: { periodId: period.id }, params: { period: period.code } })
    return { period: period.code }
  },
})

/* ================================================================== *
 * Recurring journals (R25)
 * ================================================================== */

/** The lines a template posts for a period (prepaid amortisation never takes the balance below zero). */
async function recurringLines(tx: Tx, template: RecurringJournalRow, prepaidLeftP?: number) {
  const lines = templateToLines(template.lines)
  if (template.kind !== "prepaid-amortisation" || prepaidLeftP === undefined) return linesForRecurring(lines)
  const amount = Math.min(totals(lines).debitP, prepaidLeftP)
  const map = await getSetting(tx, "postingAccounts")
  return linesForRecurring(
    lines.map((l) => {
      const prepaid = l.account === "PREPAID" || l.account === map.PREPAID
      return prepaid ? { ...l, creditP: amount, debitP: 0 } : { ...l, debitP: (l.debitP ?? 0) > 0 ? amount : 0 }
    })
  )
}

/**
 * `fa.runRecurring`: posts every due recurring template (or the chosen ones)
 * for one open period, once each, dated the period's last day, without a
 * further approval (R25, FA settings own the templates).
 */
export const runRecurring = defineCommand({
  name: "fa.runRecurring",
  permission: "fa.recurring.run",
  input: z.object({
    periodId: z.string(),
    templateIds: z.array(z.string()).optional(),
    idempotencyKey: z.string().min(1),
  }),
  async run(tx: Tx, input) {
    const period = await tx.get("periods", input.periodId)
    if (period.status !== "open") tx.reject("PERIOD_CLOSED", { period: period.code, date: period.endsOn }, { audit: true })
    const reader = closeReaderFromTx(tx)
    const templates = (await tx.all("recurringJournals"))
      .filter((r) => r.active && (!input.templateIds || input.templateIds.includes(r.id)))
      .sort((a, b) => a.code.localeCompare(b.code))
    const posted: { templateId: Id; journalId: Id; journalNo: string }[] = []
    for (const template of templates) {
      const status = await recurringStatus(reader, period, template)
      if (!status.due) continue
      const journal = await postJournal(tx, {
        voucherType: "JV",
        date: period.endsOn,
        source: { app: "fa", docType: "recurringJournals", docId: template.id, docNo: template.code },
        narration: `${template.nameEn}, ${period.month}`,
        lines: await recurringLines(tx, template, status.prepaidLeftP),
        rule: "R25",
        recurringId: template.id,
      })
      posted.push({ templateId: template.id, journalId: journal.id, journalNo: journal.journalNo })
      const last = template.lastPostedPeriodId ? await tx.find("periods", template.lastPostedPeriodId) : undefined
      if (!last || last.startsOn < period.startsOn) {
        await tx.update("recurringJournals", template.id, { lastPostedPeriodId: period.id })
      }
    }
    if (!posted.length) tx.reject("NOTHING_TO_POST", { period: period.code })
    tx.emit("RecurringPosted", {
      refs: { periodId: period.id, journalId: posted[0].journalId },
      params: { period: period.code, count: posted.length },
    })
    return { period: period.code, posted }
  },
})

/* ================================================================== *
 * Chart of accounts and settings
 * ================================================================== */

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const

/** Every tag of the chart (a tag names the account a posting rule uses). */
const TAGS = new Set<string>(CHART.flatMap((c) => (c.tag ? [c.tag] : [])))

async function hasPostings(tx: Tx, accountId: Id): Promise<boolean> {
  return (await tx.db.journalLines.where("accountId").equals(accountId).limit(1).count()) > 0
}

/**
 * `fa.saveAccount`: create, edit or deactivate an account. Codes and tags
 * stay unique; a parent is a group of the same type; an account that has
 * postings keeps its type and stays postable; an account a posting tag maps
 * to, or one still carrying a balance, can't be deactivated.
 */
export const saveAccount = defineCommand({
  name: "fa.saveAccount",
  permission: "fa.account.edit",
  input: z.object({
    accountId: z.string().optional(),
    expectedVersion: z.number().int().optional(),
    code: z.string().trim().regex(/^\d{4}$/),
    nameEn: z.string().trim().min(2).max(80),
    nameBn: z.string().trim().min(2).max(80),
    type: z.enum(ACCOUNT_TYPES),
    parentId: z.string().optional(),
    isGroup: z.boolean(),
    normalSide: z.enum(["debit", "credit"]).optional(),
    tag: z.string().optional(),
    active: z.boolean(),
  }),
  async run(tx: Tx, input) {
    const all = await tx.all("accounts")
    const current = input.accountId
      ? await tx.get("accounts", input.accountId, { expectedVersion: input.expectedVersion })
      : undefined
    const others = all.filter((a) => a.id !== current?.id)
    if (others.some((a) => a.code === input.code)) tx.reject("ACCOUNT_CODE_TAKEN", { code: input.code })
    const tag = input.tag?.trim() || undefined
    if (tag) {
      if (!TAGS.has(tag)) tx.reject("UNKNOWN_TAG", { tag })
      if (others.some((a) => a.tag === tag)) tx.reject("ACCOUNT_TAG_TAKEN", { tag })
    }
    let parent: AccountRow | undefined
    if (input.parentId) {
      parent = all.find((a) => a.id === input.parentId)
      if (!parent || !parent.isGroup || parent.type !== input.type || parent.id === current?.id) {
        tx.reject("ACCOUNT_PARENT", { code: input.code })
      }
    }
    const normalSide =
      input.normalSide ?? (input.type === "asset" || input.type === "expense" ? "debit" : "credit")

    if (!current) {
      const row = tx.insert("accounts", {
        code: input.code,
        nameEn: input.nameEn,
        nameBn: input.nameBn,
        type: input.type as AccountType,
        parentId: parent?.id,
        isGroup: input.isGroup,
        normalSide,
        tag: tag as AccountTag | undefined,
        // Control accounts are the posting rules' own; new accounts never are.
        isControl: false,
        active: input.active,
      })
      return { accountId: row.id }
    }

    const posted = await hasPostings(tx, current.id)
    if (posted && (current.type !== input.type || (!current.isGroup && input.isGroup))) {
      tx.reject("ACCOUNT_HAS_POSTINGS", { code: current.code })
    }
    if (current.tag && current.tag !== tag) tx.reject("ACCOUNT_TAG_FIXED", { tag: current.tag })
    if (current.isGroup && !input.isGroup && all.some((a) => a.parentId === current.id)) {
      tx.reject("ACCOUNT_HAS_CHILDREN", { code: current.code })
    }
    if (current.active && !input.active) {
      const map = await getSetting(tx, "postingAccounts")
      const mapped = Object.entries(map).find(([, id]) => id === current.id)
      if (mapped) tx.reject("ACCOUNT_MAPPED", { code: current.code, tag: mapped[0] })
      if (all.some((a) => a.parentId === current.id && a.active)) tx.reject("ACCOUNT_HAS_CHILDREN", { code: current.code })
      const lines = await tx.list("journalLines", "accountId", current.id)
      const balance = lines.reduce((s, l) => s + l.debitP - l.creditP, 0)
      if (balance !== 0) tx.reject("ACCOUNT_HAS_BALANCE", { code: current.code, balanceP: balance })
    }
    await tx.update("accounts", current.id, {
      code: input.code,
      nameEn: input.nameEn,
      nameBn: input.nameBn,
      type: input.type as AccountType,
      parentId: parent?.id,
      isGroup: input.isGroup,
      normalSide,
      tag: tag as AccountTag | undefined,
      active: input.active,
    })
    return { accountId: current.id }
  },
})

const percent = z.number().min(0).max(100)

const taxSettings = z.object({
  vatRates: z.object({
    standard: percent,
    "reduced-10": percent,
    "reduced-7.5": percent,
    "reduced-5": percent,
    exempt: percent,
  }),
  withholding: z.object({
    goods: z.object({ aitPct: percent, vds: z.boolean() }),
    services: z.object({ aitPct: percent, vds: z.boolean() }),
    rent: z.object({ aitPct: percent, vds: z.boolean() }),
    professional: z.object({ aitPct: percent, vds: z.boolean() }),
    utility: z.object({ aitPct: percent, vds: z.boolean() }),
    exempt: z.object({ aitPct: percent, vds: z.boolean() }),
  }),
  customerDeductions: z.object({ vdsPctOfVat: percent, aitPct: percent }),
  thresholdsEnabled: z.boolean(),
})

/**
 * `fa.saveSettings` (FA settings, `fa.settings.configure`): the posting
 * account map per tag, cost centres, and the tax rates and withholding table
 * (demo values). A tag maps only to an active, postable account of the same
 * type, and control tags only to control accounts (INV-03 stays meaningful).
 */
export const saveSettings = defineCommand({
  name: "fa.saveSettings",
  permission: "fa.settings.configure",
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("postingMap"),
      map: z.record(z.string(), z.string()),
      expectedVersion: z.number().int().optional(),
    }),
    z.object({
      kind: z.literal("tax"),
      tax: taxSettings,
      expectedVersion: z.number().int().optional(),
    }),
    z.object({
      kind: z.literal("costCentre"),
      costCentreId: z.string().optional(),
      expectedVersion: z.number().int().optional(),
      code: z.string().trim().regex(/^CC-[A-Z0-9]{2,6}$/),
      nameEn: z.string().trim().min(2).max(80),
      nameBn: z.string().trim().min(2).max(80),
      locationId: z.string().optional(),
    }),
  ]),
  async run(tx: Tx, input) {
    if (input.kind === "postingMap") {
      const row = await tx.get("settings", "postingAccounts", { expectedVersion: input.expectedVersion })
      const current = row.value as Record<AccountTag, Id>
      const next: Record<string, Id> = { ...current }
      for (const [tag, accountId] of Object.entries(input.map)) {
        if (!TAGS.has(tag)) tx.reject("UNKNOWN_TAG", { tag })
        const account = await tx.find("accounts", accountId)
        if (!account || !account.active || account.isGroup) tx.reject("ACCOUNT_INACTIVE", { account: accountId })
        const was = await tx.find("accounts", current[tag as AccountTag])
        if (was && was.type !== account.type) tx.reject("MAP_TYPE_MISMATCH", { tag, account: account.code })
        if (was && was.isControl !== account.isControl) tx.reject("MAP_CONTROL_MISMATCH", { tag, account: account.code })
        next[tag] = account.id
      }
      await tx.update("settings", "postingAccounts", { value: next })
      return { kind: input.kind }
    }
    if (input.kind === "tax") {
      const row = await tx.find("settings", "tax")
      if (row) await tx.update("settings", "tax", { value: input.tax }, { expectedVersion: input.expectedVersion })
      else tx.insert("settings", { id: "tax", value: input.tax })
      return { kind: input.kind }
    }
    const centres = await tx.all("costCentres")
    if (centres.some((c) => c.code === input.code && c.id !== input.costCentreId)) {
      tx.reject("COST_CENTRE_CODE_TAKEN", { code: input.code })
    }
    if (input.locationId && !(await tx.find("locations", input.locationId))) tx.reject("COST_CENTRE_UNKNOWN")
    const fields = { code: input.code, nameEn: input.nameEn, nameBn: input.nameBn, locationId: input.locationId || undefined }
    if (input.costCentreId) {
      await tx.update("costCentres", input.costCentreId, fields, { expectedVersion: input.expectedVersion })
      return { kind: input.kind, costCentreId: input.costCentreId }
    }
    const row = tx.insert("costCentres", fields)
    return { kind: input.kind, costCentreId: row.id }
  },
})

/** Every FA command (tests and the scenario runner look them up here). */
export const FA_COMMANDS = {
  saveJournal,
  submitJournal,
  discardJournal,
  reverseJournal,
  closePeriod,
  reopenPeriod,
  runRecurring,
  saveAccount,
  saveSettings,
}

/** Draft totals for screens (re-exported so pages import one module). */
export { draftTotals }
export type { JournalRow }
