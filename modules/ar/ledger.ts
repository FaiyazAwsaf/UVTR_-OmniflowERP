import type { AccountTag, CashBankAccountRow, Id, Poisha, ReceiptMethod } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import { acct } from "@/core/ledger/post"

import { daysPastDue, invoiceOpenP } from "./lib"

/**
 * In-commit helpers shared by the WS-FIN commands: GL balances read inside
 * the transaction (party advances, cash and bank accounts), the method to
 * account kind check, and the credit hold release when a customer is back
 * within terms (plan §3.13).
 */

/** Signed GL balance (debit positive) of a tag, optionally for one party. */
export async function tagBalanceP(tx: Tx, tag: AccountTag, partyId?: Id): Promise<Poisha> {
  const accountId = await acct(tx, tag)
  const lines = partyId ? await tx.list("journalLines", "partyId", partyId) : await tx.list("journalLines", "accountId", accountId)
  let sum = 0
  for (const l of lines) if (l.accountId === accountId) sum += l.debitP - l.creditP
  return sum
}

/** A customer's open advance (credit balance on CUSTOMER_ADVANCE). */
export async function customerAdvanceP(tx: Tx, partyId: Id): Promise<Poisha> {
  return -(await tagBalanceP(tx, "CUSTOMER_ADVANCE", partyId))
}

/** The account kinds a receipt or refund method may use. */
export function kindsForMethod(method: ReceiptMethod): CashBankAccountRow["kind"][] {
  switch (method) {
    case "cash":
      return ["cash-till", "petty-cash"]
    case "card":
      return ["card-clearing"]
    case "bkash":
    case "nagad":
      return ["mfs"]
    case "bank-transfer":
    case "cheque":
      return ["bank"]
  }
}

/** MFS accounts must match the wallet: bKash to MFS_BKASH, Nagad to MFS_NAGAD. */
export function accountFitsMethod(account: CashBankAccountRow, method: ReceiptMethod): boolean {
  if (!kindsForMethod(method).includes(account.kind)) return false
  if (method === "bkash") return account.accountTag === "MFS_BKASH"
  if (method === "nagad") return account.accountTag === "MFS_NAGAD"
  return true
}

/** Refuse when a cash, bank or wallet account would go below zero. */
export async function requireFunds(tx: Tx, account: CashBankAccountRow, amountP: Poisha): Promise<void> {
  const balance = await tagBalanceP(tx, account.accountTag)
  if (balance < amountP) tx.reject("INSUFFICIENT_FUNDS", { account: account.nameEn, balanceP: balance, amountP })
}

/**
 * Release an automatic credit hold (`parties.autoHoldAt`) once the party is
 * back within terms: no open invoice past its due date. A manual hold
 * (par.setStatus) stays until a holder of `par.party.hold` releases it.
 */
export async function releaseHoldIfWithinTerms(tx: Tx, partyId: Id): Promise<boolean> {
  const party = await tx.get("parties", partyId)
  if (party.status !== "on-hold" || !party.autoHoldAt) return false
  const today = tx.today()
  const invoices = await tx.list("salesInvoices", "partyId", partyId)
  const overdue = invoices.some((i) => invoiceOpenP(i) > 0 && daysPastDue(i.dueDate, today) > 0)
  if (overdue) return false
  await tx.update("parties", party.id, { status: "active", holdReason: undefined, autoHoldAt: undefined })
  tx.emit("CreditHoldReleased", {
    refs: { partyId: party.id },
    params: { party: party.nameEn, code: party.code },
    locationId: null,
  })
  return true
}
