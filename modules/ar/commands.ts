import { z } from "zod"

import { rules } from "@/config/rules.config"
import { createReceipt } from "@/core/ar/receipt"
import { queueSms } from "@/core/comms/sms"
import { newId } from "@/core/db/ids"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForRefund, RULE_VOUCHER } from "@/core/ledger/rules"
import { formatDmy, formatMoney } from "@/lib/i18n/format"

import { daysPastDue, invoiceOpenP, taka } from "./lib"
import { accountFitsMethod, customerAdvanceP, releaseHoldIfWithinTerms, requireFunds } from "./ledger"

/**
 * AR Accounts Receivable commands (plan §6.2): customer receipts (R8, or a
 * cheque in hand until it clears with R10), refunds of advances (R28),
 * payment reminders by SMS, and the automatic credit hold (plan §3.13).
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

function canSms(party: { phone: string; segment: string }) {
  return !!party.phone && party.segment !== "walk-in"
}

/** The receipt's location: the given one, else the actor's current one, else Head Office. */
function receiptLocation(tx: Tx, locationId?: string) {
  return locationId ?? tx.actor.locationId ?? "loc_hq"
}

export const recordReceiptInput = z.object({
  partyId: z.string(),
  locationId: z.string().optional(),
  date: isoDay.optional(),
  method: z.enum(["cash", "card", "bkash", "nagad", "bank-transfer", "cheque"]),
  cashBankAccountId: z.string().optional(),
  /** Money received, net of the customer's deductions */
  amountP: z.number().int().min(0),
  allocations: z.array(z.object({ invoiceId: z.string(), amountP: z.number().int().positive() })).default([]),
  vdsDeductedP: z.number().int().min(0).default(0),
  aitDeductedP: z.number().int().min(0).default(0),
  certificateNo: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  ref: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  cheque: z
    .object({ chequeNo: z.string().trim().min(3), bankName: z.string().trim().min(2), chequeDate: isoDay })
    .optional(),
  /** bKash/Nagad: the simulated push was approved in the dialog */
  confirmed: z.boolean().optional(),
  idempotencyKey: z.string().min(4),
})

/**
 * `ar.recordReceipt`: allocated to open invoices (oldest first in the UI,
 * editable), the rest as advance; VDS and AIT the customer deducted with the
 * certificate number. Cash, card, bank transfer and confirmed MFS post R8 at
 * once; a cheque stays in hand and reserves its allocations until it clears
 * (R10). Releases an automatic credit hold once the party is within terms.
 */
export const recordReceipt = defineCommand({
  name: "ar.recordReceipt",
  permission: "ar.receipt.create",
  input: recordReceiptInput,
  async run(tx, input) {
    const party = await tx.get("parties", input.partyId)
    if (!party.isCustomer) tx.reject("NOT_A_CUSTOMER", { party: party.nameEn })
    const locationId = receiptLocation(tx, input.locationId)
    tx.requireLocation(locationId)
    const date = input.date ?? tx.today()
    if (date > tx.today()) tx.reject("FUTURE_DATE", { date })
    if (input.vdsDeductedP + input.aitDeductedP > 0 && !input.certificateNo) tx.reject("CERTIFICATE_REQUIRED")
    if (input.method === "cheque" && !input.cheque) tx.reject("CHEQUE_DETAILS_REQUIRED")
    if (input.method === "cheque" && input.amountP <= 0) tx.reject("AMOUNT_REQUIRED")
    if (input.cashBankAccountId) {
      const account = await tx.get("cashBankAccounts", input.cashBankAccountId)
      if (!accountFitsMethod(account, input.method)) tx.reject("ACCOUNT_METHOD_MISMATCH", { account: account.nameEn })
    }
    const ids = new Set<string>()
    for (const a of input.allocations) {
      if (ids.has(a.invoiceId)) tx.reject("DUPLICATE_ALLOCATION")
      ids.add(a.invoiceId)
    }

    const receipt = await createReceipt(tx, {
      partyId: party.id,
      locationId,
      date,
      method: input.method,
      amountP: input.amountP,
      allocations: input.allocations,
      vdsDeductedP: input.vdsDeductedP,
      aitDeductedP: input.aitDeductedP,
      certificateNo: input.certificateNo,
      ref: input.ref,
      cashBankAccountId: input.cashBankAccountId,
      cheque: input.cheque,
      confirmed: input.confirmed,
      idempotencyKey: input.idempotencyKey,
      rule: "R8",
    })

    let released = false
    if (receipt.status === "posted") {
      released = await releaseHoldIfWithinTerms(tx, party.id)
      if (canSms(party)) {
        queueSms(tx, {
          to: party.phone,
          partyId: party.id,
          lang: "en",
          templateId: "payment-received",
          params: { amount: formatMoney(input.amountP, "en"), receiptNo: receipt.receiptNo },
        })
      }
    }
    tx.emit("ReceiptRecorded", {
      refs: { receiptId: receipt.id, partyId: party.id, ...(receipt.chequeId ? { chequeId: receipt.chequeId } : {}) },
      params: { no: receipt.receiptNo, amount: taka(input.amountP), party: party.nameEn },
      locationId,
    })
    return { receiptId: receipt.id, receiptNo: receipt.receiptNo, status: receipt.status, released }
  },
})

/**
 * `ar.recordRefund`: refund of a customer advance or credit balance in cash,
 * MFS or bank (R28). Never more than the party's open advance.
 */
export const recordRefund = defineCommand({
  name: "ar.recordRefund",
  permission: "ar.refund.create",
  input: z.object({
    partyId: z.string(),
    locationId: z.string().optional(),
    date: isoDay.optional(),
    method: z.enum(["cash", "bkash", "nagad", "bank-transfer"]),
    cashBankAccountId: z.string(),
    amountP: z.number().int().positive(),
    source: z.enum(["deposit", "credit-note", "overpayment"]),
    orderId: z.string().optional(),
    creditNoteId: z.string().optional(),
    reason: z.string().trim().min(3),
    idempotencyKey: z.string().min(4),
  }),
  async run(tx, input) {
    const party = await tx.get("parties", input.partyId)
    const locationId = receiptLocation(tx, input.locationId)
    tx.requireLocation(locationId)
    const date = input.date ?? tx.today()
    if (date > tx.today()) tx.reject("FUTURE_DATE", { date })
    const account = await tx.get("cashBankAccounts", input.cashBankAccountId)
    if (!accountFitsMethod(account, input.method)) tx.reject("ACCOUNT_METHOD_MISMATCH", { account: account.nameEn })
    const advance = await customerAdvanceP(tx, party.id)
    if (input.amountP > advance) tx.reject("REFUND_EXCEEDS_ADVANCE", { availableP: Math.max(0, advance) })
    await requireFunds(tx, account, input.amountP)

    const refundNo = await nextDocNo(tx, "RF", { location: locationId, date })
    const id = newId("rf")
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R28,
      date,
      source: { app: "ar", docType: "customerRefunds", docId: id, docNo: refundNo },
      narration: `Customer refund ${refundNo}, ${party.nameEn}: ${input.reason}`,
      lines: linesForRefund({ partyId: party.id, cashTag: account.accountTag, amountP: input.amountP, locationId }),
      rule: "R28",
    })
    tx.insert("customerRefunds", {
      id,
      refundNo,
      locationId,
      partyId: party.id,
      date,
      method: input.method,
      cashBankAccountId: account.id,
      amountP: input.amountP,
      source: input.source,
      orderId: input.orderId,
      creditNoteId: input.creditNoteId,
      reason: input.reason,
      journalId: journal.id,
    })
    tx.auditContext({ reason: input.reason })
    if (canSms(party)) {
      queueSms(tx, {
        to: party.phone,
        partyId: party.id,
        lang: "en",
        templateId: "refund-paid",
        params: { amount: formatMoney(input.amountP, "en"), refundNo },
      })
    }
    tx.emit("RefundPaid", {
      refs: { refundId: id, partyId: party.id, journalId: journal.id },
      params: { no: refundNo, amount: taka(input.amountP), party: party.nameEn },
      locationId,
    })
    return { refundId: id, refundNo }
  },
})

/**
 * `ar.sendReminder`: an "invoice due" SMS per overdue invoice (numbers,
 * dates and amounts only, plan §11), simulated.
 */
export const sendReminder = defineCommand({
  name: "ar.sendReminder",
  permission: "ar.reminder.send",
  input: z.object({
    partyId: z.string(),
    invoiceIds: z.array(z.string()).optional(),
    lang: z.enum(["en", "bn"]).default("en"),
  }),
  async run(tx, input) {
    const party = await tx.get("parties", input.partyId)
    if (!party.phone) tx.reject("NO_PHONE", { party: party.nameEn })
    const today = tx.today()
    const invoices = (await tx.list("salesInvoices", "partyId", party.id)).filter(
      (i) =>
        invoiceOpenP(i) > 0 &&
        daysPastDue(i.dueDate, today) > 0 &&
        (!input.invoiceIds || input.invoiceIds.includes(i.id))
    )
    if (!invoices.length) tx.reject("NOTHING_OVERDUE", { party: party.nameEn })
    for (const inv of invoices) {
      queueSms(tx, {
        to: party.phone,
        partyId: party.id,
        lang: input.lang,
        templateId: "invoice-due",
        params: {
          invoiceNo: inv.invoiceNo,
          amount: formatMoney(invoiceOpenP(inv), input.lang),
          date: formatDmy(inv.dueDate, input.lang),
        },
      })
    }
    tx.emit("ReminderSent", {
      refs: { partyId: party.id },
      params: { party: party.nameEn, count: invoices.length },
      locationId: null,
    })
    return { sent: invoices.length }
  },
})

/**
 * `ar.applyCreditHolds` (system, the `ar.creditHold` job): a customer with an
 * invoice more than `rules.creditHoldOverdueDays` past its due date goes on
 * hold ONCE (`parties.autoHoldAt`); payment back within terms or a manager
 * releases it.
 */
export const applyCreditHolds = defineCommand({
  name: "ar.applyCreditHolds",
  permission: "system",
  input: z.object({ partyIds: z.array(z.string()) }),
  async run(tx, input) {
    const today = tx.today()
    let held = 0
    for (const partyId of input.partyIds) {
      const party = await tx.get("parties", partyId)
      if (party.status !== "active" || party.autoHoldAt) continue
      const invoices = await tx.list("salesInvoices", "partyId", partyId)
      const worst = invoices
        .filter((i) => invoiceOpenP(i) > 0)
        .map((i) => ({ inv: i, dpd: daysPastDue(i.dueDate, today) }))
        .filter((x) => x.dpd > rules.creditHoldOverdueDays)
        .sort((a, b) => b.dpd - a.dpd)[0]
      if (!worst) continue
      await tx.update("parties", party.id, {
        status: "on-hold",
        autoHoldAt: tx.now(),
        holdReason: `Invoice ${worst.inv.invoiceNo} is ${worst.dpd} days past due`,
      })
      tx.emit("CreditHoldSet", {
        refs: { partyId: party.id, invoiceId: worst.inv.id },
        params: { party: party.nameEn, code: party.code, days: worst.dpd },
        locationId: null,
      })
      held += 1
    }
    return { held }
  },
})
