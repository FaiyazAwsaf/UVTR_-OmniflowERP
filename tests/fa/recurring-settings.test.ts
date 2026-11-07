import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { defaultTaxSettings } from "@/config/rules.config"
import { REC } from "@/core/seed/content/seed-refs"
import { runRecurring, saveAccount, saveSettings } from "@/modules/fa/commands"
import { faDatasetLoaders } from "@/modules/fa/datasets"

import { booksTie, key, refusal, seededBooks, sumJournal, type Books } from "./helpers"

/** Recurring journals (R25), the chart of accounts, FA settings and the FA datasets. */

let b: Books
beforeAll(async () => {
  b = await seededBooks("fa-recurring")
})
afterAll(async () => {
  await b.db.delete()
})

describe("fa.runRecurring (R25)", () => {
  it("is refused to a role without fa.recurring.run", async () => {
    const p = (await b.db.periods.where("month").equals(b.thisMonth).first())!
    expect(await refusal(b.run(runRecurring, { periodId: p.id, idempotencyKey: key() }, "tania"))).toBe("PERMISSION_DENIED")
  })

  it("posts each due template once for the period, dated its last day, linked to the template", async () => {
    const p = (await b.db.periods.where("month").equals(b.thisMonth).first())!
    const out = await b.run(runRecurring, { periodId: p.id, idempotencyKey: key() }, "mahbub")
    expect(out.posted.map((x) => x.templateId).sort()).toEqual([REC.depreciation, REC.prepaid, REC.salary].sort())
    for (const posted of out.posted) {
      const journal = await b.db.journals.get(posted.journalId)
      expect(journal?.rule).toBe("R25")
      expect(journal?.date).toBe(p.endsOn)
      expect(journal?.recurringId).toBe(posted.templateId)
      expect(journal?.source?.docType).toBe("recurringJournals")
      const lines = await b.db.journalLines.where("journalId").equals(posted.journalId).toArray()
      const sum = sumJournal(lines, posted.journalId)
      expect(sum.debitP).toBe(sum.creditP)
      expect(sum.debitP).toBeGreaterThan(0)
    }
    expect((await b.db.recurringJournals.get(REC.salary))?.lastPostedPeriodId).toBe(p.id)
    expect(await b.db.events.where("type").equals("RecurringPosted").count()).toBe(1)
    // Once per period.
    expect(await refusal(b.run(runRecurring, { periodId: p.id, idempotencyKey: key() }, "mahbub"))).toBe("NOTHING_TO_POST")
  })

  it("never amortises the prepaid balance below zero", async () => {
    const prepaid = await b.acc("PREPAID")
    const lines = await b.db.journalLines.where("accountId").equals(prepaid).toArray()
    const balance = lines.reduce((s, l) => s + l.debitP - l.creditP, 0)
    expect(balance).toBeGreaterThanOrEqual(0)
  })

  it("refuses a closed period", async () => {
    const closed = (await b.db.periods.where("status").equals("closed").first())!
    expect(await refusal(b.run(runRecurring, { periodId: closed.id, idempotencyKey: key() }, "mahbub"))).toBe("PERIOD_CLOSED")
  })
})

describe("fa.saveAccount", () => {
  it("creates an account under a group of the same type (accounts manager only)", async () => {
    const opex = (await b.db.accounts.where("code").equals("6000").first())!
    const input = { code: "6950", nameEn: "Training", nameBn: "প্রশিক্ষণ", type: "expense" as const, parentId: opex.id, isGroup: false, active: true }
    expect(await refusal(b.run(saveAccount, input, "mahbub"))).toBe("PERMISSION_DENIED")
    const out = await b.run(saveAccount, input, "farzana")
    const row = await b.db.accounts.get(out.accountId)
    expect(row?.normalSide).toBe("debit")
    expect(row?.isControl).toBe(false)
    expect(await refusal(b.run(saveAccount, input, "farzana"))).toBe("ACCOUNT_CODE_TAKEN")
    const assets = (await b.db.accounts.where("code").equals("1000").first())!
    expect(await refusal(b.run(saveAccount, { ...input, code: "6951", parentId: assets.id }, "farzana"))).toBe("ACCOUNT_PARENT")
  })

  it("keeps a tag unique and never deactivates a mapped account", async () => {
    const opex = (await b.db.accounts.where("code").equals("6000").first())!
    expect(
      await refusal(
        b.run(saveAccount, { code: "6960", nameEn: "Rent two", nameBn: "ভাড়া ২", type: "expense", parentId: opex.id, isGroup: false, tag: "RENT", active: true }, "farzana")
      )
    ).toBe("ACCOUNT_TAG_TAKEN")
    const rent = (await b.db.accounts.where("code").equals("6200").first())!
    expect(
      await refusal(
        b.run(saveAccount, { accountId: rent.id, expectedVersion: rent.version, code: rent.code, nameEn: rent.nameEn, nameBn: rent.nameBn, type: rent.type, parentId: rent.parentId, isGroup: false, tag: rent.tag, active: false }, "farzana")
      )
    ).toBe("ACCOUNT_MAPPED")
    // Renaming is fine.
    await b.run(
      saveAccount,
      { accountId: rent.id, expectedVersion: rent.version, code: rent.code, nameEn: "Rent and service charge", nameBn: rent.nameBn, type: rent.type, parentId: rent.parentId, isGroup: false, tag: rent.tag, active: true },
      "farzana"
    )
    expect((await b.db.accounts.get(rent.id))?.nameEn).toBe("Rent and service charge")
  })
})

describe("fa.saveSettings", () => {
  it("edits tax rates (demo values) with fa.settings.configure only", async () => {
    const tax = { ...defaultTaxSettings, vatRates: { ...defaultTaxSettings.vatRates, "reduced-5": 4 } }
    expect(await refusal(b.run(saveSettings, { kind: "tax", tax }, "mahbub"))).toBe("PERMISSION_DENIED")
    await b.run(saveSettings, { kind: "tax", tax }, "farzana")
    const row = await b.db.settings.get("tax")
    expect((row?.value as typeof tax).vatRates["reduced-5"]).toBe(4)
  })

  it("maps a tag only to an account of the same type and control flag", async () => {
    const training = (await b.db.accounts.where("code").equals("6950").first())!
    const row = await b.db.settings.get("postingAccounts")
    await b.run(saveSettings, { kind: "postingMap", map: { WELFARE: training.id }, expectedVersion: row!.version }, "farzana")
    expect(((await b.db.settings.get("postingAccounts"))?.value as Record<string, string>).WELFARE).toBe(training.id)
    const fresh = await b.db.settings.get("postingAccounts")
    expect(await refusal(b.run(saveSettings, { kind: "postingMap", map: { CASH_TILL_GUL: training.id }, expectedVersion: fresh!.version }, "farzana"))).toBe(
      "MAP_TYPE_MISMATCH"
    )
  })

  it("adds a cost centre with a unique code", async () => {
    const out = await b.run(saveSettings, { kind: "costCentre", code: "CC-MOB", nameEn: "Mobile unit", nameBn: "ভ্রাম্যমাণ ইউনিট" }, "farzana")
    expect((await b.db.costCentres.get(out.costCentreId!))?.code).toBe("CC-MOB")
    expect(await refusal(b.run(saveSettings, { kind: "costCentre", code: "CC-MOB", nameEn: "Again", nameBn: "আবার" }, "farzana"))).toBe(
      "COST_CENTRE_CODE_TAKEN"
    )
  })
})

describe("FA datasets", () => {
  it("fa.journalLines rows link to the voucher and its source document", async () => {
    const rows = await faDatasetLoaders["fa.journalLines"](b.db, { from: `${b.thisMonth}-01`, to: b.today })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => String(r.journalHref).startsWith("/fa/journals/"))).toBe(true)
    const withSource = rows.find((r) => r.sourceDocNo)
    expect(withSource?.sourceHref).toBeTruthy()
    const debit = rows.reduce((s, r) => s + Number(r.debitP), 0)
    const credit = rows.reduce((s, r) => s + Number(r.creditP), 0)
    expect(debit).toBe(credit)
  })

  it("fa.accountBalances closes to the trial balance", async () => {
    const rows = await faDatasetLoaders["fa.accountBalances"](b.db, { from: `${b.thisMonth}-01`, to: b.today })
    const closing = rows.reduce((s, r) => s + Number(r.closingP), 0)
    expect(closing).toBe(0)
    expect((await booksTie(b.db)).balanced).toBe(true)
  })
})
