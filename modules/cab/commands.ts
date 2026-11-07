import { z } from "zod"

import { rules } from "@/config/rules.config"
import { requireApproval } from "@/core/approvals/approvals"
import { postPendingReceipt, releasePendingReceipt } from "@/core/ar/receipt"
import { notifyUser, queueSms } from "@/core/comms/sms"
import { generateStatement, MONTHLY_BANK_CHARGE_P } from "@/core/connectors/bank"
import { merchantFeeP } from "@/core/connectors/payments"
import { newId } from "@/core/db/ids"
import type { ChequeRow, ExpenseTag, Id, PettyCashVoucherRow, StatementLine } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { acct, postJournal } from "@/core/ledger/post"
import {
  linesForBankCharge,
  linesForContra,
  linesForPettyCash,
  linesForSettlement,
  RULE_VOUCHER,
} from "@/core/ledger/rules"
import { grantAllows, resolveSecurity } from "@/core/security/resolve"
import { formatDmy, formatMoney } from "@/lib/i18n/format"

import { releaseHoldIfWithinTerms, requireFunds, tagBalanceP } from "@/modules/ar/ledger"
import { taka } from "@/modules/ar/lib"

import { autoMatch, lineSettled, transferKind, type BookLine } from "./lib"

/**
 * CAB Cash & Bank commands (plan §6.2): contra transfers and petty cash
 * top-ups (R17), card and MFS settlements (R18), the cheque register
 * (received cheques clear with R10 or bounce; issued cheques are presented
 * and cleared), bank reconciliation with bank charges (R23), and petty cash
 * vouchers (R19, above the maker's limit they wait for approval).
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const HQ = "loc_hq"

/** The value, or refuse the commit with `code` (narrows for TypeScript). */
function must<T>(tx: Tx, value: T | undefined | null, code: string, params?: Record<string, string | number>): T {
  if (value === undefined || value === null) tx.reject(code, params)
  return value
}

async function openDate(tx: Tx, date: string): Promise<string> {
  const fiscal = await tx.fiscal(date)
  return fiscal.period?.status === "open" && fiscal.year?.status !== "closed" ? date : tx.today()
}

/* ================================================================== *
 * Transfers, top-ups, settlements
 * ================================================================== */

/** `cab.transferFunds`: contra between cash, bank, MFS and petty cash, incl. till deposits (R17). */
export const transferFunds = defineCommand({
  name: "cab.transferFunds",
  permission: "cab.transfer.create",
  input: z.object({
    fromAccountId: z.string(),
    toAccountId: z.string(),
    amountP: z.number().int().positive(),
    feesP: z.number().int().min(0).default(0),
    date: isoDay.optional(),
    ref: z.string().trim().optional(),
    idempotencyKey: z.string().min(4),
  }),
  async run(tx, input) {
    if (input.fromAccountId === input.toAccountId) tx.reject("SAME_ACCOUNT")
    const from = await tx.get("cashBankAccounts", input.fromAccountId)
    const to = await tx.get("cashBankAccounts", input.toAccountId)
    // Accounts without a location (banks, wallets) belong to Head Office for scope.
    tx.requireLocation(from.locationId ?? HQ)
    const date = input.date ?? tx.today()
    if (date > tx.today()) tx.reject("FUTURE_DATE", { date })
    await requireFunds(tx, from, input.amountP + input.feesP)
    const transferNo = await nextDocNo(tx, "CT", { date })
    const id = newId("ct")
    const kind = transferKind(from, to)
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R17,
      date,
      source: { app: "cab", docType: "fundTransfers", docId: id, docNo: transferNo },
      narration: `Contra ${transferNo}: ${from.nameEn} to ${to.nameEn}`,
      lines: linesForContra({
        fromTag: from.accountTag,
        toTag: to.accountTag,
        amountP: input.amountP,
        feesP: input.feesP,
        fromLocationId: from.locationId ?? HQ,
        toLocationId: to.locationId ?? HQ,
      }),
      rule: "R17",
    })
    tx.insert("fundTransfers", {
      id,
      transferNo,
      kind,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountP: input.amountP,
      feesP: input.feesP,
      date,
      ref: input.ref || undefined,
      journalId: journal.id,
    })
    tx.emit("FundsTransferred", {
      refs: { fundTransferId: id, journalId: journal.id },
      params: { no: transferNo, amount: taka(input.amountP), from: from.nameEn, to: to.nameEn },
      locationId: from.locationId ?? null,
    })
    return { transferId: id, transferNo }
  },
})

/** `cab.topUpPettyCash`: bring a petty cash box back to its imprest from a bank or till (R17). */
export const topUpPettyCash = defineCommand({
  name: "cab.topUpPettyCash",
  permission: "cab.pettycash.create",
  input: z.object({
    pettyAccountId: z.string(),
    fromAccountId: z.string(),
    amountP: z.number().int().positive().optional(),
    date: isoDay.optional(),
    idempotencyKey: z.string().min(4),
  }),
  async run(tx, input) {
    const petty = await tx.get("cashBankAccounts", input.pettyAccountId)
    if (petty.kind !== "petty-cash") tx.reject("NOT_PETTY_CASH", { account: petty.nameEn })
    tx.requireLocation(petty.locationId)
    const from = await tx.get("cashBankAccounts", input.fromAccountId)
    if (from.id === petty.id) tx.reject("SAME_ACCOUNT")
    tx.requireLocation(from.locationId ?? HQ)
    const balance = await tagBalanceP(tx, petty.accountTag)
    const amountP = input.amountP ?? (petty.imprestP ?? 0) - balance
    if (amountP <= 0) tx.reject("PETTY_AT_IMPREST", { account: petty.nameEn })
    await requireFunds(tx, from, amountP)
    const date = input.date ?? tx.today()
    const transferNo = await nextDocNo(tx, "CT", { date })
    const id = newId("ct")
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R17,
      date,
      source: { app: "cab", docType: "fundTransfers", docId: id, docNo: transferNo },
      narration: `Petty cash top-up ${transferNo}: ${petty.nameEn}`,
      lines: linesForContra({
        fromTag: from.accountTag,
        toTag: petty.accountTag,
        amountP,
        fromLocationId: from.locationId ?? HQ,
        toLocationId: petty.locationId ?? HQ,
      }),
      rule: "R17",
    })
    tx.insert("fundTransfers", {
      id,
      transferNo,
      kind: "top-up",
      fromAccountId: from.id,
      toAccountId: petty.id,
      amountP,
      feesP: 0,
      date,
      journalId: journal.id,
    })
    tx.emit("FundsTransferred", {
      refs: { fundTransferId: id, journalId: journal.id },
      params: { no: transferNo, amount: taka(amountP), from: from.nameEn, to: petty.nameEn },
      locationId: petty.locationId ?? null,
    })
    return { transferId: id, transferNo, amountP }
  },
})

const CLEARING_TAG = { card: "CARD_CLEARING", bkash: "MFS_BKASH", nagad: "MFS_NAGAD" } as const

/** `cab.recordSettlement`: card or MFS clearing to bank with merchant fees (R18). */
export const recordSettlement = defineCommand({
  name: "cab.recordSettlement",
  permission: "cab.settlement.create",
  input: z.object({
    kind: z.enum(["card", "bkash", "nagad"]),
    bankAccountId: z.string(),
    grossP: z.number().int().positive(),
    feesP: z.number().int().min(0).optional(),
    date: isoDay.optional(),
    ref: z.string().trim().min(2),
    idempotencyKey: z.string().min(4),
  }),
  async run(tx, input) {
    const [clearing] = await tx.list("cashBankAccounts", "accountTag", CLEARING_TAG[input.kind])
    if (!clearing) tx.reject("UNKNOWN_TAG", { tag: CLEARING_TAG[input.kind] })
    const bank = await tx.get("cashBankAccounts", input.bankAccountId)
    if (bank.kind !== "bank") tx.reject("ACCOUNT_METHOD_MISMATCH", { account: bank.nameEn })
    await requireFunds(tx, clearing, input.grossP)
    const feesP = input.feesP ?? merchantFeeP(input.kind, input.grossP)
    if (feesP >= input.grossP) tx.reject("FEES_TOO_HIGH")
    const date = input.date ?? tx.today()
    if (date > tx.today()) tx.reject("FUTURE_DATE", { date })
    const settlementNo = await nextDocNo(tx, "SET", { date })
    const id = newId("set")
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R18,
      date,
      source: { app: "cab", docType: "settlements", docId: id, docNo: settlementNo },
      narration: `Settlement ${settlementNo}: ${clearing.nameEn} to ${bank.nameEn}`,
      lines: linesForSettlement({ clearingTag: clearing.accountTag, bankTag: bank.accountTag, grossP: input.grossP, feesP, locationId: HQ }),
      rule: "R18",
    })
    tx.insert("settlements", {
      id,
      settlementNo,
      kind: input.kind,
      clearingAccountId: clearing.id,
      bankAccountId: bank.id,
      grossP: input.grossP,
      feesP,
      netP: input.grossP - feesP,
      date,
      ref: input.ref,
      journalId: journal.id,
    })
    tx.emit("SettlementRecorded", {
      refs: { settlementId: id, journalId: journal.id },
      params: { no: settlementNo, amount: taka(input.grossP) },
      locationId: HQ,
    })
    return { settlementId: id, settlementNo, feesP }
  },
})

/* ================================================================== *
 * Cheques
 * ================================================================== */

/**
 * `cab.updateCheque`: received cheques are deposited, then cleared (the
 * receipt posts R10, dated the clearing day) or bounced (nothing posts; the
 * reservation is released so the invoice is outstanding again; the customer
 * gets a notice). Issued cheques are presented, then cleared.
 */
export const updateCheque = defineCommand({
  name: "cab.updateCheque",
  permission: "cab.cheque.update",
  input: z.object({
    chequeId: z.string(),
    /** return: a received cheque still in hand given back to the customer (a reason is required; nothing posts) */
    action: z.enum(["deposit", "clear", "bounce", "present", "return"]),
    expectedVersion: z.number().int().optional(),
    /** The status the user acted on; a background touch (the PDC notice) is not a conflict */
    expectedStatus: z.enum(["in-hand", "deposited", "cleared", "bounced", "issued", "presented", "cancelled"]).optional(),
    reason: z.string().trim().default(""),
  }),
  async run(tx, input) {
    const cheque = await tx.get("cheques", input.chequeId, { expectedVersion: input.expectedVersion })
    if (input.expectedStatus && cheque.status !== input.expectedStatus) tx.reject("CHEQUE_STATUS", { no: cheque.chequeNo, status: cheque.status })
    const party = await tx.get("parties", cheque.partyId)
    const today = tx.today()
    const move = (from: ChequeRow["status"][], to: ChequeRow["status"]) => {
      if (!from.includes(cheque.status)) tx.reject("CHEQUE_STATUS", { no: cheque.chequeNo, status: cheque.status })
      return to
    }
    let status: ChequeRow["status"] = cheque.status
    if (cheque.direction === "received") {
      if (input.action === "present") tx.reject("CHEQUE_STATUS", { no: cheque.chequeNo, status: cheque.status })
      if (input.action === "return") {
        status = move(["in-hand"], "cancelled")
        if (input.reason.length < 3) tx.reject("CHEQUE_RETURN_REASON", { no: cheque.chequeNo })
        if (cheque.receiptId) await releasePendingReceipt(tx, cheque.receiptId, "returned")
      } else if (input.action === "deposit") {
        status = move(["in-hand"], "deposited")
        if (cheque.chequeDate > today) tx.reject("PDC_NOT_DUE", { no: cheque.chequeNo, date: cheque.chequeDate })
      } else if (input.action === "clear") {
        status = move(["deposited"], "cleared")
        if (cheque.receiptId) {
          await postPendingReceipt(tx, cheque.receiptId, { rule: "R10", date: today })
          await releaseHoldIfWithinTerms(tx, party.id)
        }
      } else {
        status = move(["in-hand", "deposited"], "bounced")
        if (cheque.receiptId) await releasePendingReceipt(tx, cheque.receiptId, "bounced")
        if (party.phone && party.segment !== "walk-in") {
          queueSms(tx, {
            to: party.phone,
            partyId: party.id,
            lang: "en",
            templateId: "cheque-bounced",
            params: { chequeNo: cheque.chequeNo, amount: formatMoney(cheque.amountP, "en"), date: formatDmy(cheque.chequeDate, "en") },
          })
        }
      }
    } else {
      if (input.action === "return") tx.reject("CHEQUE_STATUS", { no: cheque.chequeNo, status: cheque.status })
      if (input.action === "present") status = move(["issued"], "presented")
      else if (input.action === "clear") status = move(["presented"], "cleared")
      else tx.reject("CHEQUE_STATUS", { no: cheque.chequeNo, status: cheque.status })
    }
    await tx.update("cheques", cheque.id, {
      status,
      history: [...cheque.history, { status, at: tx.now(), by: tx.actor.userId }],
    })
    if (input.reason) tx.auditContext({ reason: input.reason })
    const event =
      status === "deposited" || status === "presented"
        ? "ChequeDeposited"
        : status === "cleared"
          ? "ChequeCleared"
          : status === "cancelled"
            ? "ChequeReturned"
            : "ChequeBounced"
    tx.emit(event, {
      refs: { chequeId: cheque.id, partyId: party.id, ...(cheque.receiptId ? { receiptId: cheque.receiptId } : {}), ...(cheque.paymentId ? { paymentId: cheque.paymentId } : {}) },
      params: { no: cheque.chequeNo, amount: taka(cheque.amountP), party: party.nameEn },
      locationId: HQ,
    })
    return { status }
  },
})

/**
 * `cab.markPdcNotices` (system, the `cab.pdcDue` job): post-dated cheques
 * due within `rules.pdcWarnDays` raise ONE notice to the users who handle
 * cheques (`cheques.dueNoticeAt`).
 */
export const markPdcNotices = defineCommand({
  name: "cab.markPdcNotices",
  permission: "system",
  input: z.object({ chequeIds: z.array(z.string()) }),
  async run(tx, input) {
    const users = await tx.db.users.where("status").equals("active").toArray()
    const recipients: Id[] = []
    for (const u of users) {
      const security = await resolveSecurity(tx.db, u.id)
      if (grantAllows(security, "cab.cheque.update", u.locationIds) && !security.all) recipients.push(u.id)
    }
    let count = 0
    for (const id of input.chequeIds) {
      const cheque = await tx.get("cheques", id)
      if (cheque.dueNoticeAt || cheque.status !== "in-hand" || cheque.direction !== "received") continue
      const party = await tx.get("parties", cheque.partyId)
      await tx.update("cheques", cheque.id, { dueNoticeAt: tx.now() })
      for (const userId of recipients) {
        notifyUser(tx, {
          userId,
          kind: "pdc-due",
          titleKey: "cab.notify.pdcDue",
          params: { no: cheque.chequeNo, party: party.code, amount: taka(cheque.amountP), date: cheque.chequeDate },
          refs: { chequeId: cheque.id, partyId: party.id },
          href: `/cab/cheques?id=${cheque.id}`,
        })
      }
      count += 1
    }
    return { count }
  },
})

/* ================================================================== *
 * Reconciliation
 * ================================================================== */

/** Book lines on a bank account's GL, unreconciled, within a date window. */
async function bookLines(tx: Tx, accountTag: Parameters<typeof acct>[1], from: string, to: string): Promise<BookLine[]> {
  const glId = await acct(tx, accountTag)
  const lines = (await tx.list("journalLines", "accountId", glId)).filter((l) => l.date >= from && l.date <= to)
  const journals = new Map<string, { journalNo: string; ref: string }>()
  const out: BookLine[] = []
  for (const l of lines) {
    if (l.reconciledStatementLineId) continue
    let j = journals.get(l.journalId)
    if (!j) {
      const row = await tx.get("journals", l.journalId)
      j = { journalNo: row.journalNo, ref: row.source?.docNo || row.journalNo }
      journals.set(l.journalId, j)
    }
    out.push({ id: l.id, date: l.date, amountP: l.debitP - l.creditP, ref: j.ref, journalNo: j.journalNo })
  }
  return out
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function setLines(tx: Tx, statementId: Id, lines: StatementLine[]) {
  await tx.update("bankStatements", statementId, { lines })
}

/**
 * `cab.importStatement`: a simulated bank statement file for a period
 * (core/connectors/bank.ts), by default with the month's ৳575 maintenance
 * charge the books do not have yet. An earlier statement of the same
 * account and period is superseded and its matches cleared.
 */
export const importStatement = defineCommand({
  name: "cab.importStatement",
  permission: "cab.reconcile",
  input: z.object({
    cashBankAccountId: z.string(),
    fromDate: isoDay,
    toDate: isoDay,
    includeCharge: z.boolean().default(true),
    extra: z.array(z.object({ date: isoDay, description: z.string(), ref: z.string(), amountP: z.number().int() })).default([]),
    redate: z.record(z.string(), isoDay).default({}),
    omit: z.array(z.string()).default([]),
  }),
  async run(tx, input) {
    const account = await tx.get("cashBankAccounts", input.cashBankAccountId)
    if (account.kind !== "bank") tx.reject("NOT_A_BANK", { account: account.nameEn })
    if (input.fromDate > input.toDate || input.toDate > tx.today()) tx.reject("BAD_PERIOD")
    const existing = (await tx.list("bankStatements", "cashBankAccountId", account.id)).filter(
      (s) => s.status !== "superseded" && s.fromDate <= input.toDate && s.toDate >= input.fromDate
    )
    for (const s of existing) {
      for (const line of s.lines) {
        for (const jl of line.matchedJournalLineIds) {
          const row = await tx.find("journalLines", jl)
          if (row && row.reconciledStatementLineId === line.lineId) {
            await tx.update("journalLines", jl, { reconciledStatementLineId: undefined })
          }
        }
      }
      await tx.update("bankStatements", s.id, { status: "superseded" })
    }
    const charge = input.includeCharge
      ? [
          {
            date: input.toDate,
            description: "Account maintenance and SMS charge",
            ref: `SC${input.toDate.slice(2, 4)}${input.toDate.slice(5, 7)}`,
            amountP: -MONTHLY_BANK_CHARGE_P,
          },
        ]
      : []
    const file = await generateStatement(tx.db, {
      cashBankAccountId: account.id,
      fromDate: input.fromDate,
      toDate: input.toDate,
      extra: [...charge, ...input.extra],
      redate: input.redate,
      omit: input.omit,
    })
    const id = newId("bst")
    const stamp = tx.commitId.slice(-6)
    tx.insert("bankStatements", {
      id,
      cashBankAccountId: account.id,
      fromDate: file.fromDate,
      toDate: file.toDate,
      fileName: file.fileName,
      importedAt: tx.now(),
      status: "imported",
      openingBalanceP: file.openingBalanceP,
      closingBalanceP: file.closingBalanceP,
      // Line ids are unique per import, so a superseded file never shares one.
      lines: file.lines.map((l) => ({ ...l, lineId: `${l.lineId}_${stamp}`, matchedJournalLineIds: [] })),
    })
    tx.emit("StatementImported", {
      refs: { statementId: id },
      params: { account: account.nameEn, count: file.lines.length },
      locationId: HQ,
    })
    return { statementId: id, lines: file.lines.length, superseded: existing.length }
  },
})

async function openStatement(tx: Tx, statementId: Id, expectedVersion?: number) {
  const statement = await tx.get("bankStatements", statementId, { expectedVersion })
  if (statement.status !== "imported") tx.reject("STATEMENT_CLOSED", { file: statement.fileName })
  const account = await tx.get("cashBankAccounts", statement.cashBankAccountId)
  return { statement, account }
}

/** `cab.autoMatch`: match every line by amount, date (± rules.reconMatchDays) and reference. */
export const autoMatchStatement = defineCommand({
  name: "cab.autoMatch",
  permission: "cab.reconcile",
  input: z.object({ statementId: z.string(), expectedVersion: z.number().int().optional() }),
  async run(tx, input) {
    const { statement, account } = await openStatement(tx, input.statementId, input.expectedVersion)
    const days = rules.reconMatchDays
    const book = await bookLines(tx, account.accountTag, shiftDays(statement.fromDate, -days), shiftDays(statement.toDate, days))
    const pairs = autoMatch(statement.lines, book, days)
    const byLine = new Map(pairs.map((p) => [p.lineId, p.journalLineId]))
    const lines = statement.lines.map((l) => {
      const jl = byLine.get(l.lineId)
      return jl ? { ...l, matchedJournalLineIds: [jl], matchedBy: "auto" as const } : l
    })
    for (const p of pairs) await tx.update("journalLines", p.journalLineId, { reconciledStatementLineId: p.lineId })
    await setLines(tx, statement.id, lines)
    if (pairs.length) {
      tx.emit("StatementLineMatched", { refs: { statementId: statement.id }, params: { count: pairs.length }, locationId: HQ })
    }
    return { matched: pairs.length, open: lines.filter((l) => !lineSettled(l)).length }
  },
})

/** `cab.matchLine`: match one statement line by hand to book lines whose amounts add up to it. */
export const matchLine = defineCommand({
  name: "cab.matchLine",
  permission: "cab.reconcile",
  input: z.object({ statementId: z.string(), lineId: z.string(), journalLineIds: z.array(z.string()).min(1) }),
  async run(tx, input) {
    const { statement, account } = await openStatement(tx, input.statementId)
    const line = must(tx, statement.lines.find((l) => l.lineId === input.lineId), "LINE_NOT_FOUND")
    if (lineSettled(line)) tx.reject("LINE_ALREADY_MATCHED")
    const glId = await acct(tx, account.accountTag)
    let sum = 0
    for (const id of input.journalLineIds) {
      const jl = await tx.get("journalLines", id)
      if (jl.accountId !== glId) tx.reject("WRONG_ACCOUNT_LINE")
      if (jl.reconciledStatementLineId) tx.reject("BOOK_LINE_RECONCILED")
      sum += jl.debitP - jl.creditP
      await tx.update("journalLines", id, { reconciledStatementLineId: line.lineId })
    }
    if (sum !== line.amountP) tx.reject("MATCH_AMOUNT", { lineP: line.amountP, bookP: sum })
    await setLines(
      tx,
      statement.id,
      statement.lines.map((l) => (l.lineId === line.lineId ? { ...l, matchedJournalLineIds: input.journalLineIds, matchedBy: "manual" as const } : l))
    )
    tx.emit("StatementLineMatched", { refs: { statementId: statement.id }, params: { count: 1 }, locationId: HQ })
    return { matched: 1 }
  },
})

/** `cab.unmatchLine`: undo a match (or an explanation) before completion. */
export const unmatchLine = defineCommand({
  name: "cab.unmatchLine",
  permission: "cab.reconcile",
  input: z.object({ statementId: z.string(), lineId: z.string() }),
  async run(tx, input) {
    const { statement } = await openStatement(tx, input.statementId)
    const line = must(tx, statement.lines.find((l) => l.lineId === input.lineId), "LINE_NOT_FOUND")
    if (line.matchedBy === "charge") tx.reject("CHARGE_POSTED")
    for (const id of line.matchedJournalLineIds) {
      const jl = await tx.find("journalLines", id)
      if (jl?.reconciledStatementLineId === line.lineId) await tx.update("journalLines", id, { reconciledStatementLineId: undefined })
    }
    await setLines(
      tx,
      statement.id,
      statement.lines.map((l) => (l.lineId === line.lineId ? { ...l, matchedJournalLineIds: [], matchedBy: undefined, note: undefined } : l))
    )
    return { ok: true }
  },
})

/** `cab.explainLine`: settle a line without a book entry, with a note (e.g. a timing difference). */
export const explainLine = defineCommand({
  name: "cab.explainLine",
  permission: "cab.reconcile",
  input: z.object({ statementId: z.string(), lineId: z.string(), note: z.string().trim().min(3) }),
  async run(tx, input) {
    const { statement } = await openStatement(tx, input.statementId)
    const line = must(tx, statement.lines.find((l) => l.lineId === input.lineId), "LINE_NOT_FOUND")
    if (line.matchedJournalLineIds.length) tx.reject("LINE_ALREADY_MATCHED")
    await setLines(tx, statement.id, statement.lines.map((l) => (l.lineId === line.lineId ? { ...l, note: input.note } : l)))
    tx.auditContext({ reason: input.note })
    return { ok: true }
  },
})

/**
 * `cab.postBankCharge`: post an unmatched bank charge (R23), dated the
 * statement line's date when its period is open, otherwise today, and match
 * the line to it.
 */
export const postBankCharge = defineCommand({
  name: "cab.postBankCharge",
  permission: "cab.reconcile",
  input: z.object({ statementId: z.string(), lineId: z.string() }),
  async run(tx, input) {
    const { statement, account } = await openStatement(tx, input.statementId)
    const line = must(tx, statement.lines.find((l) => l.lineId === input.lineId), "LINE_NOT_FOUND")
    if (lineSettled(line)) tx.reject("LINE_ALREADY_MATCHED")
    if (line.amountP >= 0) tx.reject("NOT_A_CHARGE")
    const date = await openDate(tx, line.date)
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R23,
      date,
      source: { app: "cab", docType: "bankStatements", docId: statement.id, docNo: statement.fileName.replace(/\.csv$/, "") },
      narration: `${line.description || "Bank charge"} (bank statement)`,
      lines: linesForBankCharge({ bankTag: account.accountTag, amountP: -line.amountP, locationId: HQ }),
      rule: "R23",
    })
    const glId = await acct(tx, account.accountTag)
    const bankLine = must(tx, (await tx.list("journalLines", "journalId", journal.id)).find((l) => l.accountId === glId), "LINE_NOT_FOUND")
    await tx.update("journalLines", bankLine.id, { reconciledStatementLineId: line.lineId })
    await setLines(
      tx,
      statement.id,
      statement.lines.map((l) => (l.lineId === line.lineId ? { ...l, matchedJournalLineIds: [bankLine.id], matchedBy: "charge" as const } : l))
    )
    tx.emit("StatementLineMatched", { refs: { statementId: statement.id, journalId: journal.id }, params: { count: 1 }, locationId: HQ })
    return { journalId: journal.id, date }
  },
})

/** `cab.completeReconciliation`: when every line is matched or explained. */
export const completeReconciliation = defineCommand({
  name: "cab.completeReconciliation",
  permission: "cab.reconcile",
  input: z.object({ statementId: z.string() }),
  async run(tx, input) {
    const { statement, account } = await openStatement(tx, input.statementId)
    const open = statement.lines.filter((l) => !lineSettled(l)).length
    if (open) tx.reject("RECON_OPEN_LINES", { count: open })
    await tx.update("bankStatements", statement.id, { status: "reconciled", reconciledAt: tx.now(), reconciledBy: tx.actor.userId })
    tx.emit("ReconciliationCompleted", { refs: { statementId: statement.id }, params: { account: account.nameEn }, locationId: HQ })
    return { ok: true }
  },
})

/* ================================================================== *
 * Petty cash
 * ================================================================== */

export const PETTY_TAGS: ExpenseTag[] = ["CONVEYANCE", "WELFARE", "OFFICE", "REPAIRS", "MARKETING", "TELECOM", "UTILITIES"]

/** Post a petty cash voucher (R19). Used within limit and by the approval. */
export async function postPettyCash(tx: Tx, voucherId: Id, opts: { approvalId?: Id } = {}): Promise<PettyCashVoucherRow> {
  const v = await tx.get("pettyCashVouchers", voucherId)
  if (v.status !== "pending-approval") tx.reject("VOUCHER_NOT_PENDING", { no: v.voucherNo })
  const account = await tx.get("cashBankAccounts", v.cashBankAccountId)
  await requireFunds(tx, account, v.amountP)
  const date = await openDate(tx, v.date)
  const location = await tx.get("locations", v.locationId)
  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER.R19,
    date,
    source: { app: "cab", docType: "pettyCashVouchers", docId: v.id, docNo: v.voucherNo },
    narration: `Petty cash ${v.voucherNo}: ${v.payee}, ${v.description}`,
    lines: linesForPettyCash({ pettyTag: account.accountTag, expenseTag: v.expenseTag, amountP: v.amountP, locationId: v.locationId, costCentreId: location.costCentreId }),
    rule: "R19",
    approvalId: opts.approvalId,
    preparedBy: v.preparedBy,
  })
  const posted = await tx.update("pettyCashVouchers", v.id, { status: "posted", date, journalId: journal.id, approvalId: opts.approvalId ?? v.approvalId })
  tx.emit("PettyCashSpent", {
    refs: { pettyCashVoucherId: v.id, journalId: journal.id },
    params: { no: v.voucherNo, amount: taka(v.amountP) },
    locationId: v.locationId,
  })
  return posted
}

/** `cab.pettyCashVoucher`: an expense from petty cash; within the maker's `petty-cash` limit it posts R19, else it is queued. */
export const pettyCashVoucher = defineCommand({
  name: "cab.pettyCashVoucher",
  permission: "cab.pettycash.create",
  input: z.object({
    cashBankAccountId: z.string(),
    date: isoDay.optional(),
    expenseTag: z.enum(PETTY_TAGS as [ExpenseTag, ...ExpenseTag[]]),
    amountP: z.number().int().positive(),
    payee: z.string().trim().min(2),
    description: z.string().trim().min(2),
    idempotencyKey: z.string().min(4),
  }),
  async run(tx, input) {
    const account = await tx.get("cashBankAccounts", input.cashBankAccountId)
    if (account.kind !== "petty-cash") tx.reject("NOT_PETTY_CASH", { account: account.nameEn })
    const locationId = must(tx, account.locationId, "NOT_PETTY_CASH", { account: account.nameEn })
    tx.requireLocation(locationId)
    const date = input.date ?? tx.today()
    if (date > tx.today()) tx.reject("FUTURE_DATE", { date })
    const voucherNo = await nextDocNo(tx, "PCV", { location: locationId, date })
    const voucher = tx.insert("pettyCashVouchers", {
      voucherNo,
      cashBankAccountId: account.id,
      locationId,
      date,
      expenseTag: input.expenseTag,
      amountP: input.amountP,
      payee: input.payee,
      description: input.description,
      status: "pending-approval",
      preparedBy: tx.actor.userId,
    })
    const outcome = await requireApproval(tx, {
      kind: "petty-cash",
      docType: "pettyCashVouchers",
      docId: voucher.id,
      docNo: voucherNo,
      locationId,
      amountP: input.amountP,
      reason: `${input.payee}: ${input.description}`,
    })
    if (outcome.status === "pending") {
      await tx.update("pettyCashVouchers", voucher.id, { approvalId: outcome.approvalId })
      return { voucherId: voucher.id, voucherNo, status: "pending-approval" as const, approvalId: outcome.approvalId }
    }
    await postPettyCash(tx, voucher.id, { approvalId: outcome.status === "approved" ? outcome.approvalId : undefined })
    return { voucherId: voucher.id, voucherNo, status: "posted" as const }
  },
})
