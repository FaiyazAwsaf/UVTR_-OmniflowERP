import { z } from "zod"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { requireApproval } from "@/core/approvals/approvals"
import { defineCommand } from "@/core/engine/defineCommand"
import { postJournal } from "@/core/ledger/post"
import { linesForPettyCash } from "@/core/ledger/rules"
import { CBA, LOC, USR } from "@/core/seed/content/seed-refs"
import { buildCloseChecklist, closeReaderFromDb } from "@/modules/fa/close"
import { closePeriod, discardJournal, reopenPeriod, saveJournal } from "@/modules/fa/commands"
import { closeAllowed } from "@/modules/fa/types"

import { asSystem } from "../helpers/fixtures"
import { booksTie, refusal, seededBooks, type Books } from "./helpers"

/**
 * Month-end close (accounting_rules.md §7, E11): the checklist, INV-13
 * (drafts and pending approvals block), INV-02 (nothing posts into a closed
 * month), close in order and reopen with a reason.
 */

/** A petty cash voucher of ৳2,500 by Sabbir at Uttara (above his ৳1,000), pending; the CAB handler is WS-FIN's. */
const pettyCash = defineCommand({
  name: "cab.testPettyCash",
  permission: "cab.pettycash.create",
  input: z.object({ date: z.string() }),
  async run(tx, input) {
    tx.requireLocation(LOC.UTT)
    const row = tx.insert("pettyCashVouchers", {
      voucherNo: `PCV-UTT-TEST-${input.date}`,
      cashBankAccountId: CBA.PETTY_UTT,
      locationId: LOC.UTT,
      date: input.date,
      expenseTag: "CONVEYANCE",
      amountP: 2_500_00,
      payee: "Rickshaw van",
      description: "Delivery of chemicals",
      status: "pending-approval",
      preparedBy: tx.actor.userId,
    })
    const outcome = await requireApproval(tx, {
      kind: "petty-cash",
      docType: "pettyCashVouchers",
      docId: row.id,
      docNo: row.voucherNo,
      locationId: LOC.UTT,
      amountP: row.amountP,
    })
    return { id: row.id, approvalId: outcome.status === "pending" ? outcome.approvalId : undefined }
  },
})

/** Any posting dated on a day (a stand-in for every module's documents). */
const postOn = defineCommand({
  name: "cab.testPost",
  permission: "cab.pettycash.create",
  input: z.object({ date: z.string() }),
  async run(tx, input) {
    return postJournal(tx, {
      voucherType: "PV",
      date: input.date,
      narration: "Test posting",
      lines: linesForPettyCash({ pettyTag: "PETTY_UTT", expenseTag: "CONVEYANCE", amountP: 100_00, locationId: LOC.UTT }),
      rule: "R19",
    })
  },
})

let b: Books
let lastMonthId: string
beforeAll(async () => {
  b = await seededBooks("fa-periods")
  lastMonthId = (await b.db.periods.where("month").equals(b.lastMonth).first())!.id
})
afterAll(async () => {
  await b.db.delete()
})

const period = async (month: string) => (await b.db.periods.where("month").equals(month).first())!

describe("fa.closePeriod and fa.reopenPeriod", () => {
  it("seeds months before last month closed; last month and this month open", async () => {
    expect((await period(b.lastMonth)).status).toBe("open")
    expect((await period(b.thisMonth)).status).toBe("open")
  })

  it("E11: a draft voucher and a pending petty cash voucher block last month's close", async () => {
    const utilities = await b.acc("UTILITIES")
    const accrued = await b.acc("ACCRUED_EXP")
    const draft = await b.run(
      saveJournal,
      {
        voucherType: "JV",
        date: b.lastMonthDay,
        narration: "Water bill accrual",
        lines: [
          { account: utilities, debitP: 8_000_00, creditP: 0 },
          { account: accrued, debitP: 0, creditP: 8_000_00 },
        ],
      },
      "mahbub"
    )
    const petty = await b.run(pettyCash, { date: b.lastMonthDay }, "sabbir")
    expect(petty.approvalId).toBeDefined()

    const checklist = await buildCloseChecklist(closeReaderFromDb(b.db), await period(b.lastMonth))
    const byKey = Object.fromEntries(checklist.map((c) => [c.key, c]))
    expect(byKey.journals.ok).toBe(false)
    expect(byKey.journals.items.map((i) => i.docNo)).toEqual([draft.journalNo])
    expect(byKey.approvals.ok).toBe(false)
    expect(byKey.approvals.items[0].docType).toBe("pettyCashVouchers")
    expect(byKey.recurring.ok).toBe(true)
    expect(byKey.vatReturn.blocking).toBe("warning")
    expect(byKey.grni.blocking).toBe("info")
    expect(closeAllowed(checklist)).toBe(false)

    const p = await period(b.lastMonth)
    expect(await refusal(b.run(closePeriod, { periodId: p.id, expectedVersion: p.version }, "mahbub"))).toBe("PERMISSION_DENIED")
    expect(await refusal(b.run(closePeriod, { periodId: p.id, expectedVersion: p.version }, "farzana"))).toBe("CLOSE_BLOCKED")
    const blocked = await b.db.audit.where("action").equals("blocked").toArray()
    expect(blocked.some((r) => r.code === "CLOSE_BLOCKED")).toBe(true)

    // Discard the draft; the petty cash approval is decided (here: withdrawn by a fixture).
    const row = await b.db.journals.get(draft.journalId)
    await b.run(discardJournal, { journalId: draft.journalId, expectedVersion: row!.version }, "farzana")
    await asSystem(b.db, async (tx) => {
      await tx.update("approvals", petty.approvalId!, { status: "cancelled" })
      await tx.update("pettyCashVouchers", petty.id, { status: "rejected" })
    })
    const fresh = await period(b.lastMonth)
    await b.run(closePeriod, { periodId: fresh.id, expectedVersion: fresh.version }, "farzana")
    const closed = await period(b.lastMonth)
    expect(closed.status).toBe("closed")
    expect(closed.closedBy).toBe(USR.farzana)
    expect(closed.closeChecklist?.map((c) => c.key)).toEqual(["journals", "approvals", "recurring", "bankRecon", "grni", "vatReturn"])
    expect(await b.db.events.where("type").equals("PeriodClosed").count()).toBe(1)
  })

  it("refuses any posting dated in the closed month (INV-02, PERIOD_CLOSED)", async () => {
    expect(await refusal(b.run(postOn, { date: b.lastMonthDay }, "sabbir"))).toBe("PERIOD_CLOSED")
    const utilities = await b.acc("UTILITIES")
    const accrued = await b.acc("ACCRUED_EXP")
    const input = {
      voucherType: "JV" as const,
      date: b.lastMonthDay,
      narration: "Late accrual",
      lines: [
        { account: utilities, debitP: 1_00, creditP: 0 },
        { account: accrued, debitP: 0, creditP: 1_00 },
      ],
    }
    expect(await refusal(b.run(saveJournal, input, "mahbub"))).toBe("PERIOD_CLOSED")
  })

  it("never closes the current month before it ends", async () => {
    const p = await period(b.thisMonth)
    expect(await refusal(b.run(closePeriod, { periodId: p.id, expectedVersion: p.version }, "farzana"))).toBe("PERIOD_NOT_ENDED")
  })

  it("reopens with a reason (owner or accounts manager), latest closed month first", async () => {
    const p = await period(b.lastMonth)
    expect(await refusal(b.run(reopenPeriod, { periodId: p.id, expectedVersion: p.version, reason: "Late bill" }, "mahbub"))).toBe(
      "PERMISSION_DENIED"
    )
    const earlier = (await b.db.periods.where("status").equals("closed").toArray())
      .filter((x) => x.id !== p.id)
      .sort((a, c) => c.startsOn.localeCompare(a.startsOn))[0]
    if (earlier) {
      const year = await b.db.fiscalYears.get(earlier.fiscalYearId)
      const code = await refusal(b.run(reopenPeriod, { periodId: earlier.id, expectedVersion: earlier.version, reason: "Old month" }, "rashed"))
      expect(code).toBe(year?.status === "closed" ? "YEAR_CLOSED" : "REOPEN_ORDER")
    }
    await b.run(reopenPeriod, { periodId: p.id, expectedVersion: p.version, reason: "Late utility bill" }, "rashed")
    const reopened = await period(b.lastMonth)
    expect(reopened.status).toBe("open")
    expect(reopened.reopenReason).toBe("Late utility bill")
    const audit = await b.db.audit.where("entityId").equals(lastMonthId).toArray()
    expect(audit.some((r) => r.reason === "Late utility bill")).toBe(true)
    // Postings into it work again.
    await b.run(postOn, { date: b.lastMonthDay }, "sabbir")
    expect((await booksTie(b.db)).balanced).toBe(true)
  })
})
