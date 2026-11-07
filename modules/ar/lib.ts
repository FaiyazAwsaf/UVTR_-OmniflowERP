import type { TaxSettings } from "@/config/rules.config"
import type { ISODate, Poisha, SalesInvoiceRow, VendorBillRow } from "@/core/db/schema"
import { customerDeductions } from "@/core/tax/withholding"

/**
 * AR (and AP) pure helpers: days past due, aging buckets (accounting_rules
 * §6: 0 to 30, 31 to 60, 61 to 90 and over 90 days PAST the due date; not
 * yet due separate), open amounts, and the oldest-first allocation of a
 * customer receipt grossed up for the VDS and AIT the customer deducts.
 */

export type Bucket = "current" | "d0_30" | "d31_60" | "d61_90" | "over90"
export const BUCKETS: Bucket[] = ["current", "d0_30", "d31_60", "d61_90", "over90"]

const DAY_MS = 86_400_000

/** Taka as a number for event labels (the event stream formats numbers per window). */
export const taka = (p: Poisha) => Math.round(p) / 100

/** Whole days from `from` to `to` (ISO days; negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** Days past the due date on `today` (negative: not yet due). */
export function daysPastDue(dueDate: ISODate, today: ISODate): number {
  return daysBetween(dueDate, today)
}

export function bucketOf(dpd: number): Bucket {
  if (dpd < 0) return "current"
  if (dpd <= 30) return "d0_30"
  if (dpd <= 60) return "d31_60"
  if (dpd <= 90) return "d61_90"
  return "over90"
}

/** An invoice's open amount: total − advance applied − paid − credited (plan §5.5). */
export function invoiceOpenP(inv: Pick<SalesInvoiceRow, "totalP" | "advanceAppliedP" | "paidP" | "creditedP">): Poisha {
  return inv.totalP - inv.advanceAppliedP - inv.paidP - inv.creditedP
}

/** What a new receipt may still allocate: open − reserved by pending receipts. */
export function invoiceAvailableP(inv: SalesInvoiceRow): Poisha {
  return invoiceOpenP(inv) - inv.reservedP
}

/** A bill's open amount: total − paid − debited (accounting_rules §6). */
export function billOpenP(bill: Pick<VendorBillRow, "totalP" | "paidP" | "debitedP">): Poisha {
  return bill.totalP - bill.paidP - bill.debitedP
}

/** Posted bills sit on AP_CONTROL; a bill on hold has no journal yet. */
export function billOnLedger(bill: Pick<VendorBillRow, "status">): boolean {
  return bill.status !== "on-hold"
}

export type BucketTotals = Record<Bucket, Poisha> & { total: Poisha }

export function emptyBuckets(): BucketTotals {
  return { current: 0, d0_30: 0, d31_60: 0, d61_90: 0, over90: 0, total: 0 }
}

export function addToBuckets(t: BucketTotals, bucket: Bucket, amountP: Poisha): void {
  t[bucket] += amountP
  t.total += amountP
}

/** Oldest first: by invoice date, then due date, then number. */
export function oldestFirst<T extends { date: ISODate; dueDate: ISODate; invoiceNo?: string; billNo?: string }>(a: T, b: T): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  const x = a.invoiceNo ?? a.billNo ?? ""
  const y = b.invoiceNo ?? b.billNo ?? ""
  return x < y ? -1 : x > y ? 1 : 0
}

type Deducts = { deductsVds: boolean; deductsAit: boolean }

/** Cash the customer pays for an allocation A after its deductions. */
export function cashFor(party: Deducts, inv: Pick<SalesInvoiceRow, "vatP" | "totalP">, allocatedP: Poisha, tax: TaxSettings): Poisha {
  const d = customerDeductions(party, [{ allocatedP, invoiceVatP: inv.vatP, invoiceTotalP: inv.totalP }], tax)
  return allocatedP - d.vdsP - d.aitP
}

/** The largest allocation whose cash after deductions fits in `cashP` (never above `availableP`). */
export function grossUp(party: Deducts, inv: Pick<SalesInvoiceRow, "vatP" | "totalP">, cashP: Poisha, availableP: Poisha, tax: TaxSettings): Poisha {
  if (cashP <= 0 || availableP <= 0) return 0
  if (cashFor(party, inv, availableP, tax) <= cashP) return availableP
  const vatShare = inv.totalP > 0 ? inv.vatP / inv.totalP : 0
  const rate =
    (party.deductsVds ? vatShare * (tax.customerDeductions.vdsPctOfVat / 100) : 0) +
    (party.deductsAit ? (1 - vatShare) * (tax.customerDeductions.aitPct / 100) : 0)
  let a = Math.min(availableP, Math.round(cashP / (1 - rate)))
  for (let i = 0; i < 500 && a < availableP && cashFor(party, inv, a + 1, tax) <= cashP; i++) a += 1
  for (let i = 0; i < 500 && a > 0 && cashFor(party, inv, a, tax) > cashP; i++) a -= 1
  return a
}

export type AllocInvoice = Pick<SalesInvoiceRow, "id" | "date" | "dueDate" | "invoiceNo" | "vatP" | "totalP"> & { availableP: Poisha }

/**
 * Allocate a cash amount to open invoices oldest first (plan §6.2), each
 * allocation grossed up for the customer's deductions; the rest is advance.
 */
export function allocateOldestFirst(
  cashP: Poisha,
  invoices: AllocInvoice[],
  party: Deducts,
  tax: TaxSettings
): { allocations: { invoiceId: string; amountP: Poisha }[]; restP: Poisha } {
  let left = cashP
  const allocations: { invoiceId: string; amountP: Poisha }[] = []
  for (const inv of [...invoices].sort(oldestFirst)) {
    if (left <= 0) break
    const a = grossUp(party, inv, left, inv.availableP, tax)
    if (a <= 0) continue
    allocations.push({ invoiceId: inv.id, amountP: a })
    left -= cashFor(party, inv, a, tax)
  }
  return { allocations, restP: Math.max(0, left) }
}

/** Proposed VDS and AIT for a set of allocations (customerDeductions, editable on the receipt). */
export function deductionsFor(
  party: Deducts,
  allocations: { invoiceId: string; amountP: Poisha }[],
  invoices: Map<string, Pick<SalesInvoiceRow, "vatP" | "totalP">>,
  tax: TaxSettings
): { vdsP: Poisha; aitP: Poisha } {
  const shares = allocations
    .filter((a) => a.amountP > 0 && invoices.has(a.invoiceId))
    .map((a) => ({ allocatedP: a.amountP, invoiceVatP: invoices.get(a.invoiceId)!.vatP, invoiceTotalP: invoices.get(a.invoiceId)!.totalP }))
  return customerDeductions(party, shares, tax)
}
