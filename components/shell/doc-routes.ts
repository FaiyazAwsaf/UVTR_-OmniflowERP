import type { TableName } from "@/core/db/tables"

/**
 * What the global search needs on top of components/shared/doc-routes.ts
 * (each document's screen and owning app): the field that holds each
 * table's readable number, and the number prefixes of accounting_rules.md §5.
 */

/** The indexed field holding a table's readable document number. */
export const DOC_NUMBER_FIELD: Partial<Record<TableName, string>> = {
  salesInvoices: "invoiceNo",
  creditNotes: "creditNoteNo",
  receipts: "receiptNo",
  customerRefunds: "refundNo",
  quotations: "quoteNo",
  salesOrders: "orderNo",
  deliveries: "deliveryNo",
  vendorBills: "billNo",
  vendorPayments: "paymentNo",
  debitNotes: "debitNoteNo",
  fundTransfers: "transferNo",
  settlements: "settlementNo",
  pettyCashVouchers: "voucherNo",
  journals: "journalNo",
  taxDeposits: "depositNo",
  purchaseRequisitions: "prNo",
  purchaseOrders: "poNo",
  purchaseReturns: "returnNo",
  grns: "grnNo",
  transfers: "transferNo",
  stockAdjustments: "adjustmentNo",
  stockCounts: "countNo",
  parties: "code",
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
