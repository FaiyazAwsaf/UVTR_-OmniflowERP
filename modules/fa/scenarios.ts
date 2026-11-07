import { decideApproval } from "@/core/approvals/decide"
import type { OmniflowDb } from "@/core/db/database"
import type { Id } from "@/core/db/schema"
import { readSetting } from "@/core/db/settings"
import { lastMonth, previousRuns } from "@/core/scenarios/helpers"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { resolveSecurity } from "@/core/security/resolve"
import { CBA, CC, USR } from "@/core/seed/content/seed-refs"
import { formatDate, formatDmy } from "@/lib/i18n/format"
import { pettyCashVoucher, topUpPettyCash } from "@/modules/cab/commands"

import { discardJournal, reopenPeriod, saveJournal, submitJournal } from "./commands"

/**
 * FA scenario launchers (implementation_plan.md §10): E10 maker-checker on a
 * journal voucher and E11 month-end close. Every setup runs real commands as
 * the story's users, creates fresh vouchers each run and clears what an
 * earlier run of the same launcher left unfinished (re-run rules), so each
 * launcher works any number of times in a row.
 */

/** E10: Mahbub's accrual (above his ৳50,000 journal limit) and Farzana's own voucher (above her ৳10,00,000). */
export const E10_ACCRUAL_P = 1_20_000_00
export const E10_BIG_P = 12_00_000_00
/** E11: Mahbub's draft dated last month and Sabbir's petty cash at Uttara (above his ৳1,000). */
export const E11_DRAFT_P = 6_500_00
export const E11_PETTY_P = 2_500_00

const SUPERSEDED = (id: string) => `Superseded by a new ${id} demo run`

/** A user's approval limit of a kind, as poisha for the cue (0 when unlimited or none). */
async function limitOf(db: OmniflowDb, userId: Id, kind: "journal" | "petty-cash"): Promise<number> {
  const limit = (await resolveSecurity(db, userId)).limits[kind] ?? 0
  return Number.isFinite(limit) ? limit : 0
}

/** Discards an earlier run's voucher when it is still a draft or waiting for approval. */
async function discardIfOpen(kit: ScenarioKit, journalId: Id | undefined, as: string): Promise<void> {
  if (!journalId) return
  const journal = await kit.db.journals.get(journalId)
  if (!journal || (journal.status !== "draft" && journal.status !== "pending-approval")) return
  await kit.run(discardJournal, { journalId, expectedVersion: journal.version, reason: SUPERSEDED(kit.scenarioId) }, as)
}

const e10: ScenarioDef = {
  id: "E10",
  kind: "scenario",
  module: "fa",
  titleKey: "fa.scenarios.E10.title",
  summaryKey: "fa.scenarios.E10.summary",
  user: "mahbub",
  async setup(kit) {
    const { db } = kit
    // Re-run: an earlier run's vouchers that are still open (Mahbub's draft
    // or pending accrual, Farzana's pending voucher) are discarded, so the
    // inboxes show exactly this run's.
    for (const run of await previousRuns(db, "E10")) {
      await discardIfOpen(kit, run.refs.journalId, "mahbub")
      const approval = run.refs.approvalId ? await db.approvals.get(run.refs.approvalId) : undefined
      if (approval?.docType === "journals") await discardIfOpen(kit, approval.docId, "farzana")
    }

    const today = kit.today()
    const accrual = await kit.run(
      saveJournal,
      {
        voucherType: "JV",
        date: today,
        narration: "Electricity and water accrual, Gulshan and Uttara",
        lines: [
          { account: "UTILITIES", debitP: 70_000_00, creditP: 0, costCentreId: CC.GUL, description: "Gulshan Studio" },
          { account: "UTILITIES", debitP: 50_000_00, creditP: 0, costCentreId: CC.UTT, description: "Uttara Studio" },
          { account: "ACCRUED_EXP", debitP: 0, creditP: E10_ACCRUAL_P },
        ],
      },
      "mahbub"
    )

    // Farzana's own voucher, above her journal limit: it waits for Rashed.
    const big = await kit.run(
      saveJournal,
      {
        voucherType: "JV",
        date: today,
        narration: "Uttara second detailing bay fit-out completed, contractor's bill to follow",
        lines: [
          { account: "FITOUT", debitP: E10_BIG_P, creditP: 0, costCentreId: CC.UTT },
          { account: "ACCRUED_EXP", debitP: 0, creditP: E10_BIG_P },
        ],
      },
      "farzana"
    )
    const submitted = await kit.run(
      submitJournal,
      { journalId: big.journalId, expectedVersion: big.version, idempotencyKey: `${kit.runId}-big` },
      "farzana"
    )
    if (submitted.status !== "pending-approval" || !submitted.approvalId) {
      throw new Error(`E10: ${submitted.journalNo} posted at once; Farzana's journal limit covers it`)
    }

    return {
      refs: { journalId: accrual.journalId, approvalId: submitted.approvalId },
      params: {
        accrualNo: accrual.journalNo,
        accrualP: E10_ACCRUAL_P,
        limitP: await limitOf(db, USR.mahbub, "journal"),
        bigNo: submitted.journalNo,
        bigP: E10_BIG_P,
        bigLimitP: await limitOf(db, USR.farzana, "journal"),
        bigRoute: `/fa/journals/${big.journalId}`,
      },
    }
  },
  route: (outcome) => `/fa/journals/${outcome.refs?.journalId ?? ""}`,
  cueKeys: [
    "fa.scenarios.E10.cue.submit",
    "fa.scenarios.E10.cue.pending",
    "fa.scenarios.E10.cue.farzanaApproves",
    "fa.scenarios.E10.cue.ownVoucher",
    "fa.scenarios.E10.cue.rashedApproves",
  ],
}

const e11: ScenarioDef = {
  id: "E11",
  kind: "scenario",
  module: "fa",
  titleKey: "fa.scenarios.E11.title",
  summaryKey: "fa.scenarios.E11.summary",
  user: "farzana",
  async setup(kit) {
    const { db } = kit
    const { month, lastDay } = lastMonth(kit.today())
    const period = await db.periods.where("month").equals(month).first()
    if (!period) throw new Error(`E11: no period for ${month}`)

    // Last month open: an earlier run (or the presenter) closed it.
    if (period.status === "closed") {
      await kit.run(
        reopenPeriod,
        { periodId: period.id, expectedVersion: period.version, reason: "Month-end close demo run again (E11)" },
        "farzana"
      )
    }

    // Re-run: what earlier E11 runs left unfinished goes, so the checklist
    // names exactly this run's two blockers.
    for (const run of await previousRuns(db, "E11")) {
      await discardIfOpen(kit, run.refs.journalId, "mahbub")
      const voucher = run.refs.pettyCashVoucherId ? await db.pettyCashVouchers.get(run.refs.pettyCashVoucherId) : undefined
      const approval = voucher?.status === "pending-approval" && voucher.approvalId ? await db.approvals.get(voucher.approvalId) : undefined
      if (approval?.status === "pending") {
        await kit.run(
          decideApproval,
          { approvalId: approval.id, decision: "reject", reason: SUPERSEDED("E11"), expectedVersion: approval.version },
          "farzana"
        )
      }
    }

    // Uttara's petty cash must cover the voucher when the presenter approves it.
    const pettyAccount = (await readSetting(db, "postingAccounts")).PETTY_UTT
    const pettyLines = await db.journalLines.where("accountId").equals(pettyAccount).toArray()
    const pettyBalanceP = pettyLines.reduce((sum, l) => sum + l.debitP - l.creditP, 0)
    if (pettyBalanceP < E11_PETTY_P * 2) {
      await kit.run(
        topUpPettyCash,
        { pettyAccountId: CBA.PETTY_UTT, fromAccountId: CBA.BRAC, idempotencyKey: `${kit.runId}-topup` },
        "mahbub"
      )
    }

    const draft = await kit.run(
      saveJournal,
      {
        voucherType: "JV",
        date: lastDay,
        narration: `Internet and telephone accrual, ${month}`,
        lines: [
          { account: "TELECOM", debitP: E11_DRAFT_P, creditP: 0, costCentreId: CC.HQ },
          { account: "ACCRUED_EXP", debitP: 0, creditP: E11_DRAFT_P },
        ],
      },
      "mahbub"
    )
    const petty = await kit.run(
      pettyCashVoucher,
      {
        cashBankAccountId: CBA.PETTY_UTT,
        date: lastDay,
        expenseTag: "REPAIRS",
        amountP: E11_PETTY_P,
        payee: "Uttara Hardware Store",
        description: "Pressure washer hose and nozzle",
        idempotencyKey: `${kit.runId}-petty`,
      },
      "sabbir"
    )
    if (petty.status !== "pending-approval") {
      throw new Error(`E11: ${petty.voucherNo} posted at once; Sabbir's petty cash limit covers it`)
    }

    const monthAt = `${month}-15T12:00:00+06:00`
    const lastDayAt = `${lastDay}T12:00:00+06:00`
    return {
      refs: { periodId: period.id, journalId: draft.journalId, pettyCashVoucherId: petty.voucherId, approvalId: petty.approvalId },
      params: {
        month: formatDate(monthAt, "en", { month: "long", year: "numeric" }),
        monthBn: formatDate(monthAt, "bn", { month: "long", year: "numeric" }),
        lastDay: formatDmy(lastDayAt, "en"),
        lastDayBn: formatDmy(lastDayAt, "bn"),
        draftNo: draft.journalNo,
        draftP: E11_DRAFT_P,
        pettyNo: petty.voucherNo,
        pettyP: E11_PETTY_P,
        pettyLimitP: await limitOf(db, USR.sabbir, "petty-cash"),
      },
    }
  },
  route: (outcome) => `/fa/periods?id=${outcome.refs?.periodId ?? ""}`,
  cueKeys: [
    "fa.scenarios.E11.cue.closeBlocked",
    "fa.scenarios.E11.cue.discardDraft",
    "fa.scenarios.E11.cue.approvePetty",
    "fa.scenarios.E11.cue.close",
    "fa.scenarios.E11.cue.refused",
  ],
}

/** FA scenario launchers (implementation_plan.md §10). */
export const faScenarios: ScenarioDef[] = [e10, e11]
