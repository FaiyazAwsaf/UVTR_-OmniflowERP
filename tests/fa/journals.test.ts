import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { decideApproval } from "@/core/approvals/decide"
import { CC, USR } from "@/core/seed/content/seed-refs"
import { discardJournal, reverseJournal, saveJournal, submitJournal } from "@/modules/fa/commands"

import { booksTie, key, refusal, seededBooks, sumJournal, type Books } from "./helpers"

/**
 * Manual vouchers (R24), maker-checker above the preparer's journal limit
 * (plan §3.7, E10), reversal (R26) and discard.
 */

let b: Books
let utilities: string
let accrued: string
let bank: string
let salaryPayable: string
beforeAll(async () => {
  b = await seededBooks("fa-journals")
  utilities = await b.acc("UTILITIES")
  accrued = await b.acc("ACCRUED_EXP")
  bank = await b.acc("BANK_MAIN")
  salaryPayable = await b.acc("SALARY_PAYABLE")
})
afterAll(async () => {
  await b.db.delete()
})

const accrual = (amountP: number, date: string) => ({
  voucherType: "JV" as const,
  date,
  narration: "Electricity accrual",
  lines: [
    { account: utilities, debitP: amountP, creditP: 0, costCentreId: CC.GUL },
    { account: accrued, debitP: 0, creditP: amountP },
  ],
})

describe("fa.saveJournal", () => {
  it("is refused to a role without fa.journal.create", async () => {
    expect(await refusal(b.run(saveJournal, accrual(1_000_00, b.today), "tania"))).toBe("PERMISSION_DENIED")
  })

  it("saves a draft with its number and lines in draftLines, nothing in the ledger", async () => {
    const out = await b.run(saveJournal, accrual(1_20_000_00, b.today), "mahbub")
    expect(out.journalNo).toMatch(/^JV-\d{4}-\d{6}$/)
    const journal = await b.db.journals.get(out.journalId)
    expect(journal?.status).toBe("draft")
    expect(journal?.preparedBy).toBe(USR.mahbub)
    expect(journal?.totalP).toBe(1_20_000_00)
    expect(journal?.draftLines).toHaveLength(2)
    // The cost centre's location rides along for P&L by studio.
    expect(journal?.draftLines?.[0].locationId).toBe("loc_gul")
    expect(await b.db.journalLines.where("journalId").equals(out.journalId).count()).toBe(0)
  })

  it("refuses a control account on a manual voucher (INV-03)", async () => {
    const ar = await b.acc("AR_CONTROL")
    const input = {
      ...accrual(5_000_00, b.today),
      lines: [
        { account: ar, debitP: 5_000_00, creditP: 0 },
        { account: accrued, debitP: 0, creditP: 5_000_00 },
      ],
    }
    expect(await refusal(b.run(saveJournal, input, "mahbub"))).toBe("CONTROL_ACCOUNT")
  })

  it("refuses a line carrying a debit and a credit", async () => {
    const input = { ...accrual(5_000_00, b.today), lines: [{ account: utilities, debitP: 100, creditP: 100 }] }
    expect(await refusal(b.run(saveJournal, input, "mahbub"))).toBe("JOURNAL_LINE_BOTH")
  })

  it("lets only the preparer edit a draft, and keeps the number", async () => {
    const out = await b.run(saveJournal, accrual(2_000_00, b.today), "mahbub")
    const row = await b.db.journals.get(out.journalId)
    expect(
      await refusal(b.run(saveJournal, { ...accrual(3_000_00, b.today), journalId: out.journalId, expectedVersion: row!.version }, "farzana"))
    ).toBe("NOT_PREPARER")
    const edited = await b.run(saveJournal, { ...accrual(3_000_00, b.today), journalId: out.journalId, expectedVersion: row!.version }, "mahbub")
    expect(edited.journalNo).toBe(out.journalNo)
    expect((await b.db.journals.get(out.journalId))?.totalP).toBe(3_000_00)
  })
})

describe("fa.submitJournal", () => {
  it("posts at once within the preparer's limit (R24), keeping the draft's row and number", async () => {
    const draft = await b.run(saveJournal, accrual(40_000_00, b.today), "mahbub")
    const version = (await b.db.journals.get(draft.journalId))!.version
    const out = await b.run(submitJournal, { journalId: draft.journalId, expectedVersion: version, idempotencyKey: key() }, "mahbub")
    expect(out.status).toBe("posted")
    const journal = await b.db.journals.get(draft.journalId)
    expect(journal?.status).toBe("posted")
    expect(journal?.journalNo).toBe(draft.journalNo)
    expect(journal?.rule).toBe("R24")
    expect(journal?.draftLines).toBeUndefined()
    const lines = await b.db.journalLines.where("journalId").equals(draft.journalId).toArray()
    expect(sumJournal(lines, draft.journalId)).toEqual({ debitP: 40_000_00, creditP: 40_000_00 })
    expect(lines.find((l) => l.accountId === utilities)?.costCentreId).toBe(CC.GUL)
    expect(await b.db.events.where("type").equals("JournalPosted").count()).toBeGreaterThan(0)
  })

  it("refuses an unbalanced voucher", async () => {
    const draft = await b.run(
      saveJournal,
      { ...accrual(1_000_00, b.today), lines: [{ account: utilities, debitP: 1_000_00, creditP: 0 }, { account: accrued, debitP: 0, creditP: 900_00 }] },
      "mahbub"
    )
    const version = (await b.db.journals.get(draft.journalId))!.version
    expect(await refusal(b.run(submitJournal, { journalId: draft.journalId, expectedVersion: version, idempotencyKey: key() }, "mahbub"))).toBe(
      "JOURNAL_UNBALANCED"
    )
  })

  it("E10: above Mahbub's ৳50,000 the voucher waits; Mahbub can't approve; Farzana approves and it posts", async () => {
    const draft = await b.run(saveJournal, accrual(1_20_000_00, b.today), "mahbub")
    const version = (await b.db.journals.get(draft.journalId))!.version
    const out = await b.run(submitJournal, { journalId: draft.journalId, expectedVersion: version, idempotencyKey: key() }, "mahbub")
    expect(out.status).toBe("pending-approval")
    const pending = await b.db.journals.get(draft.journalId)
    expect(pending?.status).toBe("pending-approval")
    const approval = await b.db.approvals.get(out.approvalId!)
    expect(approval?.kind).toBe("journal")
    expect(approval?.docType).toBe("journals")
    expect(approval?.approveKey).toBe("fa.journal.approve")
    expect(new Set(approval?.routedTo)).toEqual(new Set([USR.farzana, USR.rashed]))
    expect(await b.db.journalLines.where("journalId").equals(draft.journalId).count()).toBe(0)

    const decide = { approvalId: approval!.id, decision: "approve" as const, reason: "", expectedVersion: approval!.version }
    expect(await refusal(b.run(decideApproval, decide, "mahbub"))).toBe("SELF_APPROVAL")
    await b.run(decideApproval, decide, "farzana")
    const posted = await b.db.journals.get(draft.journalId)
    expect(posted?.status).toBe("posted")
    expect(posted?.journalNo).toBe(draft.journalNo)
    expect(posted?.preparedBy).toBe(USR.mahbub)
    expect(posted?.postedBy).toBe(USR.farzana)
    expect(posted?.approvalId).toBe(approval!.id)
    const lines = await b.db.journalLines.where("journalId").equals(draft.journalId).toArray()
    expect(sumJournal(lines, draft.journalId)).toEqual({ debitP: 1_20_000_00, creditP: 1_20_000_00 })
    expect(await b.db.events.where("type").equals("JournalApproved").count()).toBe(1)
  })

  it("E10: Farzana's own ৳12,00,000 voucher goes to Rashed only; she can't decide it", async () => {
    const input = {
      voucherType: "PV" as const,
      date: b.today,
      narration: "Salaries paid",
      lines: [
        { account: salaryPayable, debitP: 12_00_000_00, creditP: 0 },
        { account: bank, debitP: 0, creditP: 12_00_000_00 },
      ],
    }
    const draft = await b.run(saveJournal, input, "farzana")
    expect(draft.journalNo).toMatch(/^PV-/)
    const version = (await b.db.journals.get(draft.journalId))!.version
    const out = await b.run(submitJournal, { journalId: draft.journalId, expectedVersion: version, idempotencyKey: key() }, "farzana")
    expect(out.status).toBe("pending-approval")
    const approval = await b.db.approvals.get(out.approvalId!)
    expect(approval?.routedTo).toEqual([USR.rashed])
    const decide = { approvalId: approval!.id, decision: "approve" as const, reason: "", expectedVersion: approval!.version }
    expect(await refusal(b.run(decideApproval, decide, "farzana"))).toBe("SELF_APPROVAL")
    await b.run(decideApproval, decide, "rashed")
    expect((await b.db.journals.get(draft.journalId))?.status).toBe("posted")
  })

  it("a rejected voucher returns to draft for its preparer", async () => {
    const draft = await b.run(saveJournal, accrual(70_000_00, b.today), "mahbub")
    const version = (await b.db.journals.get(draft.journalId))!.version
    const out = await b.run(submitJournal, { journalId: draft.journalId, expectedVersion: version, idempotencyKey: key() }, "mahbub")
    const approval = await b.db.approvals.get(out.approvalId!)
    await b.run(decideApproval, { approvalId: approval!.id, decision: "reject", reason: "Wrong month", expectedVersion: approval!.version }, "farzana")
    const back = await b.db.journals.get(draft.journalId)
    expect(back?.status).toBe("draft")
    expect(await b.db.journalLines.where("journalId").equals(draft.journalId).count()).toBe(0)
  })
})

describe("fa.discardJournal", () => {
  it("discards a draft (any preparer of vouchers may) and a pending voucher, cancelling its approval", async () => {
    const draft = await b.run(saveJournal, accrual(5_000_00, b.today), "mahbub")
    let row = await b.db.journals.get(draft.journalId)
    await b.run(discardJournal, { journalId: draft.journalId, expectedVersion: row!.version }, "farzana")
    expect((await b.db.journals.get(draft.journalId))?.status).toBe("discarded")

    const big = await b.run(saveJournal, accrual(60_000_00, b.today), "mahbub")
    row = await b.db.journals.get(big.journalId)
    const out = await b.run(submitJournal, { journalId: big.journalId, expectedVersion: row!.version, idempotencyKey: key() }, "mahbub")
    row = await b.db.journals.get(big.journalId)
    await b.run(discardJournal, { journalId: big.journalId, expectedVersion: row!.version, reason: "Duplicate" }, "mahbub")
    expect((await b.db.journals.get(big.journalId))?.status).toBe("discarded")
    expect((await b.db.approvals.get(out.approvalId!))?.status).toBe("cancelled")
    expect(await b.db.events.where("type").equals("JournalDiscarded").count()).toBe(2)
  })

  it("never discards a posted voucher", async () => {
    const draft = await b.run(saveJournal, accrual(1_000_00, b.today), "mahbub")
    let row = await b.db.journals.get(draft.journalId)
    await b.run(submitJournal, { journalId: draft.journalId, expectedVersion: row!.version, idempotencyKey: key() }, "mahbub")
    row = await b.db.journals.get(draft.journalId)
    expect(await refusal(b.run(discardJournal, { journalId: draft.journalId, expectedVersion: row!.version }, "mahbub"))).toBe("JOURNAL_NOT_DRAFT")
  })
})

describe("fa.reverseJournal (R26)", () => {
  it("reverses a posted manual voucher with swapped lines, linked both ways", async () => {
    const draft = await b.run(saveJournal, accrual(9_000_00, b.today), "mahbub")
    let row = await b.db.journals.get(draft.journalId)
    await b.run(submitJournal, { journalId: draft.journalId, expectedVersion: row!.version, idempotencyKey: key() }, "mahbub")
    row = await b.db.journals.get(draft.journalId)
    const input = { journalId: draft.journalId, expectedVersion: row!.version, reason: "Posted twice", idempotencyKey: key() }
    expect(await refusal(b.run(reverseJournal, input, "mahbub"))).toBe("PERMISSION_DENIED")
    const out = await b.run(reverseJournal, input, "farzana")
    const original = await b.db.journals.get(draft.journalId)
    const reversal = await b.db.journals.get(out.journalId)
    expect(original?.status).toBe("reversed")
    expect(original?.reversedById).toBe(out.journalId)
    expect(reversal?.reversalOfId).toBe(draft.journalId)
    expect(reversal?.rule).toBe("R26")
    expect(reversal?.voucherType).toBe("JV")
    const lines = await b.db.journalLines.where("journalId").equals(out.journalId).toArray()
    expect(lines.find((l) => l.accountId === utilities)?.creditP).toBe(9_000_00)
    expect(lines.find((l) => l.accountId === accrued)?.debitP).toBe(9_000_00)
  })

  it("refuses to reverse a document's voucher (corrections are new documents)", async () => {
    const sales = await b.db.journals.where("voucherType").equals("SV").first()
    expect(
      await refusal(b.run(reverseJournal, { journalId: sales!.id, expectedVersion: sales!.version, reason: "Test reason", idempotencyKey: key() }, "farzana"))
    ).toBe("REVERSE_SOURCE_DOCUMENT")
  })

  it("leaves the books tied", async () => {
    expect((await booksTie(b.db)).balanced).toBe(true)
  })
})
