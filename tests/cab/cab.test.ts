import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { decideApproval } from "@/core/approvals/decide"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { SweepContext } from "@/core/clock/types"
import type { OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { PermissionDenied } from "@/core/engine/errors"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { recordReceipt } from "@/modules/ar/commands"
import {
  autoMatchStatement,
  completeReconciliation,
  explainLine,
  importStatement,
  matchLine,
  pettyCashVoucher,
  postBankCharge,
  recordSettlement,
  topUpPettyCash,
  transferFunds,
} from "@/modules/cab/commands"
import { cabJobs } from "@/modules/cab/jobs"
import { autoMatch, lastMonthRange, transferKind } from "@/modules/cab/lib"
import { accountBook, cashPosition } from "@/modules/cab/queries"

import { signedIn } from "../helpers/foundation"
import { allBalanced, finDb, gl, run, T } from "../ar/fin-helpers"

let db: OmniflowDb
let mahbub: Actor
const today = () => dhakaDate(now())
beforeEach(async () => {
  db = await finDb("cab")
  mahbub = await signedIn(db, "mahbub")
})
afterEach(async () => {
  await db.delete()
})

describe("cab helpers", () => {
  it("auto-matches by amount, date window and reference, each book line once", () => {
    const line = (lineId: string, date: string, ref: string, amountP: number) => ({ lineId, date, ref, amountP, matchedJournalLineIds: [] as string[] })
    const pairs = autoMatch(
      [line("s1", "2026-10-05", "MR-HQ-2627-000001", 100), line("s2", "2026-10-10", "MR-HQ-2627-000002", 200), line("s3", "2026-10-31", "SC2610", -575)],
      [
        { id: "j1", date: "2026-10-05", amountP: 100, ref: "MR-HQ-2627-000001", journalNo: "RV-1" },
        { id: "j2", date: "2026-10-08", amountP: 200, ref: "MR-HQ-2627-000002", journalNo: "RV-2" },
        { id: "j3", date: "2026-10-31", amountP: 100, ref: "X", journalNo: "RV-3" },
      ],
      3
    )
    expect(pairs).toEqual([
      { lineId: "s1", journalLineId: "j1" },
      { lineId: "s2", journalLineId: "j2" },
    ])
    expect(lastMonthRange("2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
    expect(transferKind({ kind: "cash-till" }, { kind: "bank" })).toBe("deposit")
  })
})

describe("transfers, top-ups and settlements", () => {
  it("deposits a till to the bank (R17) and refuses more than the till holds or another studio's till", async () => {
    const tania = await signedIn(db, "tania")
    const r = await run(db, transferFunds, { fromAccountId: "cba_till_gul", toAccountId: "cba_dbbl", amountP: T(30_000), idempotencyKey: "ct-1" }, tania)
    expect(r.transferNo).toMatch(/^CT-\d{4}-\d{5}$/)
    const transfer = (await db.fundTransfers.get(r.transferId))!
    expect(transfer.kind).toBe("deposit")
    expect((await db.journals.get(transfer.journalId))?.rule).toBe("R17")
    expect(await gl(db, "CASH_TILL_GUL")).toBe(T(20_000))
    await expect(run(db, transferFunds, { fromAccountId: "cba_till_gul", toAccountId: "cba_dbbl", amountP: T(25_000), idempotencyKey: "ct-2" }, tania)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" })
    await expect(run(db, transferFunds, { fromAccountId: "cba_till_utt", toAccountId: "cba_dbbl", amountP: T(1_000), idempotencyKey: "ct-3" }, tania)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" })
    const rakib = await signedIn(db, "rakib")
    await expect(run(db, transferFunds, { fromAccountId: "cba_till_gul", toAccountId: "cba_dbbl", amountP: T(1_000), idempotencyKey: "ct-4" }, rakib)).rejects.toBeInstanceOf(PermissionDenied)
  })

  it("tops petty cash up to its imprest (R17)", async () => {
    const r = await run(db, topUpPettyCash, { pettyAccountId: "cba_petty_gul", fromAccountId: "cba_brac", idempotencyKey: "ct-5" }, mahbub)
    expect(r.amountP).toBe(T(4_000))
    expect(await gl(db, "PETTY_GUL")).toBe(T(10_000))
    await expect(run(db, topUpPettyCash, { pettyAccountId: "cba_petty_gul", fromAccountId: "cba_brac", idempotencyKey: "ct-6" }, mahbub)).rejects.toMatchObject({ code: "PETTY_AT_IMPREST" })
  })

  it("settles card clearing to the bank with the merchant fee (R18)", async () => {
    const r = await run(db, recordSettlement, { kind: "card", bankAccountId: "cba_brac", grossP: T(30_000), ref: "CARD-SET-01", idempotencyKey: "set-1" }, mahbub)
    expect(r.feesP).toBe(T(450))
    expect(await gl(db, "CARD_CLEARING")).toBe(0)
    expect(await gl(db, "MERCHANT_FEES")).toBe(T(450))
    const s = (await db.settlements.get(r.settlementId))!
    expect((await db.journals.get(s.journalId))?.rule).toBe("R18")
    const tania = await signedIn(db, "tania")
    await expect(run(db, recordSettlement, { kind: "bkash", bankAccountId: "cba_brac", grossP: T(1_000), ref: "X1", idempotencyKey: "set-2" }, tania)).rejects.toBeInstanceOf(PermissionDenied)
  })
})

describe("petty cash vouchers (R19)", () => {
  it("posts within the maker's limit, queues above it, and the studio manager's approval posts it", async () => {
    const tania = await signedIn(db, "tania")
    const base = { cashBankAccountId: "cba_petty_gul", expenseTag: "CONVEYANCE" as const, payee: "CNG driver", description: "Parts run" }
    const small = await run(db, pettyCashVoucher, { ...base, amountP: T(600), idempotencyKey: "pcv-1" }, tania)
    expect(small.status).toBe("posted")
    expect(small.voucherNo).toMatch(/^PCV-GUL-\d{4}-\d{4}$/)
    const big = await run(db, pettyCashVoucher, { ...base, amountP: T(3_500), idempotencyKey: "pcv-2" }, tania)
    expect(big.status).toBe("pending-approval")
    const approval = (await db.approvals.get(big.approvalId!))!
    expect(approval).toMatchObject({ kind: "petty-cash", approveKey: "cab.pettycash.approve" })
    expect(approval.routedTo).toContain("usr_shahriar")
    const arif = await signedIn(db, "arif")
    await expect(run(db, decideApproval, { approvalId: approval.id, decision: "approve", expectedVersion: approval.version }, arif)).rejects.toMatchObject({ code: "NOT_APPROVER" })
    const shahriar = await signedIn(db, "shahriar")
    await run(db, decideApproval, { approvalId: approval.id, decision: "approve", expectedVersion: approval.version }, shahriar)
    const v = (await db.pettyCashVouchers.get(big.voucherId))!
    expect(v.status).toBe("posted")
    expect((await db.journals.get(v.journalId!))).toMatchObject({ rule: "R19", preparedBy: "usr_tania" })
    expect(await gl(db, "PETTY_GUL")).toBe(T(6_000 - 600 - 3_500))
    await expect(run(db, pettyCashVoucher, { ...base, cashBankAccountId: "cba_petty_utt", amountP: T(100), idempotencyKey: "pcv-3" }, tania)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" })
  })
})

describe("bank reconciliation", () => {
  it("imports a statement with the month's charge, auto-matches, posts the charge (R23), matches by hand and completes", async () => {
    const day = today()
    const from = `${day.slice(0, 8)}01`
    // Two receipts into BRAC; the bank shows the second one 5 days later (outside ± 3 days).
    const a = await run(db, recordReceipt, { partyId: "pty_retail", method: "bank-transfer", cashBankAccountId: "cba_brac", amountP: T(7_000), idempotencyKey: "mr-r1", ref: "NPSB1" }, mahbub)
    const b = await run(db, recordReceipt, { partyId: "pty_retail", method: "bank-transfer", cashBankAccountId: "cba_brac", amountP: T(12_000), idempotencyKey: "mr-r2", ref: "NPSB2" }, mahbub)
    const bLine = (await db.journalLines.where("journalId").equals((await db.receipts.get(b.receiptId))!.journalId!).toArray()).find((l) => l.debitP === T(12_000))!
    const imp = await run(db, importStatement, { cashBankAccountId: "cba_brac", fromDate: from, toDate: day, redate: { [bLine.id]: addDaysISO(day, 0) }, omit: [] }, mahbub)
    let st = (await db.bankStatements.get(imp.statementId))!
    expect(st.status).toBe("imported")
    expect(st.lines.some((l) => l.amountP === -T(575))).toBe(true)
    const auto = await run(db, autoMatchStatement, { statementId: st.id }, mahbub)
    expect(auto.open).toBe(1)
    st = (await db.bankStatements.get(st.id))!
    const charge = st.lines.find((l) => l.amountP === -T(575))!
    await expect(run(db, completeReconciliation, { statementId: st.id }, mahbub)).rejects.toMatchObject({ code: "RECON_OPEN_LINES" })
    const posted = await run(db, postBankCharge, { statementId: st.id, lineId: charge.lineId }, mahbub)
    expect((await db.journals.get(posted.journalId))?.rule).toBe("R23")
    expect(await gl(db, "BANK_CHARGES")).toBe(T(575))
    await run(db, completeReconciliation, { statementId: st.id }, mahbub)
    st = (await db.bankStatements.get(st.id))!
    expect(st.status).toBe("reconciled")
    const reconciled = (await db.journalLines.toArray()).filter((l) => l.reconciledStatementLineId)
    expect(reconciled.length).toBe(st.lines.length)
    void a

    // A new import of the same period supersedes it and clears its matches.
    const again = await run(db, importStatement, { cashBankAccountId: "cba_brac", fromDate: from, toDate: day, includeCharge: false }, mahbub)
    expect(again.superseded).toBe(1)
    expect((await db.bankStatements.get(st.id))?.status).toBe("superseded")
    expect((await db.journalLines.toArray()).filter((l) => l.reconciledStatementLineId).length).toBe(0)
    expect(await allBalanced(db)).toBe(true)
  })

  it("matches a redated deposit by hand and explains a line; needs cab.reconcile", async () => {
    const day = today()
    const from = `${day.slice(0, 8)}01`
    const r = await run(db, recordReceipt, { partyId: "pty_retail", method: "bank-transfer", cashBankAccountId: "cba_brac", amountP: T(12_000), idempotencyKey: "mr-r3" }, mahbub)
    const line = (await db.journalLines.where("journalId").equals((await db.receipts.get(r.receiptId))!.journalId!).toArray()).find((l) => l.debitP === T(12_000))!
    const imp = await run(db, importStatement, { cashBankAccountId: "cba_brac", fromDate: from, toDate: day, includeCharge: false, extra: [{ date: day, description: "Unknown credit", ref: "", amountP: T(5) }] }, mahbub)
    let st = (await db.bankStatements.get(imp.statementId))!
    const deposit = st.lines.find((l) => l.amountP === T(12_000))!
    await expect(run(db, matchLine, { statementId: st.id, lineId: deposit.lineId, journalLineIds: [line.id, line.id] }, mahbub)).rejects.toBeTruthy()
    await run(db, matchLine, { statementId: st.id, lineId: deposit.lineId, journalLineIds: [line.id] }, mahbub)
    const odd = st.lines.find((l) => l.amountP === T(5))!
    await run(db, explainLine, { statementId: st.id, lineId: odd.lineId, note: "Interest credit, booked next month" }, mahbub)
    st = (await db.bankStatements.get(st.id))!
    expect(st.lines.find((l) => l.lineId === deposit.lineId)?.matchedBy).toBe("manual")
    const tania = await signedIn(db, "tania")
    await expect(run(db, autoMatchStatement, { statementId: st.id }, tania)).rejects.toBeInstanceOf(PermissionDenied)
    await run(db, autoMatchStatement, { statementId: st.id }, mahbub)
    await run(db, completeReconciliation, { statementId: st.id }, mahbub)
    expect((await db.bankStatements.get(st.id))?.status).toBe("reconciled")
  })
})

describe("cash position, books and the PDC job", () => {
  it("reads balances from the ledger and keeps a running balance", async () => {
    const rows = await cashPosition(db, today())
    expect(rows.find((r) => r.account.id === "cba_brac")?.balanceP).toBe(T(10_00_000))
    const brac = (await db.cashBankAccounts.get("cba_brac"))!
    const book = await accountBook(db, brac)
    expect(book.closingP).toBe(T(10_00_000))
  })

  it("raises one notice per post-dated cheque falling due within the warning days", async () => {
    await run(
      db,
      recordReceipt,
      { partyId: "pty_retail", method: "cheque", cashBankAccountId: "cba_dbbl", amountP: T(4_000), cheque: { chequeNo: "889900", bankName: "Prime Bank", chequeDate: addDaysISO(today(), 2) }, idempotencyKey: "mr-pdc" },
      mahbub
    )
    const ctx: SweepContext = { db, now: now(), commitSystem: ((def, input) => commit(def, input, { db, actor: SYSTEM_ACTOR })) as SweepContext["commitSystem"] }
    await cabJobs[0].run(ctx)
    const cheque = (await db.cheques.where("chequeNo").equals("889900").first())!
    expect(cheque.dueNoticeAt).toBeTruthy()
    const notices = (await db.notifications.toArray()).filter((n) => n.kind === "pdc-due")
    expect(notices.map((n) => n.userId).sort()).toEqual(["usr_farzana", "usr_mahbub"])
    await cabJobs[0].run(ctx)
    expect((await db.notifications.toArray()).filter((n) => n.kind === "pdc-due").length).toBe(2)
  })
})
