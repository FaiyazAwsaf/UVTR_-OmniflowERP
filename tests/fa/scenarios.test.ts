import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { decideApproval } from "@/core/approvals/decide"
import type { ApprovalRow, JournalRow } from "@/core/db/schema"
import { lastMonth, previousRuns } from "@/core/scenarios/helpers"
import { runScenario } from "@/core/scenarios/runner"
import type { ScenarioDef } from "@/core/scenarios/types"
import { CBA, USR } from "@/core/seed/content/seed-refs"
import { faEn } from "@/modules/fa/i18n/en"
import { faBn } from "@/modules/fa/i18n/bn"
import { buildCloseChecklist, closeReaderFromDb } from "@/modules/fa/close"
import { closePeriod, discardJournal, saveJournal, submitJournal } from "@/modules/fa/commands"
import { E10_ACCRUAL_P, E10_BIG_P, E11_DRAFT_P, E11_PETTY_P, faScenarios } from "@/modules/fa/scenarios"
import { closeAllowed } from "@/modules/fa/types"

import { booksTie, key, refusal, seededBooks, sumJournal, type Books } from "./helpers"

/**
 * The FA launchers (plan §10): E10 maker-checker and E11 month-end close on
 * the small seed. Each runs twice in a row with its key action performed
 * through the real commands as the story's users after each run; a third
 * run left unfinished is cleared by the fourth (re-run rules). The books tie
 * at the end.
 */

let b: Books
const E10 = faScenarios.find((s) => s.id === "E10") as ScenarioDef
const E11 = faScenarios.find((s) => s.id === "E11") as ScenarioDef

beforeAll(async () => {
  b = await seededBooks("fa-scenarios")
}, 180_000)
afterAll(async () => {
  await b.db.delete()
})

const journal = async (id: string) => (await b.db.journals.get(id)) as JournalRow
const approval = async (id: string) => (await b.db.approvals.get(id)) as ApprovalRow
const decide = (a: ApprovalRow, decision: "approve" | "reject", reason = "") => ({
  approvalId: a.id,
  decision,
  reason,
  expectedVersion: a.version,
})

/** Placeholders a cue string uses. */
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
const cueText = (lang: typeof faEn, path: string) =>
  path
    .split(".")
    .slice(1)
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], lang.fa) as string

describe("launcher definitions", () => {
  it("E10 and E11 have 3 to 6 cue steps in EN and BN, every placeholder filled by the setup", () => {
    const filled: Record<string, string[]> = {
      E10: ["accrualNo", "accrualP", "limitP", "bigNo", "bigP", "bigLimitP"],
      E11: ["month", "monthBn", "lastDay", "lastDayBn", "draftNo", "draftP", "pettyNo", "pettyP", "pettyLimitP"],
    }
    for (const s of [E10, E11]) {
      expect(s.cueKeys.length).toBeGreaterThanOrEqual(3)
      expect(s.cueKeys.length).toBeLessThanOrEqual(6)
      for (const k of [s.titleKey, s.summaryKey!, ...s.cueKeys]) {
        for (const lang of [faEn, faBn]) {
          const text = cueText(lang, k)
          expect(text, k).toBeTruthy()
          for (const p of placeholders(text)) expect(filled[s.id], `${k} {${p}}`).toContain(p)
        }
      }
    }
    expect(E10.user).toBe("mahbub")
    expect(E11.user).toBe("farzana")
  })
})

describe("E10 maker-checker journal", () => {
  /** One launch plus the presenter's key action, through the real commands. */
  async function launchAndPerform() {
    const launch = await runScenario(E10, b.db)
    const { refs, params } = launch.outcome
    expect(launch.route).toBe(`/fa/journals/${refs!.journalId}`)

    // Mahbub's fresh draft accrual of ৳1,20,000.
    const draft = await journal(refs!.journalId!)
    expect(draft.status).toBe("draft")
    expect(draft.preparedBy).toBe(USR.mahbub)
    expect(draft.totalP).toBe(E10_ACCRUAL_P)
    expect(draft.date).toBe(b.today)
    expect(params).toMatchObject({ accrualNo: draft.journalNo, accrualP: E10_ACCRUAL_P, limitP: 50_000_00, bigP: E10_BIG_P, bigLimitP: 10_00_000_00 })

    // Farzana's ৳12,00,000 voucher, pending for Rashed only.
    const bigApproval = await approval(refs!.approvalId!)
    expect(bigApproval.status).toBe("pending")
    expect(bigApproval.routedTo).toEqual([USR.rashed])
    const big = await journal(bigApproval.docId)
    expect(big.status).toBe("pending-approval")
    expect(big.preparedBy).toBe(USR.farzana)
    expect(big.totalP).toBe(E10_BIG_P)
    expect(params?.bigNo).toBe(big.journalNo)
    expect(params?.bigRoute).toBe(`/fa/journals/${big.id}`)

    // Mahbub submits: above his ৳50,000 it waits; he cannot approve it.
    const submitted = await b.run(submitJournal, { journalId: draft.id, expectedVersion: draft.version, idempotencyKey: key() }, "mahbub")
    expect(submitted.status).toBe("pending-approval")
    const accrualApproval = await approval(submitted.approvalId!)
    expect(new Set(accrualApproval.routedTo)).toEqual(new Set([USR.farzana, USR.rashed]))
    expect(await refusal(b.run(decideApproval, decide(accrualApproval, "approve"), "mahbub"))).toBe("SELF_APPROVAL")

    // Farzana approves it: it posts R24 on its own row and number.
    await b.run(decideApproval, decide(accrualApproval, "approve"), "farzana")
    const posted = await journal(draft.id)
    expect(posted.status).toBe("posted")
    expect(posted.journalNo).toBe(draft.journalNo)
    expect(posted.rule).toBe("R24")
    expect(posted.postedBy).toBe(USR.farzana)
    const lines = await b.db.journalLines.where("journalId").equals(draft.id).toArray()
    expect(sumJournal(lines, draft.id)).toEqual({ debitP: E10_ACCRUAL_P, creditP: E10_ACCRUAL_P })

    // Her own voucher: she cannot decide it; Rashed approves it.
    expect(await refusal(b.run(decideApproval, decide(bigApproval, "approve"), "farzana"))).toBe("SELF_APPROVAL")
    await b.run(decideApproval, decide(bigApproval, "approve"), "rashed")
    const bigPosted = await journal(big.id)
    expect(bigPosted.status).toBe("posted")
    expect(bigPosted.preparedBy).toBe(USR.farzana)
    expect(bigPosted.postedBy).toBe(USR.rashed)
    expect(sumJournal(await b.db.journalLines.where("journalId").equals(big.id).toArray(), big.id)).toEqual({
      debitP: E10_BIG_P,
      creditP: E10_BIG_P,
    })
    return { draft, big }
  }

  it("runs twice in a row with fresh vouchers, and the key action works each time", async () => {
    const first = await launchAndPerform()
    const second = await launchAndPerform()
    expect(second.draft.id).not.toBe(first.draft.id)
    expect(second.draft.journalNo).not.toBe(first.draft.journalNo)
    expect(second.big.journalNo).not.toBe(first.big.journalNo)
    expect(await previousRuns(b.db, "E10")).toHaveLength(2)
  })

  it("a re-run discards what an unfinished run left open (submitted or not)", async () => {
    const left = await runScenario(E10, b.db)
    const leftDraft = await journal(left.outcome.refs!.journalId!)
    // The presenter submitted this one but nobody approved it.
    await b.run(submitJournal, { journalId: leftDraft.id, expectedVersion: leftDraft.version, idempotencyKey: key() }, "mahbub")
    const leftBig = await approval(left.outcome.refs!.approvalId!)

    const again = await runScenario(E10, b.db)
    expect((await journal(leftDraft.id)).status).toBe("discarded")
    expect((await journal(leftBig.docId)).status).toBe("discarded")
    expect((await approval(leftBig.id)).status).toBe("cancelled")
    // Rashed's and Farzana's inboxes hold exactly this run's E10 vouchers.
    const pending = (await b.db.approvals.where("status").equals("pending").toArray()).filter((a) => a.docType === "journals")
    expect(pending.map((a) => a.id)).toEqual([again.outcome.refs!.approvalId])
    expect((await journal(again.outcome.refs!.journalId!)).status).toBe("draft")
  })

  it("leaves the books tied", async () => {
    expect((await booksTie(b.db)).balanced).toBe(true)
  })
})

describe("E11 month-end close", () => {
  const lastMonthPeriod = async () => (await b.db.periods.where("month").equals(lastMonth(b.today).month).first())!
  const checklist = async () => buildCloseChecklist(closeReaderFromDb(b.db), await lastMonthPeriod())
  const pettyBalanceP = async () => {
    const lines = await b.db.journalLines.where("accountId").equals(await b.acc("PETTY_UTT")).toArray()
    return lines.reduce((s, l) => s + l.debitP - l.creditP, 0)
  }

  /** One launch plus the presenter's key action, through the real commands. */
  async function launchAndPerform() {
    const launch = await runScenario(E11, b.db)
    const { refs, params } = launch.outcome
    const period = await lastMonthPeriod()
    expect(launch.route).toBe(`/fa/periods?id=${period.id}`)
    expect(refs?.periodId).toBe(period.id)
    expect(period.status).toBe("open")
    const last = lastMonth(b.today)

    // Exactly this run's two blockers: Mahbub's draft and Sabbir's petty cash.
    const draft = await journal(refs!.journalId!)
    expect(draft.status).toBe("draft")
    expect(draft.preparedBy).toBe(USR.mahbub)
    expect(draft.date).toBe(last.lastDay)
    const petty = (await b.db.pettyCashVouchers.get(refs!.pettyCashVoucherId!))!
    expect(petty.status).toBe("pending-approval")
    expect(petty.preparedBy).toBe(USR.sabbir)
    expect(petty.locationId).toBe("loc_utt")
    expect(petty.cashBankAccountId).toBe(CBA.PETTY_UTT)
    expect(petty.amountP).toBe(E11_PETTY_P)
    expect(petty.date).toBe(last.lastDay)
    expect(params).toMatchObject({ draftNo: draft.journalNo, draftP: E11_DRAFT_P, pettyNo: petty.voucherNo, pettyP: E11_PETTY_P, pettyLimitP: 1_000_00 })
    expect(await pettyBalanceP()).toBeGreaterThanOrEqual(E11_PETTY_P)

    const before = Object.fromEntries((await checklist()).map((c) => [c.key, c]))
    expect(before.journals.items.map((i) => i.docNo)).toEqual([draft.journalNo])
    expect(before.approvals.items.map((i) => i.docNo)).toEqual([petty.voucherNo])
    expect(before.recurring.ok).toBe(true)
    expect(closeAllowed(Object.values(before))).toBe(false)

    // Close blocked (INV-13).
    expect(await refusal(b.run(closePeriod, { periodId: period.id, expectedVersion: period.version }, "farzana"))).toBe("CLOSE_BLOCKED")

    // Discard the draft, approve the petty cash (Farzana); it posts R19 into last month.
    await b.run(discardJournal, { journalId: draft.id, expectedVersion: (await journal(draft.id)).version }, "farzana")
    const pettyApproval = await approval(petty.approvalId!)
    expect(pettyApproval.routedTo).toContain(USR.farzana)
    await b.run(decideApproval, decide(pettyApproval, "approve"), "farzana")
    const pettyPosted = (await b.db.pettyCashVouchers.get(petty.id))!
    expect(pettyPosted.status).toBe("posted")
    const pettyJournal = await journal(pettyPosted.journalId!)
    expect(pettyJournal.rule).toBe("R19")
    expect(pettyJournal.date).toBe(last.lastDay)

    // Close.
    expect(closeAllowed(await checklist())).toBe(true)
    const open = await lastMonthPeriod()
    await b.run(closePeriod, { periodId: open.id, expectedVersion: open.version }, "farzana")
    expect((await lastMonthPeriod()).status).toBe("closed")

    // A new voucher dated last month is refused (PERIOD_CLOSED).
    const late = {
      voucherType: "JV" as const,
      date: last.lastDay,
      narration: "Late accrual",
      lines: [
        { account: "TELECOM", debitP: 500_00, creditP: 0 },
        { account: "ACCRUED_EXP", debitP: 0, creditP: 500_00 },
      ],
    }
    expect(await refusal(b.run(saveJournal, late, "farzana"))).toBe("PERIOD_CLOSED")
    return { draft, petty }
  }

  it("runs twice in a row (reopening the month the first run closed), and the key action works each time", async () => {
    const first = await launchAndPerform()
    const second = await launchAndPerform()
    expect(second.draft.journalNo).not.toBe(first.draft.journalNo)
    expect(second.petty.voucherNo).not.toBe(first.petty.voucherNo)
    const period = await lastMonthPeriod()
    expect(period.status).toBe("closed")
    // The second run reopened it with a reason (audited).
    const audit = await b.db.audit.where("entityId").equals(period.id).toArray()
    expect(audit.some((r) => r.reason?.includes("E11"))).toBe(true)
  })

  it("a re-run clears an unfinished run's draft and pending petty cash, so the checklist names only its own", async () => {
    const left = await runScenario(E11, b.db)
    const again = await runScenario(E11, b.db)
    expect((await journal(left.outcome.refs!.journalId!)).status).toBe("discarded")
    const leftPetty = (await b.db.pettyCashVouchers.get(left.outcome.refs!.pettyCashVoucherId!))!
    expect(leftPetty.status).toBe("rejected")
    expect((await approval(leftPetty.approvalId!)).decidedBy).toBe(USR.farzana)
    const byKey = Object.fromEntries((await checklist()).map((c) => [c.key, c]))
    expect(byKey.journals.items.map((i) => i.docId)).toEqual([again.outcome.refs!.journalId])
    expect(byKey.approvals.items.map((i) => i.docId)).toEqual([again.outcome.refs!.pettyCashVoucherId])
  })

  it("tops Uttara's petty cash up when it could not cover the voucher", async () => {
    // Spend the float down with petty cash approved by Farzana, then launch.
    while ((await pettyBalanceP()) >= E11_PETTY_P * 2) {
      const spent = await runScenario(E11, b.db)
      const v = (await b.db.pettyCashVouchers.get(spent.outcome.refs!.pettyCashVoucherId!))!
      await b.run(decideApproval, decide(await approval(v.approvalId!), "approve"), "farzana")
    }
    const topUps = async () => (await b.db.fundTransfers.toArray()).filter((t) => t.kind === "top-up" && t.toAccountId === CBA.PETTY_UTT).length
    const count = await topUps()
    await runScenario(E11, b.db)
    expect(await topUps()).toBe(count + 1)
    expect(await pettyBalanceP()).toBeGreaterThanOrEqual(E11_PETTY_P * 2)
  })

  it("leaves the books tied", async () => {
    expect((await booksTie(b.db)).balanced).toBe(true)
  })
})
