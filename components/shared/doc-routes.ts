import type { AppCode } from "@/core/security/types"

/**
 * Where each document lives (plan §9): its owning app (for the code chip on
 * links) and the route of its screen. Lists without a detail route open with
 * `?id=` so the list can highlight and open the row.
 */
const ROUTES: Record<string, { app: AppCode; href: (id: string) => string }> = {
  quotations: { app: "stl", href: (id) => `/stl/quotations/${id}` },
  salesOrders: { app: "stl", href: (id) => `/stl/orders/${id}` },
  deliveries: { app: "sd", href: (id) => `/sd/deliveries?id=${id}` },
  salesInvoices: { app: "si", href: (id) => `/si/${id}` },
  creditNotes: { app: "si", href: (id) => `/si/credit-notes?id=${id}` },
  receipts: { app: "ar", href: (id) => `/ar/receipts?id=${id}` },
  customerRefunds: { app: "ar", href: (id) => `/ar/refunds?id=${id}` },
  vendorBills: { app: "ap", href: (id) => `/ap/bills/${id}` },
  vendorPayments: { app: "ap", href: (id) => `/ap/payments/${id}` },
  debitNotes: { app: "ap", href: (id) => `/ap/debit-notes?id=${id}` },
  journals: { app: "fa", href: (id) => `/fa/journals/${id}` },
  recurringJournals: { app: "fa", href: (id) => `/fa/recurring?id=${id}` },
  periods: { app: "fa", href: (id) => `/fa/periods?id=${id}` },
  accounts: { app: "fa", href: (id) => `/fa/ledger?account=${id}` },
  fundTransfers: { app: "cab", href: (id) => `/cab/transfers?id=${id}` },
  settlements: { app: "cab", href: (id) => `/cab/settlements?id=${id}` },
  pettyCashVouchers: { app: "cab", href: (id) => `/cab/petty-cash?id=${id}` },
  cheques: { app: "cab", href: (id) => `/cab/cheques?id=${id}` },
  bankStatements: { app: "cab", href: (id) => `/cab/reconciliation?id=${id}` },
  cashBankAccounts: { app: "cab", href: (id) => `/cab/accounts/${id}` },
  parties: { app: "par", href: (id) => `/par/${id}` },
  vehicles: { app: "par", href: (id) => `/par/vehicles?id=${id}` },
  vatReturns: { app: "frs", href: (id) => `/frs/vat?id=${id}` },
  taxDeposits: { app: "frs", href: (id) => `/frs/vat?deposit=${id}` },
  purchaseRequisitions: { app: "ptl", href: (id) => `/ptl/requisitions/${id}` },
  purchaseOrders: { app: "ptl", href: (id) => `/ptl/po/${id}` },
  purchaseReturns: { app: "ptl", href: (id) => `/ptl/returns?id=${id}` },
  grns: { app: "grn", href: (id) => `/grn/${id}` },
  items: { app: "pm", href: (id) => `/pm/items/${id}` },
  services: { app: "pc", href: (id) => `/pc/services/${id}` },
  transfers: { app: "st", href: (id) => `/st/transfers/${id}` },
  stockAdjustments: { app: "st", href: (id) => `/st/adjustments?id=${id}` },
  stockCounts: { app: "ic", href: (id) => `/ic/counts/${id}` },
  users: { app: "sac", href: (id) => `/sac/users/${id}` },
  roles: { app: "rbac", href: (id) => `/rbac/roles/${id}` },
  reportDefinitions: { app: "irt", href: (id) => `/irt/run/${id}` },
}

/** The screen of a document, or undefined for an unknown type. */
export function docHref(docType: string, docId: string): string | undefined {
  return ROUTES[docType]?.href(docId)
}

/** The app that owns a document type (for its code chip and the view permission). */
export function docApp(docType: string): AppCode | undefined {
  return ROUTES[docType]?.app
}

export const DOC_ROUTE_TYPES = Object.keys(ROUTES)
