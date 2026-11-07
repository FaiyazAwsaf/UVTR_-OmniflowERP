import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { AccountTag, Id } from "@/core/db/schema"
import { CBA } from "@/core/seed/content/seed-refs"
import { payTax, submitVatReturn } from "@/modules/frs/commands"
import { previousMonth, tagLines, vatMonthFigures } from "@/modules/frs/vat"

import { booksTie, key, refusal, seededBooks, sumJournal, type Books } from "../fa/helpers"

/** Mushak 9.1 return (R27a) and treasury deposits of VAT, VDS and AIT (R27b). */

let b: Books
beforeAll(async () => {
  b = await seededBooks("frs-vat")
})
afterAll(async () => {
  await b.db.delete()
})

async function figures(month: string) {
  const map = (await b.db.settings.get("postingAccounts"))!.value as Record<AccountTag, Id>
  const tagOf = new Map<Id, AccountTag>(Object.entries(map).map(([tag, id]) => [id, tag as AccountTag]))
  const lines = await b.db.journalLines.where("date").between(`${month}-01`, `${month}-31`, true, true).toArray()
  const journals = new Map((await b.db.journals.toArray()).map((j) => [j.id, j]))
  const prev = await b.db.vatReturns.where("month").equals(previousMonth(month)).first()
  return vatMonthFigures(tagLines(lines, journals, tagOf), month, prev?.carryForwardP ?? 0)
}

describe("VAT figures", () => {
  it("recompute every seeded return exactly (live and seeded maths agree)", async () => {
    const returns = await b.db.vatReturns.toArray()
    expect(returns.length).toBeGreaterThanOrEqual(0)
    for (const r of returns) {
      const f = await figures(r.month)
      expect({ out: f.outputVatP, inp: f.inputVatP, vds: f.vdsCreditP, carry: f.carryInP, net: f.netPayableP, cf: f.carryForwardP }).toEqual({
        out: r.outputVatP,
        inp: r.inputVatP,
        vds: r.vdsCreditP,
        carry: r.carryInP,
        net: r.netPayableP,
        cf: r.carryForwardP,
      })
    }
  })
})

describe("frs.submitVatReturn (R27a)", () => {
  it("is refused to a role without frs.vat.submit", async () => {
    expect(await refusal(b.run(submitVatReturn, { month: b.lastMonth, idempotencyKey: key() }, "mahbub"))).toBe("PERMISSION_DENIED")
  })

  it("refuses the current month (not ended)", async () => {
    expect(await refusal(b.run(submitVatReturn, { month: b.thisMonth, idempotencyKey: key() }, "farzana"))).toBe("MONTH_NOT_ENDED")
  })

  it("submits last month's return with a simulated NBR reference and the settlement voucher", async () => {
    const f = await figures(b.lastMonth)
    const out = await b.run(submitVatReturn, { month: b.lastMonth, idempotencyKey: key() }, "farzana")
    expect(out.nbrRef).toMatch(/^NBR-EVAT-\d{6}-\d{6}$/)
    const row = await b.db.vatReturns.get(out.vatReturnId)
    expect(row?.outputVatP).toBe(f.outputVatP)
    expect(row?.netPayableP).toBe(f.netPayableP)
    expect(row?.carryForwardP).toBe(f.carryForwardP)
    if (f.setOffP > 0) {
      const journal = await b.db.journals.get(row!.journalId)
      expect(journal?.rule).toBe("R27a")
      expect(journal?.source?.docType).toBe("vatReturns")
      const lines = await b.db.journalLines.where("journalId").equals(journal!.id).toArray()
      expect(sumJournal(lines, journal!.id)).toEqual({ debitP: f.setOffP, creditP: f.setOffP })
      expect(lines.find((l) => l.debitP > 0)?.accountId).toBe(await b.acc("VAT_OUTPUT"))
    }
    expect(await b.db.events.where("type").equals("VatReturnSubmitted").count()).toBe(1)
    expect(await refusal(b.run(submitVatReturn, { month: b.lastMonth, idempotencyKey: key() }, "farzana"))).toBe("VAT_ALREADY_SUBMITTED")
  })
})

describe("frs.payTax (R27b)", () => {
  it("is refused to a role without frs.tax.pay", async () => {
    expect(await refusal(b.run(payTax, { kind: "vat", forMonth: b.lastMonth, cashBankAccountId: CBA.BRAC, idempotencyKey: key() }, "mahbub"))).toBe(
      "PERMISSION_DENIED"
    )
  })

  it("deposits last month's net VAT, VDS and AIT once each, from a bank account only", async () => {
    expect(await refusal(b.run(payTax, { kind: "vat", forMonth: b.lastMonth, cashBankAccountId: CBA.TILL_GUL, idempotencyKey: key() }, "farzana"))).toBe(
      "TAX_BANK_ONLY"
    )
    const ret = (await b.db.vatReturns.where("month").equals(b.lastMonth).first())!
    const f = await figures(b.lastMonth)
    const expected = { vat: ret.netPayableP, vds: f.vdsWithheldP, ait: f.aitWithheldP }
    for (const kind of ["vat", "vds", "ait"] as const) {
      const input = { kind, forMonth: b.lastMonth, cashBankAccountId: CBA.BRAC, idempotencyKey: key() }
      if (expected[kind] <= 0) {
        expect(await refusal(b.run(payTax, input, "farzana"))).toBe("NOTHING_DUE")
        continue
      }
      const out = await b.run(payTax, input, "farzana")
      expect(out.amountP).toBe(expected[kind])
      expect(out.depositNo).toMatch(/^TXD-\d{4}-\d{4}$/)
      expect(out.challanRef).toMatch(new RegExp(`^TC-${kind.toUpperCase()}-`))
      const deposit = await b.db.taxDeposits.get(out.taxDepositId)
      const journal = await b.db.journals.get(deposit!.journalId)
      expect(journal?.rule).toBe("R27b")
      expect(journal?.voucherType).toBe("PV")
      const lines = await b.db.journalLines.where("journalId").equals(journal!.id).toArray()
      const tag = kind === "vat" ? "VAT_OUTPUT" : kind === "vds" ? "VDS_PAYABLE" : "AIT_PAYABLE"
      expect(lines.find((l) => l.debitP > 0)?.accountId).toBe(await b.acc(tag))
      expect(lines.find((l) => l.creditP > 0)?.accountId).toBe(await b.acc("BANK_MAIN"))
      expect(await refusal(b.run(payTax, { ...input, idempotencyKey: key() }, "farzana"))).toBe("NOTHING_DUE")
    }
    expect((await booksTie(b.db)).balanced).toBe(true)
  })
})
