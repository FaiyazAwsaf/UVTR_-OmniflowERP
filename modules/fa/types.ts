import type { CloseCheck, Id, ISODate, Poisha, VoucherType } from "@/core/db/schema"

/** FA Core Accounting: module types. */

/** Voucher types a manual voucher (R24) may take: journal, or a manual payment, receipt or contra voucher. */
export const MANUAL_VOUCHER_TYPES = ["JV", "PV", "RV", "CV"] as const satisfies readonly VoucherType[]
export type ManualVoucherType = (typeof MANUAL_VOUCHER_TYPES)[number]

/** The checks of the period close (accounting_rules.md §7), in display order. */
export const CLOSE_CHECK_KEYS = ["journals", "approvals", "recurring", "bankRecon", "grni", "vatReturn"] as const
export type CloseCheckKey = (typeof CLOSE_CHECK_KEYS)[number]

/** A document a close check points at (a draft voucher, a pending approval's document). */
export type CloseCheckItem = {
  docType: string
  docId: Id
  docNo: string
  date?: ISODate
  /** The approval kind when the item is a pending approval */
  kind?: string
  amountP?: Poisha
}

/** One line of the close checklist as shown (the stored `CloseCheck` plus what it points at). */
export type CloseChecklistItem = CloseCheck & {
  key: CloseCheckKey
  items: CloseCheckItem[]
  /** A figure the check reports (GRNI balance) */
  amountP?: Poisha
}

/** True when nothing blocking is left (warnings and information never block). */
export function closeAllowed(checklist: readonly CloseChecklistItem[]): boolean {
  return checklist.every((c) => c.blocking !== "yes" || c.ok)
}
