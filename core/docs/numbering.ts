import { fiscalYearTag, locationById, type LocationCode } from "@/config/brand.config"
import type { ISODate, VoucherType } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"

/**
 * Readable document numbers (plan §3.18, accounting_rules.md §5). Counters
 * per type, fiscal year and (for location documents) location. The seed uses
 * the same keys and formats, so live numbering continues from the history.
 */

type Format = {
  /** Digits of the serial */
  digits: number
  /** Includes the location code */
  location: boolean
  /** Includes the fiscal year tag (parties do not) */
  fiscal: boolean
}

export const DOC_FORMATS = {
  QT: { digits: 5, location: true, fiscal: true },
  SO: { digits: 5, location: true, fiscal: true },
  DN: { digits: 5, location: true, fiscal: true },
  GP: { digits: 5, location: true, fiscal: true },
  INV: { digits: 6, location: true, fiscal: true },
  CRN: { digits: 4, location: false, fiscal: true },
  MR: { digits: 6, location: true, fiscal: true },
  RF: { digits: 4, location: true, fiscal: true },
  BL: { digits: 5, location: false, fiscal: true },
  VP: { digits: 5, location: false, fiscal: true },
  DBN: { digits: 4, location: false, fiscal: true },
  VDS: { digits: 4, location: false, fiscal: true },
  TDS: { digits: 4, location: false, fiscal: true },
  CT: { digits: 5, location: false, fiscal: true },
  SET: { digits: 5, location: false, fiscal: true },
  PCV: { digits: 4, location: true, fiscal: true },
  TXD: { digits: 4, location: false, fiscal: true },
  PR: { digits: 4, location: false, fiscal: true },
  PO: { digits: 4, location: false, fiscal: true },
  GRN: { digits: 4, location: true, fiscal: true },
  PRN: { digits: 4, location: false, fiscal: true },
  TRF: { digits: 4, location: false, fiscal: true },
  ADJ: { digits: 4, location: true, fiscal: true },
  CNT: { digits: 3, location: true, fiscal: true },
  /* Vouchers: <TYPE>-<FY>-<6> */
  OB: { digits: 6, location: false, fiscal: true },
  SM: { digits: 6, location: false, fiscal: true },
  SV: { digits: 6, location: false, fiscal: true },
  RV: { digits: 6, location: false, fiscal: true },
  PV: { digits: 6, location: false, fiscal: true },
  PJ: { digits: 6, location: false, fiscal: true },
  IV: { digits: 6, location: false, fiscal: true },
  CV: { digits: 6, location: false, fiscal: true },
  JV: { digits: 6, location: false, fiscal: true },
  YC: { digits: 6, location: false, fiscal: true },
  /* Parties: C-<6> customers, V-<4> vendors */
  C: { digits: 6, location: false, fiscal: false },
  V: { digits: 4, location: false, fiscal: false },
} satisfies Record<string, Format>

export type DocType = keyof typeof DOC_FORMATS
export type { VoucherType }

/** A location's code from its id or code (documents may pass either). */
export function locationCodeOf(location: string | undefined | null): LocationCode | undefined {
  if (!location) return undefined
  if (/^[A-Z]{2,3}$/.test(location)) return location as LocationCode
  return locationById(location)?.code
}

/** Counter key for a document type, location and fiscal year. */
export function counterKey(type: DocType, opts: { location?: string | null; date?: ISODate }): string {
  const format = DOC_FORMATS[type]
  const loc = format.location ? (locationCodeOf(opts.location) ?? "HQ") : "-"
  const fy = format.fiscal ? fiscalYearTag(opts.date ?? "2000-01-01") : "-"
  return `no:${type}:${loc}:${fy}`
}

/** The formatted number for a serial (pure; the seed uses it too). */
export function formatDocNo(type: DocType, serial: number, opts: { location?: string | null; date?: ISODate }): string {
  const format = DOC_FORMATS[type]
  const parts: string[] = [type]
  if (format.location) parts.push(locationCodeOf(opts.location) ?? "HQ")
  if (format.fiscal) parts.push(fiscalYearTag(opts.date ?? "2000-01-01"))
  parts.push(String(serial).padStart(format.digits, "0"))
  return parts.join("-")
}

/**
 * The next number of a document type inside a commit, e.g.
 * `await nextDocNo(tx, "INV", { location: "loc_gul" })` → "INV-GUL-2627-002982".
 * The date (default today) picks the fiscal year.
 */
export async function nextDocNo(
  tx: Tx,
  type: DocType,
  opts: { location?: string | null; date?: ISODate } = {}
): Promise<string> {
  const date = opts.date ?? tx.today()
  const serial = await tx.nextNumber(counterKey(type, { ...opts, date }))
  return formatDocNo(type, serial, { ...opts, date })
}

/** Document-number prefixes the global search recognises, with their table and number field. */
export const DOC_LOOKUP: { prefix: string; table: string; field: string }[] = [
  { prefix: "QT", table: "quotations", field: "quoteNo" },
  { prefix: "SO", table: "salesOrders", field: "orderNo" },
  { prefix: "DN", table: "deliveries", field: "deliveryNo" },
  { prefix: "INV", table: "salesInvoices", field: "invoiceNo" },
  { prefix: "CRN", table: "creditNotes", field: "creditNoteNo" },
  { prefix: "MR", table: "receipts", field: "receiptNo" },
  { prefix: "RF", table: "customerRefunds", field: "refundNo" },
  { prefix: "BL", table: "vendorBills", field: "billNo" },
  { prefix: "VP", table: "vendorPayments", field: "paymentNo" },
  { prefix: "DBN", table: "debitNotes", field: "debitNoteNo" },
  { prefix: "CT", table: "fundTransfers", field: "transferNo" },
  { prefix: "SET", table: "settlements", field: "settlementNo" },
  { prefix: "PCV", table: "pettyCashVouchers", field: "voucherNo" },
  { prefix: "TXD", table: "taxDeposits", field: "depositNo" },
  { prefix: "PR", table: "purchaseRequisitions", field: "prNo" },
  { prefix: "PO", table: "purchaseOrders", field: "poNo" },
  { prefix: "GRN", table: "grns", field: "grnNo" },
  { prefix: "PRN", table: "purchaseReturns", field: "returnNo" },
  { prefix: "TRF", table: "transfers", field: "transferNo" },
  { prefix: "ADJ", table: "stockAdjustments", field: "adjustmentNo" },
  { prefix: "CNT", table: "stockCounts", field: "countNo" },
  { prefix: "C", table: "parties", field: "code" },
  { prefix: "V", table: "parties", field: "code" },
  ...(["OB", "SM", "SV", "RV", "PV", "PJ", "IV", "CV", "JV", "YC"] as const).map((prefix) => ({
    prefix,
    table: "journals",
    field: "journalNo",
  })),
]
