import type {
  AccountTag,
  Allocation,
  CashBankAccountRow,
  ISODate,
  Id,
  Poisha,
  ReceiptMethod,
  ReceiptRow,
  SalesInvoiceRow,
} from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import {
  linesForChequeCleared,
  linesForCounterTenders,
  linesForDeposit,
  linesForMfsConfirmation,
  linesForReceipt,
  RULE_VOUCHER,
  type RuleCode,
} from "@/core/ledger/rules"

/**
 * Customer receipts (plan §6.2, P1.8): one helper for STL deposits, SI
 * checkout tenders and AR receipts. Cash, card, bank transfer and confirmed
 * MFS post at once; unconfirmed bKash/Nagad and cheques stay `pending` and
 * RESERVE their allocations on the invoices (`reservedP`) until they post
 * (R9 MFS confirmation, R10 cheque cleared) or are released (timeout, bounce).
 */

/** An invoice's open amount: total − advance applied − paid − credited (plan §5.5). */
export function invoiceOpen(
  inv: Pick<
    SalesInvoiceRow,
    "totalP" | "advanceAppliedP" | "paidP" | "creditedP"
  >
): Poisha {
  return inv.totalP - inv.advanceAppliedP - inv.paidP - inv.creditedP
}

/** What may still be allocated: open − reserved by pending receipts (INV-09). */
export function invoiceAvailable(inv: SalesInvoiceRow): Poisha {
  return invoiceOpen(inv) - inv.reservedP
}

/** Invoice status from its amounts. */
export function invoiceStatus(
  inv: Pick<
    SalesInvoiceRow,
    "totalP" | "advanceAppliedP" | "paidP" | "creditedP"
  >
): SalesInvoiceRow["status"] {
  const open = invoiceOpen(inv)
  if (open > 0)
    return inv.paidP + inv.advanceAppliedP + inv.creditedP > 0
      ? "partially-paid"
      : "posted"
  if (
    inv.creditedP > 0 &&
    inv.paidP === 0 &&
    inv.creditedP >= inv.totalP - inv.advanceAppliedP
  )
    return "credited"
  return "paid"
}

/** The default cash/bank account for a method at a location. */
export async function cashAccountFor(
  tx: Tx,
  method: ReceiptMethod,
  locationId: Id
): Promise<CashBankAccountRow> {
  const location = await tx.get("locations", locationId)
  let tag: AccountTag
  switch (method) {
    case "cash":
      tag = location.code === "UTT" ? "CASH_TILL_UTT" : "CASH_TILL_GUL"
      break
    case "card":
      tag = "CARD_CLEARING"
      break
    case "bkash":
      tag = "MFS_BKASH"
      break
    case "nagad":
      tag = "MFS_NAGAD"
      break
    case "bank-transfer":
      tag = "BANK_MAIN"
      break
    case "cheque":
      tag = "BANK_COLLECTION"
      break
  }
  const [account] = await tx.list("cashBankAccounts", "accountTag", tag)
  if (!account) tx.reject("UNKNOWN_TAG", { tag })
  return account
}

export type ReceiptInput = {
  partyId: Id
  locationId: Id
  date?: ISODate
  method: ReceiptMethod
  /** Money received (net of any customer deductions) */
  amountP: Poisha
  /** AR reductions per invoice (each includes its share of the deductions) */
  allocations: Allocation[]
  vdsDeductedP?: Poisha
  aitDeductedP?: Poisha
  certificateNo?: string
  /** A booking deposit for this order (R3) */
  orderId?: Id
  ref?: string
  cashBankAccountId?: Id
  /** For cheques: the cheque details (it stays in hand, receipt pending) */
  cheque?: { chequeNo: string; bankName: string; chequeDate: ISODate }
  /** bKash/Nagad: true when the simulated approval succeeded in the dialog */
  confirmed?: boolean
  idempotencyKey: string
  tenderedP?: Poisha
  changeP?: Poisha
  /** Which rule labels the voucher: R3 deposit, R7 counter tender, R8 receipt (default) */
  rule?: Extract<RuleCode, "R3" | "R7" | "R8">
}

async function applyToInvoices(
  tx: Tx,
  allocations: Allocation[],
  mode: "paid" | "reserve" | "release" | "post-reserved"
) {
  for (const a of allocations) {
    const inv = await tx.get("salesInvoices", a.invoiceId)
    let { paidP, reservedP } = inv
    if (mode === "paid") paidP += a.amountP
    if (mode === "reserve") reservedP += a.amountP
    if (mode === "release") reservedP -= a.amountP
    if (mode === "post-reserved") {
      reservedP -= a.amountP
      paidP += a.amountP
    }
    const next = { ...inv, paidP, reservedP }
    await tx.update("salesInvoices", inv.id, {
      paidP,
      reservedP,
      status: invoiceStatus(next),
    })
    await closeOrdersIfPaid(tx, inv.id)
  }
}

/**
 * Close the invoice's orders once it is paid with no pending tender left
 * (plan §6.1 invoiced → paid → closed), whichever path paid it: the counter,
 * an AR receipt, a confirmed MFS push or a cleared cheque.
 */
export async function closeOrdersIfPaid(tx: Tx, invoiceId: Id) {
  const invoice = await tx.get("salesInvoices", invoiceId)
  if (invoice.status !== "paid" || invoice.reservedP > 0) return
  for (const orderId of invoice.orderIds) {
    const order = await tx.find("salesOrders", orderId)
    if (order && order.status === "invoiced")
      await tx.update("salesOrders", order.id, {
        status: "closed",
        closedAt: tx.now(),
      })
  }
}

function postRule(rule: RuleCode, receipt: ReceiptRow, cashTag: AccountTag) {
  const allocatedP = receipt.allocations.reduce((s, a) => s + a.amountP, 0)
  switch (rule) {
    case "R3":
      return linesForDeposit({
        cashTag,
        amountP: receipt.amountP,
        partyId: receipt.partyId,
        locationId: receipt.locationId,
      })
    case "R7":
      return linesForCounterTenders({
        partyId: receipt.partyId,
        locationId: receipt.locationId,
        tenders: [{ cashTag, amountP: receipt.amountP }],
      })
    case "R9":
      return linesForMfsConfirmation({
        partyId: receipt.partyId,
        locationId: receipt.locationId,
        cashTag,
        amountP: receipt.amountP,
        allocatedP,
        advanceP: receipt.advanceP,
      })
    case "R10":
      return linesForChequeCleared({
        partyId: receipt.partyId,
        locationId: receipt.locationId,
        cashTag,
        amountP: receipt.amountP,
        vdsP: receipt.vdsDeductedP,
        aitP: receipt.aitDeductedP,
        allocatedP,
        advanceP: receipt.advanceP,
      })
    default:
      return linesForReceipt({
        partyId: receipt.partyId,
        locationId: receipt.locationId,
        cashTag,
        amountP: receipt.amountP,
        vdsP: receipt.vdsDeductedP,
        aitP: receipt.aitDeductedP,
        allocatedP,
        advanceP: receipt.advanceP,
      })
  }
}

/**
 * Create a receipt in the current commit. Validates allocations against what
 * is available (INV-09), numbers it MR-<LOC>-<FY>-<6>, and posts or reserves.
 */
export async function createReceipt(
  tx: Tx,
  input: ReceiptInput
): Promise<ReceiptRow> {
  const date = input.date ?? tx.today()
  const vds = input.vdsDeductedP ?? 0
  const ait = input.aitDeductedP ?? 0
  const allocatedP = input.allocations.reduce((s, a) => s + a.amountP, 0)
  const advanceP = input.amountP + vds + ait - allocatedP
  if (input.amountP <= 0 && allocatedP <= 0) tx.reject("JOURNAL_EMPTY")
  if (advanceP < 0) tx.reject("OVER_ALLOCATION", { doc: "receipt" })
  for (const a of input.allocations) {
    const inv = await tx.get("salesInvoices", a.invoiceId)
    if (inv.partyId !== input.partyId)
      tx.reject("OVER_ALLOCATION", { doc: inv.invoiceNo })
    if (a.amountP > invoiceAvailable(inv))
      tx.reject("OVER_ALLOCATION", { doc: inv.invoiceNo })
  }

  const account = input.cashBankAccountId
    ? await tx.get("cashBankAccounts", input.cashBankAccountId)
    : await cashAccountFor(tx, input.method, input.locationId)
  const final =
    input.method === "cash" ||
    input.method === "card" ||
    input.method === "bank-transfer" ||
    ((input.method === "bkash" || input.method === "nagad") &&
      input.confirmed === true)

  const receiptNo = await nextDocNo(tx, "MR", {
    location: input.locationId,
    date,
  })
  let receipt = tx.insert("receipts", {
    receiptNo,
    locationId: input.locationId,
    partyId: input.partyId,
    date,
    method: input.method,
    cashBankAccountId: account.id,
    amountP: input.amountP,
    ref: input.ref,
    status: final ? "posted" : "pending",
    allocations: input.allocations,
    advanceP,
    vdsDeductedP: vds,
    aitDeductedP: ait,
    certificateNo: input.certificateNo,
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
    at: tx.now(),
    tenderedP: input.tenderedP,
    changeP: input.changeP,
    takenBy: tx.actor.userId,
  })

  if (input.method === "cheque") {
    if (!input.cheque) tx.reject("CHEQUE_DETAILS_REQUIRED")
    const dup = await tx.list("cheques", "[cashBankAccountId+chequeNo]", [
      account.id,
      input.cheque.chequeNo,
    ])
    if (dup.length) tx.reject("DUPLICATE_CHEQUE", { no: input.cheque.chequeNo })
    const cheque = tx.insert("cheques", {
      direction: "received",
      chequeNo: input.cheque.chequeNo,
      bankName: input.cheque.bankName,
      cashBankAccountId: account.id,
      partyId: input.partyId,
      amountP: input.amountP,
      chequeDate: input.cheque.chequeDate,
      receivedOn: date,
      isPdc: input.cheque.chequeDate > date,
      status: "in-hand",
      receiptId: receipt.id,
      history: [{ status: "in-hand", at: tx.now(), by: tx.actor.userId }],
    })
    receipt = await tx.update("receipts", receipt.id, { chequeId: cheque.id })
  }

  if (final) {
    const rule =
      input.rule ?? (input.orderId && !input.allocations.length ? "R3" : "R8")
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER[rule],
      date,
      source: {
        app: "ar",
        docType: "receipts",
        docId: receipt.id,
        docNo: receiptNo,
      },
      narration: `Receipt ${receiptNo}`,
      lines: postRule(rule, receipt, account.accountTag),
      rule,
    })
    receipt = await tx.update("receipts", receipt.id, { journalId: journal.id })
    await applyToInvoices(tx, input.allocations, "paid")
  } else {
    await applyToInvoices(tx, input.allocations, "reserve")
  }
  return receipt
}

/**
 * Post a pending receipt: R9 when bKash/Nagad confirms, R10 when its cheque
 * clears (dated the clearing day). Credits exactly what it reserved.
 */
export async function postPendingReceipt(
  tx: Tx,
  receiptId: Id,
  opts: { rule: "R9" | "R10"; date?: ISODate }
): Promise<ReceiptRow> {
  const receipt = await tx.get("receipts", receiptId)
  if (receipt.status !== "pending")
    tx.reject("RECEIPT_NOT_PENDING", { no: receipt.receiptNo })
  const account = await tx.get("cashBankAccounts", receipt.cashBankAccountId)
  const date = opts.date ?? tx.today()
  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER[opts.rule],
    date,
    source: {
      app: "ar",
      docType: "receipts",
      docId: receipt.id,
      docNo: receipt.receiptNo,
    },
    narration: `Receipt ${receipt.receiptNo}`,
    lines: postRule(opts.rule, receipt, account.accountTag),
    rule: opts.rule,
  })
  await applyToInvoices(tx, receipt.allocations, "post-reserved")
  return tx.update("receipts", receipt.id, {
    status: "posted",
    journalId: journal.id,
  })
}

/** Release a pending receipt (MFS timeout, cheque bounce): nothing posts; reservations freed. */
export async function releasePendingReceipt(
  tx: Tx,
  receiptId: Id,
  status: "timed-out" | "bounced" | "returned"
): Promise<ReceiptRow> {
  const receipt = await tx.get("receipts", receiptId)
  if (receipt.status !== "pending")
    tx.reject("RECEIPT_NOT_PENDING", { no: receipt.receiptNo })
  await applyToInvoices(tx, receipt.allocations, "release")
  return tx.update("receipts", receipt.id, { status })
}
