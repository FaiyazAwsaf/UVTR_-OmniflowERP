import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { Actor } from "@/core/engine/types"
import { trialBalance } from "@/core/ledger/statements"
import { lastMonth } from "@/core/scenarios/helpers"
import { runScenario } from "@/core/scenarios/runner"
import { seedDatabase } from "@/core/seed"
import { CBA, PTY } from "@/core/seed/content/seed-refs"
import { dhakaAt, isoWeekday } from "@/core/seed/time"
import { invoiceAvailableP } from "@/modules/ar/lib"
import { loadAging } from "@/modules/ar/queries"
import { autoMatchStatement, completeReconciliation, matchLine, postBankCharge, updateCheque } from "@/modules/cab/commands"
import { lineSettled } from "@/modules/cab/lib"
import { cabScenarios, lastWorkingDay } from "@/modules/cab/scenarios"

import { asSystem } from "../helpers/fixtures"
import { accountId, run, T } from "../ar/fin-helpers"
import { freshDb, signedIn } from "../helpers/foundation"

/**
 * WS-FIN launchers E7 and E8 on the small seed (plan §10): each runs twice in
 * a row, and after each run its key action works through the real commands
 * as Mahbub, with the amounts and documents the cue names.
 */
let db: OmniflowDb
let mahbub: Actor
const today = dhakaDate(now())
const E7 = cabScenarios.find((s) => s.id === "E7")!
const E8 = cabScenarios.find((s) => s.id === "E8")!

beforeAll(async () => {
  db = await freshDb("cab-scenarios")
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
  mahbub = await signedIn(db, "mahbub")
}, 180_000)
afterAll(async () => {
  await db.delete()
})

async function ties() {
  const tb = trialBalance(await db.accounts.toArray(), await db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" })
  expect(tb.balanced).toBe(true)
  const ar = await loadAging(db, today, "ar")
  expect(ar.totals.total).toBe(ar.controlP)
  expect(ar.advancesP).toBe(ar.advanceGlP)
}

describe("lastWorkingDay", () => {
  it("steps back over the Friday and Saturday bank weekend", () => {
    expect(lastWorkingDay("2026-10-31")).toBe("2026-10-29") // Saturday → Thursday
    expect(lastWorkingDay("2026-11-30")).toBe("2026-11-30") // Monday
    expect(lastWorkingDay("2027-04-30")).toBe("2027-04-29") // Friday → Thursday
    expect(isoWeekday(lastWorkingDay("2027-01-31"))).not.toBe(5)
  }, 60_000)
})

/** E7's key action: auto-match, post the charge, match the deposit by hand, complete. */
async function reconcile(statementId: string, params: Record<string, string | number>, receiptId: string) {
  const auto = await run(db, autoMatchStatement, { statementId }, mahbub)
  expect(auto.matched).toBe(params.autoLines)
  expect(auto.open).toBe(2)
  const st = (await db.bankStatements.get(statementId))!
  const open = st.lines.filter((l) => !lineSettled(l))
  const charge = open.find((l) => l.amountP < 0)!
  const deposit = open.find((l) => l.amountP > 0)!
  expect(charge.amountP).toBe(-Number(params.chargeP))
  expect(deposit).toMatchObject({ amountP: params.depositP, ref: params.transferRef })
  const posted = await run(db, postBankCharge, { statementId, lineId: charge.lineId }, mahbub)
  expect((await db.journals.get(posted.journalId))?.rule).toBe("R23")
  const receipt = (await db.receipts.get(receiptId))!
  const bankGl = await accountId(db, "BANK_MAIN")
  const bookLine = (await db.journalLines.where("journalId").equals(receipt.journalId!).toArray()).find((l) => l.accountId === bankGl)!
  expect(bookLine.date < deposit.date).toBe(true)
  await run(db, matchLine, { statementId, lineId: deposit.lineId, journalLineIds: [bookLine.id] }, mahbub)
  await run(db, completeReconciliation, { statementId }, mahbub)
  const done = (await db.bankStatements.get(statementId))!
  expect(done.status).toBe("reconciled")
  // The bank's closing balance now equals the books at the month end.
  const lines = (await db.journalLines.where("accountId").equals(bankGl).toArray()).filter((l) => l.date <= done.toDate)
  expect(lines.reduce((s, l) => s + l.debitP - l.creditP, 0)).toBe(done.closingBalanceP)
}

describe("E7 bank reconciliation launcher", () => {
  it("runs twice in a row; each run's fresh BRAC statement leaves the ৳575 charge and the Skyline deposit to the presenter", async () => {
    const month = lastMonth(today)
    const statements: string[] = []
    for (let i = 0; i < 2; i++) {
      const launch = await runScenario(E7, db)
      const { statementId, receiptId } = launch.outcome.refs!
      expect(launch.route).toBe(`/cab/reconciliation?id=${statementId}`)
      const st = (await db.bankStatements.get(statementId!))!
      expect(st).toMatchObject({ cashBankAccountId: CBA.BRAC, fromDate: month.firstDay, toDate: month.lastDay, status: "imported" })
      for (const earlier of statements) expect((await db.bankStatements.get(earlier))?.status).toBe("superseded")
      statements.push(statementId!)
      const receipt = (await db.receipts.get(receiptId!))!
      expect(receipt).toMatchObject({ partyId: PTY.skyline, method: "bank-transfer", amountP: T(12_000), status: "posted" })
      expect(receipt.date).toBe(addDaysISO(lastWorkingDay(month.lastDay), -5))
      expect(launch.outcome.params).toMatchObject({ chargeP: T(575), depositP: T(12_000), days: 5 })
      await reconcile(statementId!, launch.outcome.params!, receiptId!)
      await ties()
    }
  }, 60_000)

  it("supersedes an untouched statement and reopens last month when it was closed", async () => {
    await runScenario(E7, db)
    const month = lastMonth(today)
    const period = (await db.periods.toArray()).find((p) => p.startsOn === month.firstDay)!
    await asSystem(db, async (tx) => {
      await tx.update("periods", period.id, { status: "closed", closedBy: "usr_farzana", closedAt: tx.now() })
    })
    const launch = await runScenario(E7, db)
    const reopened = (await db.periods.get(period.id))!
    expect(reopened.status).toBe("open")
    expect(reopened.reopenReason).toBeTruthy()
    await reconcile(launch.outcome.refs!.statementId!, launch.outcome.params!, launch.outcome.refs!.receiptId!)
    await ties()
  }, 60_000)
})

describe("E8 post-dated cheque bounce launcher", () => {
  /**
   * E8's key action: deposit, then bounce. Nothing posts; the cheque's
   * reservation on the invoice the cue names is released; the customer gets
   * the cheque-bounced SMS. (When Metro has nothing left to reserve, as on
   * the 1st with the planted cheque still in hand, the cheque is all advance.)
   */
  async function depositAndBounce(chequeId: string, params: Record<string, string | number>, invoiceId: string | undefined) {
    const cheque = (await db.cheques.get(chequeId))!
    expect(cheque).toMatchObject({ direction: "received", status: "in-hand", chequeDate: today, isPdc: true, partyId: PTY.metroFleet, amountP: T(85_000), chequeNo: params.chequeNo })
    const before = invoiceId ? (await db.salesInvoices.get(invoiceId))! : undefined
    if (before) expect(before.invoiceNo).toBe(params.invoiceNo)
    else expect((await db.receipts.get(cheque.receiptId!))?.advanceP).toBe(T(85_000))
    await run(db, updateCheque, { chequeId, action: "deposit", expectedStatus: "in-hand" }, mahbub)
    const journals = await db.journals.count()
    await run(db, updateCheque, { chequeId, action: "bounce", expectedStatus: "deposited", reason: "Insufficient funds" }, mahbub)
    expect(await db.journals.count()).toBe(journals)
    expect((await db.cheques.get(chequeId))?.status).toBe("bounced")
    expect((await db.receipts.get(cheque.receiptId!))?.status).toBe("bounced")
    if (before && invoiceId) {
      const after = (await db.salesInvoices.get(invoiceId))!
      expect(after.reservedP).toBe(before.reservedP - Number(params.reservedP))
      expect(invoiceAvailableP(after)).toBe(invoiceAvailableP(before) + Number(params.reservedP))
      expect(invoiceAvailableP(after)).toBe(params.collectP)
    }
    const sms = (await db.sms.where("partyId").equals(PTY.metroFleet).toArray()).filter((s) => s.templateId === "cheque-bounced" && s.text.includes(String(params.chequeNo)))
    expect(sms).toHaveLength(1)
    expect(sms[0].text).toContain("85,000")
  }

  it("runs twice in a row; each fresh ৳85,000 cheque dated today is deposited, bounces and frees its invoice", async () => {
    for (let i = 0; i < 2; i++) {
      const launch = await runScenario(E8, db)
      const { chequeId, invoiceId } = launch.outcome.refs!
      expect(launch.route).toBe(`/cab/cheques?id=${chequeId}`)
      expect(launch.outcome.params).toMatchObject({ amountP: T(85_000) })
      // Grossed up for the VDS and AIT Metro deducts, on the oldest invoice that takes it (or what is left to reserve).
      expect(Number(launch.outcome.params!.reservedP)).toBeGreaterThan(0)
      await depositAndBounce(chequeId!, launch.outcome.params!, invoiceId)
      await ties()
    }
  }, 60_000)

  it("still sets up when earlier cheques are left in hand, and each new cheque still bounces", async () => {
    const first = await runScenario(E8, db)
    const second = await runScenario(E8, db)
    expect(second.outcome.params!.chequeNo).not.toBe(first.outcome.params!.chequeNo)
    await depositAndBounce(second.outcome.refs!.chequeId!, second.outcome.params!, second.outcome.refs!.invoiceId)
    await ties()
  }, 60_000)
})
