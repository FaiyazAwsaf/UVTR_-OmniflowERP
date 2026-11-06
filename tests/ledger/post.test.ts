import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { RuleViolation } from "@/core/engine/errors"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { postJournal, reverseJournal } from "@/core/ledger/post"
import { linesForBankCharge, linesForDeposit, type LineInput } from "@/core/ledger/rules"
import { trialBalance } from "@/core/ledger/statements"
import { periodIdOf } from "@/core/seed/generators/org"
import { addMonthsISO } from "@/core/seed/time"

import { foundationDb } from "../helpers/foundation"
import { asSystem } from "../helpers/fixtures"

let db: OmniflowDb
const today = () => dhakaDate(now())

beforeEach(async () => {
  db = await foundationDb("ledger")
})
afterEach(async () => {
  await db.delete()
})

const post = (lines: LineInput[], rule: "R23" | "R24" | "R3" = "R23", date = today()) =>
  asSystem(db, (tx) =>
    postJournal(tx, { voucherType: rule === "R24" ? "JV" : rule === "R3" ? "RV" : "PV", date, narration: "test", lines, rule })
  )

describe("postJournal (plan §3.4)", () => {
  it("posts a balanced voucher with a number, period and cost centres", async () => {
    const journal = await post(linesForBankCharge({ bankTag: "BANK_MAIN", amountP: 575_00, locationId: "loc_hq" }))
    expect(journal.journalNo).toMatch(/^PV-\d{4}-000001$/)
    expect(journal.status).toBe("posted")
    expect(journal.periodId).toBe(periodIdOf(today().slice(0, 7)))
    const lines = await db.journalLines.where("journalId").equals(journal.id).toArray()
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.costCentreId === "cc_hq")).toBe(true)
    const tb = trialBalance(await db.accounts.toArray(), await db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" })
    expect(tb.balanced).toBe(true)
  })

  it("refuses an unbalanced voucher (INV-01)", async () => {
    await expect(
      post([
        { account: "BANK_CHARGES", debitP: 100 },
        { account: "BANK_MAIN", creditP: 90 },
      ])
    ).rejects.toMatchObject({ code: "JOURNAL_UNBALANCED" })
  })

  it("refuses a posting into a closed period and audits it (INV-02)", async () => {
    const twoMonthsAgo = addMonthsISO(today(), -2)
    const period = await db.periods.get(periodIdOf(twoMonthsAgo.slice(0, 7)))
    expect(period?.status).toBe("closed")
    await expect(post(linesForBankCharge({ bankTag: "BANK_MAIN", amountP: 100 }), "R23", twoMonthsAgo)).rejects.toMatchObject({
      code: "PERIOD_CLOSED",
    })
    const blocked = await db.audit.where("action").equals("blocked").toArray()
    expect(blocked.some((r) => r.code === "PERIOD_CLOSED")).toBe(true)
  })

  it("keeps manual vouchers off control accounts (INV-03) and requires parties (INV-04)", async () => {
    await expect(
      post(
        [
          { account: "AR_CONTROL", debitP: 100, partyId: "p" },
          { account: "OTHER_INCOME", creditP: 100 },
        ],
        "R24"
      )
    ).rejects.toMatchObject({ code: "CONTROL_ACCOUNT" })
    await expect(
      post(
        [
          { account: "BANK_MAIN", debitP: 100 },
          { account: "CUSTOMER_ADVANCE", creditP: 100 },
        ],
        "R3"
      )
    ).rejects.toMatchObject({ code: "PARTY_REQUIRED" })
    const ok = await post(linesForDeposit({ cashTag: "MFS_BKASH", amountP: 100, partyId: "p", locationId: "loc_gul" }), "R3")
    expect(ok.voucherType).toBe("RV")
  })

  it("refuses a group account", async () => {
    await expect(
      post([
        { account: "acc_1120", debitP: 100 },
        { account: "BANK_MAIN", creditP: 100 },
      ])
    ).rejects.toBeInstanceOf(RuleViolation)
  })

  it("reverses a manual voucher with a linked, swapped voucher (R26) and keeps posted lines immutable", async () => {
    const original = await post(
      [
        { account: "SALARIES", debitP: 1_000_00, locationId: "loc_gul" },
        { account: "SALARY_PAYABLE", creditP: 1_000_00 },
      ],
      "R24"
    )
    const reversal = await asSystem(db, (tx) => reverseJournal(tx, original.id, { date: today(), reason: "wrong month" }))
    expect(reversal.voucherType).toBe("JV")
    expect((await db.journals.get(original.id))?.status).toBe("reversed")
    expect((await db.journals.get(reversal.id))?.reversalOfId).toBe(original.id)
    const lines = await db.journalLines.where("journalId").equals(reversal.id).toArray()
    expect(lines.find((l) => l.creditP === 1_000_00)?.accountId).toBe("acc_6100")

    const tamper = defineCommand({
      name: "fa.testTamper",
      permission: "system",
      input: z.object({}),
      async run(tx) {
        const [line] = await tx.list("journalLines", "journalId", original.id)
        await tx.update("journalLines", line.id, { debitP: 1 })
      },
    })
    await expect(commit(tamper, {}, { db, actor: SYSTEM_ACTOR })).rejects.toMatchObject({ code: "IMMUTABLE_DOCUMENT" })
  })
})
