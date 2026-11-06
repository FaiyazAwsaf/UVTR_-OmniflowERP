import type { TableName } from "@/core/db/tables"
import type { AppCode } from "@/core/security/types"

/**
 * Where a document lives in the UI (plan §9) and which app's view key opens
 * it. Used by the global search, the approvals inbox, the approvals bell and
 * the cross-window toasts. Documents without a detail route open their list
 * with `?q=<number>` so the owning screen can filter to it.
 */
export type DocRoute = {
  app: AppCode
  /** Table field holding the readable number */
  field: string
  /** Detail route; `null` opens the list (`list`) filtered by number */
  detail: ((id: string) => string) | null
  list: string
}

export const DOC_ROUTES: Partial<Record<TableName, DocRoute>> = {
  salesInvoices: { app: "si", field: "invoiceNo", detail: (id) => `/si/${id}`, list: "/si" },
  creditNotes: { app: "si", field: "creditNoteNo", detail: null, list: "/si/credit-notes" },
  receipts: { app: "ar", field: "receiptNo", detail: null, list: "/ar/receipts" },
  customerRefunds: { app: "ar", field: "refundNo", detail: null, list: "/ar/refunds" },
  quotations: { app: "stl", field: "quoteNo", detail: (id) => `/stl/quotations/${id}`, list: "/stl/quotations" },
  salesOrders: { app: "stl", field: "orderNo", detail: (id) => `/stl/orders/${id}`, list: "/stl/orders" },
  deliveries: { app: "sd", field: "deliveryNo", detail: null, list: "/sd/deliveries" },
  vendorBills: { app: "ap", field: "billNo", detail: (id) => `/ap/bills/${id}`, list: "/ap/bills" },
  vendorPayments: { app: "ap", field: "paymentNo", detail: (id) => `/ap/payments/${id}`, list: "/ap/payments" },
  debitNotes: { app: "ap", field: "debitNoteNo", detail: null, list: "/ap/debit-notes" },
  fundTransfers: { app: "cab", field: "transferNo", detail: null, list: "/cab/transfers" },
  settlements: { app: "cab", field: "settlementNo", detail: null, list: "/cab/settlements" },
  pettyCashVouchers: { app: "cab", field: "voucherNo", detail: null, list: "/cab/petty-cash" },
  journals: { app: "fa", field: "journalNo", detail: (id) => `/fa/journals/${id}`, list: "/fa/journals" },
  taxDeposits: { app: "frs", field: "depositNo", detail: null, list: "/frs/vat" },
  purchaseRequisitions: {
    app: "ptl",
    field: "prNo",
    detail: (id) => `/ptl/requisitions/${id}`,
    list: "/ptl/requisitions",
  },
  purchaseOrders: { app: "ptl", field: "poNo", detail: (id) => `/ptl/po/${id}`, list: "/ptl/po" },
  purchaseReturns: { app: "ptl", field: "returnNo", detail: null, list: "/ptl/returns" },
  grns: { app: "grn", field: "grnNo", detail: (id) => `/grn/${id}`, list: "/grn" },
  transfers: { app: "st", field: "transferNo", detail: (id) => `/st/transfers/${id}`, list: "/st/transfers" },
  stockAdjustments: { app: "st", field: "adjustmentNo", detail: null, list: "/st/adjustments" },
  stockCounts: { app: "ic", field: "countNo", detail: (id) => `/ic/counts/${id}`, list: "/ic/counts" },
  parties: { app: "par", field: "code", detail: (id) => `/par/${id}`, list: "/par" },
}

/** The screen that shows a document (its detail route, else its list filtered by number). */
export function docHref(docType: string, docId: string, docNo: string): string | null {
  const route = DOC_ROUTES[docType as TableName]
  if (!route) return null
  if (route.detail) return route.detail(docId)
  return `${route.list}?q=${encodeURIComponent(docNo)}`
}

/** The app that owns a document type, if known. */
export function docApp(docType: string): AppCode | null {
  return DOC_ROUTES[docType as TableName]?.app ?? null
}

/**
 * Readable-number prefixes (accounting_rules.md §5) and the table each one
 * lives in. Every prefix includes its hyphen, so `PR-` never matches `PRN-`
 * and `C-` never matches `CRN-`.
 */
export const DOC_PREFIXES: { prefixes: string[]; table: TableName }[] = [
  { prefixes: ["INV-"], table: "salesInvoices" },
  { prefixes: ["MR-"], table: "receipts" },
  { prefixes: ["SO-"], table: "salesOrders" },
  { prefixes: ["QT-"], table: "quotations" },
  { prefixes: ["DN-"], table: "deliveries" },
  { prefixes: ["CRN-"], table: "creditNotes" },
  { prefixes: ["BL-"], table: "vendorBills" },
  { prefixes: ["VP-"], table: "vendorPayments" },
  { prefixes: ["PO-"], table: "purchaseOrders" },
  { prefixes: ["PR-"], table: "purchaseRequisitions" },
  { prefixes: ["GRN-"], table: "grns" },
  { prefixes: ["TRF-"], table: "transfers" },
  { prefixes: ["ADJ-"], table: "stockAdjustments" },
  { prefixes: ["CNT-"], table: "stockCounts" },
  { prefixes: ["PCV-"], table: "pettyCashVouchers" },
  {
    prefixes: ["JV-", "SV-", "RV-", "PV-", "PJ-", "IV-", "CV-", "OB-", "SM-", "YC-"],
    table: "journals",
  },
  { prefixes: ["CT-"], table: "fundTransfers" },
  { prefixes: ["SET-"], table: "settlements" },
  { prefixes: ["TXD-"], table: "taxDeposits" },
  { prefixes: ["DBN-"], table: "debitNotes" },
  { prefixes: ["PRN-"], table: "purchaseReturns" },
  { prefixes: ["RF-"], table: "customerRefunds" },
  { prefixes: ["C-", "V-"], table: "parties" },
]
