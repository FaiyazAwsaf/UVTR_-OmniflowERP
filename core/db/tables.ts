/**
 * Table registry: every IndexedDB table, its Dexie index definition, the row
 * type it stores, and its engine rules (immutability, audit). The engine and
 * the seed iterate this list, so a table exists everywhere once declared here.
 *
 * Dexie index syntax: the first entry is the primary key; `&x` unique,
 * `*x` multi-entry, `[a+b]` compound, `a.b` a nested key path.
 */

import type * as S from "./schema"

export interface TableRows {
  /* 5.1 Organisation and settings */
  locations: S.LocationRow
  bays: S.BayRow
  costCentres: S.CostCentreRow
  settings: S.SettingRow
  fiscalYears: S.FiscalYearRow
  periods: S.PeriodRow
  /* 5.2 Security and approvals */
  users: S.UserRow
  roles: S.RoleRow
  rolePermissions: S.RolePermissionRow
  userRoles: S.UserRoleRow
  approvalLimits: S.ApprovalLimitRow
  sodRules: S.SodRuleRow
  sessions: S.SessionRow
  loginEvents: S.LoginEventRow
  approvals: S.ApprovalRow
  /* 5.3 Parties */
  parties: S.PartyRow
  vehicles: S.VehicleRow
  /* 5.4 Products and services */
  uoms: S.UomRow
  itemCategories: S.ItemCategoryRow
  items: S.ItemRow
  reorderRules: S.ReorderRuleRow
  services: S.ServiceRow
  serviceVariants: S.ServiceVariantRow
  serviceRecipes: S.ServiceRecipeRow
  packages: S.PackageRow
  addOns: S.AddOnRow
  priceLists: S.PriceListRow
  priceListLines: S.PriceListLineRow
  promotions: S.PromotionRow
  /* 5.5 Sales */
  quotations: S.QuotationRow
  quotationLines: S.QuotationLineRow
  salesOrders: S.SalesOrderRow
  salesOrderLines: S.SalesOrderLineRow
  jobTasks: S.JobTaskRow
  jobConsumptions: S.JobConsumptionRow
  qcChecks: S.QcCheckRow
  deliveries: S.DeliveryRow
  deliveryLines: S.DeliveryLineRow
  salesInvoices: S.SalesInvoiceRow
  salesInvoiceLines: S.SalesInvoiceLineRow
  creditNotes: S.CreditNoteRow
  /* 5.6 Receivables, payables, cash and bank */
  receipts: S.ReceiptRow
  customerRefunds: S.CustomerRefundRow
  vendorBills: S.VendorBillRow
  vendorBillLines: S.VendorBillLineRow
  vendorPayments: S.VendorPaymentRow
  debitNotes: S.DebitNoteRow
  cashBankAccounts: S.CashBankAccountRow
  fundTransfers: S.FundTransferRow
  settlements: S.SettlementRow
  cheques: S.ChequeRow
  bankStatements: S.BankStatementRow
  pettyCashVouchers: S.PettyCashVoucherRow
  /* 5.7 Accounting and tax */
  accounts: S.AccountRow
  journals: S.JournalRow
  journalLines: S.JournalLineRow
  recurringJournals: S.RecurringJournalRow
  vatReturns: S.VatReturnRow
  taxDeposits: S.TaxDepositRow
  /* 5.8 Purchasing and inventory */
  purchaseRequisitions: S.PurchaseRequisitionRow
  prLines: S.PrLineRow
  purchaseOrders: S.PurchaseOrderRow
  poLines: S.PoLineRow
  grns: S.GrnRow
  grnLines: S.GrnLineRow
  purchaseReturns: S.PurchaseReturnRow
  batches: S.BatchRow
  stockBalances: S.StockBalanceRow
  stockValues: S.StockValueRow
  stockMoves: S.StockMoveRow
  transfers: S.TransferRow
  transferLines: S.TransferLineRow
  stockAdjustments: S.StockAdjustmentRow
  stockCounts: S.StockCountRow
  /* 5.9 Reporting */
  reportDefinitions: S.ReportDefinitionRow
  reportRuns: S.ReportRunRow
  reportSchedules: S.ReportScheduleRow
  /* 5.10 Communication and demo */
  notifications: S.NotificationRow
  sms: S.SmsRow
  emails: S.EmailRow
  scenarioRuns: S.ScenarioRunRow
}

/** Domain tables: rows carry BaseRow and are written only through the engine. */
export type TableName = keyof TableRows
export type Row<T extends TableName> = TableRows[T]

export type TableSpec = {
  /** Dexie index definition; the primary key is always `id` */
  indexes: string
  /**
   * INV-06: once the committed row's `status` is in this set (or always, for
   * tables without a status), only `mutableFields` may change and the row may
   * not be deleted.
   */
  immutableAfter?: readonly string[] | "always"
  /** Fields that may still change on an immutable row */
  mutableFields?: readonly string[]
  /** Rows of this table may be deleted (buffered `tx.remove`) */
  deletable?: boolean
  /** false: platform table written by commits without audit rows (sessions) */
  audited?: boolean
  /** Field holding the readable document number (recorded on audit rows) */
  docNoField?: string
}

const POSTED = ["posted", "partially-paid", "paid", "credited", "reversed"] as const

export const TABLE_SPECS: { [T in TableName]: TableSpec } = {
  /* 5.1 */
  locations: { indexes: "id, &code" },
  bays: { indexes: "id, locationId, code" },
  costCentres: { indexes: "id, &code, locationId" },
  settings: { indexes: "id" },
  fiscalYears: { indexes: "id, &code, status" },
  periods: { indexes: "id, &code, month, fiscalYearId, status, startsOn" },

  /* 5.2 */
  users: { indexes: "id, &username, status, homeLocationId" },
  roles: { indexes: "id, &code" },
  rolePermissions: { indexes: "id, roleId, permission, [roleId+permission]", deletable: true },
  userRoles: { indexes: "id, userId, roleId, [userId+roleId]", deletable: true },
  approvalLimits: { indexes: "id, roleId, kind, [roleId+kind]" },
  sodRules: { indexes: "id, &code" },
  sessions: {
    indexes: "id, userId, windowId, endedAt, startedAt",
    audited: false,
  },
  loginEvents: { indexes: "id, username, userId, at, result" },
  approvals: {
    indexes: "id, kind, docType, docId, status, requestedBy, locationId, requestedAt, *routedTo",
    immutableAfter: ["approved", "rejected", "cancelled"],
    mutableFields: [],
    docNoField: "docNo",
  },

  /* 5.3 */
  parties: {
    indexes: "id, &code, segment, phone, status, isCustomer, isVendor, nameEn, bin, nid",
    docNoField: "code",
  },
  vehicles: { indexes: "id, partyId, &regNo, vehicleClass", docNoField: "regNo" },

  /* 5.4 */
  uoms: { indexes: "id, code" },
  itemCategories: { indexes: "id, &code" },
  items: { indexes: "id, &sku, categoryId, kind, status, barcode", docNoField: "sku" },
  reorderRules: { indexes: "id, itemId, locationId, [itemId+locationId]" },
  services: { indexes: "id, &code, category, sortOrder", docNoField: "code" },
  serviceVariants: { indexes: "id, serviceId, [serviceId+vehicleClass]" },
  serviceRecipes: {
    indexes: "id, serviceId, itemId, [serviceId+vehicleClass]",
    deletable: true,
  },
  packages: { indexes: "id, &code" },
  addOns: { indexes: "id, &code" },
  priceLists: { indexes: "id, code, kind, status" },
  priceListLines: {
    indexes: "id, priceListId, targetId, [priceListId+targetId]",
    deletable: true,
  },
  promotions: { indexes: "id, &code, active" },

  /* 5.5 */
  quotations: {
    indexes: "id, &quoteNo, locationId, partyId, vehicleId, status, advisorId",
    immutableAfter: ["accepted", "rejected", "expired"],
    mutableFields: ["status", "orderId"],
    docNoField: "quoteNo",
  },
  quotationLines: { indexes: "id, quotationId", deletable: true },
  salesOrders: {
    indexes:
      "id, &orderNo, locationId, partyId, vehicleId, status, bookedOn, scheduledAt, bayId, [locationId+status], advisorId",
    docNoField: "orderNo",
  },
  salesOrderLines: { indexes: "id, orderId, refId, status" },
  jobTasks: {
    indexes:
      "id, orderId, orderLineId, technicianId, bayId, status, plannedStart, locationId, [technicianId+status]",
  },
  jobConsumptions: {
    indexes: "id, orderId, taskId, itemId, locationId, at",
    immutableAfter: "always",
    mutableFields: [],
  },
  qcChecks: { indexes: "id, orderId, at", immutableAfter: "always", mutableFields: [] },
  deliveries: {
    indexes: "id, &deliveryNo, orderId, locationId, deliveredAt, kind",
    immutableAfter: "always",
    mutableFields: ["journalId"],
    docNoField: "deliveryNo",
  },
  deliveryLines: { indexes: "id, deliveryId, orderLineId, itemId" },
  salesInvoices: {
    indexes:
      "id, &invoiceNo, locationId, partyId, date, status, kind, dueDate, *orderIds, [partyId+status]",
    immutableAfter: POSTED,
    mutableFields: ["paidP", "reservedP", "creditedP", "status", "printCount"],
    docNoField: "invoiceNo",
  },
  salesInvoiceLines: {
    indexes:
      "id, invoiceId, orderLineId, serviceId, itemId, vehicleId, date, locationId, partyId",
    immutableAfter: "always",
    mutableFields: [],
  },
  creditNotes: {
    indexes: "id, &creditNoteNo, invoiceId, partyId, locationId, date, status",
    immutableAfter: ["posted", "rejected"],
    mutableFields: [],
    docNoField: "creditNoteNo",
  },

  /* 5.6 */
  receipts: {
    indexes:
      "id, &receiptNo, locationId, partyId, date, method, status, orderId, chequeId, cashBankAccountId",
    immutableAfter: ["posted", "timed-out", "bounced"],
    mutableFields: [],
    docNoField: "receiptNo",
  },
  customerRefunds: {
    indexes: "id, &refundNo, partyId, locationId, date",
    immutableAfter: "always",
    mutableFields: [],
    docNoField: "refundNo",
  },
  vendorBills: {
    indexes: "id, &billNo, partyId, date, dueDate, status, kind, poId, *grnIds, [partyId+vendorRef]",
    immutableAfter: ["posted", "partially-paid", "paid"],
    mutableFields: ["paidP", "debitedP", "status"],
    docNoField: "billNo",
  },
  vendorBillLines: { indexes: "id, billId, poLineId, grnLineId, itemId" },
  vendorPayments: {
    indexes: "id, &paymentNo, partyId, date, status, method",
    immutableAfter: ["posted", "rejected"],
    mutableFields: [],
    docNoField: "paymentNo",
  },
  debitNotes: {
    indexes: "id, &debitNoteNo, billId, partyId, date",
    immutableAfter: "always",
    mutableFields: [],
    docNoField: "debitNoteNo",
  },
  cashBankAccounts: { indexes: "id, &code, kind, accountTag, locationId" },
  fundTransfers: {
    indexes: "id, &transferNo, fromAccountId, toAccountId, date",
    immutableAfter: "always",
    mutableFields: [],
    docNoField: "transferNo",
  },
  settlements: {
    indexes: "id, &settlementNo, clearingAccountId, bankAccountId, date",
    immutableAfter: "always",
    mutableFields: [],
    docNoField: "settlementNo",
  },
  cheques: {
    indexes:
      "id, direction, chequeNo, partyId, status, chequeDate, receiptId, paymentId, [cashBankAccountId+chequeNo]",
    docNoField: "chequeNo",
  },
  bankStatements: { indexes: "id, cashBankAccountId, fromDate, toDate, status" },
  pettyCashVouchers: {
    indexes: "id, &voucherNo, locationId, date, status, cashBankAccountId",
    immutableAfter: ["posted", "rejected"],
    mutableFields: [],
    docNoField: "voucherNo",
  },

  /* 5.7 */
  accounts: { indexes: "id, &code, type, parentId, tag", docNoField: "code" },
  journals: {
    indexes:
      "id, journalNo, voucherType, date, periodId, status, source.docId, recurringId, preparedBy, rule",
    immutableAfter: ["posted", "reversed", "discarded"],
    mutableFields: ["status", "reversedById"],
    docNoField: "journalNo",
  },
  journalLines: {
    indexes:
      "id, journalId, accountId, partyId, date, periodId, locationId, itemId, [accountId+date], reconciledStatementLineId",
    immutableAfter: "always",
    mutableFields: ["reconciledStatementLineId"],
  },
  recurringJournals: { indexes: "id, &code, kind" },
  vatReturns: {
    indexes: "id, periodId, &month",
    immutableAfter: "always",
    mutableFields: [],
  },
  taxDeposits: {
    indexes: "id, &depositNo, forMonth, kind, date",
    immutableAfter: "always",
    mutableFields: [],
    docNoField: "depositNo",
  },

  /* 5.8 */
  purchaseRequisitions: {
    indexes: "id, &prNo, locationId, status, requestedBy, date",
    docNoField: "prNo",
  },
  prLines: { indexes: "id, prId, itemId", deletable: true },
  purchaseOrders: {
    indexes: "id, &poNo, vendorId, locationId, prId, status, orderDate",
    docNoField: "poNo",
  },
  poLines: { indexes: "id, poId, itemId" },
  grns: {
    indexes: "id, &grnNo, poId, vendorId, locationId, date",
    immutableAfter: "always",
    mutableFields: [],
    docNoField: "grnNo",
  },
  grnLines: {
    indexes: "id, grnId, poLineId, itemId, quarantineStatus, batchId",
    immutableAfter: "always",
    mutableFields: ["qtyAccepted", "qtyReturned", "qtyBilled", "quarantineStatus", "batchId"],
  },
  purchaseReturns: {
    indexes: "id, &returnNo, vendorId, grnId, locationId, date",
    immutableAfter: "always",
    mutableFields: [],
    docNoField: "returnNo",
  },
  batches: { indexes: "id, itemId, batchNo, expiry, status, [itemId+batchNo]" },
  stockBalances: {
    indexes: "id, itemId, locationId, batchId, [itemId+locationId]",
  },
  stockValues: { indexes: "id, itemId, locationId, [itemId+locationId]" },
  stockMoves: {
    indexes:
      "id, itemId, locationId, [itemId+locationId], type, at, date, ref.docId, journalId, batchId",
    immutableAfter: "always",
    mutableFields: ["journalId"],
  },
  transfers: {
    indexes: "id, &transferNo, fromLocationId, toLocationId, status, requestedAt",
    docNoField: "transferNo",
  },
  transferLines: { indexes: "id, transferId, itemId" },
  stockAdjustments: {
    indexes: "id, &adjustmentNo, locationId, status, date",
    immutableAfter: ["posted", "rejected"],
    mutableFields: [],
    docNoField: "adjustmentNo",
  },
  stockCounts: {
    indexes: "id, &countNo, locationId, status, date",
    immutableAfter: ["posted", "cancelled"],
    mutableFields: [],
    docNoField: "countNo",
  },

  /* 5.9 */
  reportDefinitions: { indexes: "id, code, app, isSystem, ownerId", deletable: true },
  reportRuns: { indexes: "id, definitionId, runBy, at" },
  reportSchedules: { indexes: "id, definitionId, active, nextDueAt", deletable: true },

  /* 5.10 */
  notifications: { indexes: "id, userId, read, at, [userId+read]" },
  sms: { indexes: "id, partyId, status, queuedAt" },
  emails: { indexes: "id, status, at" },
  scenarioRuns: { indexes: "id, scenarioId, at" },
}

export const TABLE_NAMES = Object.keys(TABLE_SPECS) as TableName[]

/** Engine-owned tables, present in the central database. */
export const PLATFORM_STORES = {
  events: "seq, id, type, at, locationId, app, commitId, command, actor.userId",
  audit: "seq, commitId, entity, entityId, at, action, app, actor.userId, docNo",
  counters: "id",
  idempotency: "key, commitId, at",
} as const

export function isTableName(name: string): name is TableName {
  return name in TABLE_SPECS
}

/** Short id prefixes, so ids read well in the audit log and event stream. */
export const ID_PREFIX: Partial<Record<TableName, string>> = {
  locations: "loc",
  bays: "bay",
  costCentres: "cc",
  fiscalYears: "fy",
  periods: "per",
  users: "usr",
  roles: "role",
  rolePermissions: "rp",
  userRoles: "ur",
  approvalLimits: "lim",
  sodRules: "sod",
  sessions: "ses",
  loginEvents: "lgn",
  approvals: "apv",
  parties: "pty",
  vehicles: "veh",
  itemCategories: "cat",
  items: "itm",
  reorderRules: "rr",
  services: "svc",
  serviceVariants: "svv",
  serviceRecipes: "rcp",
  packages: "pkg",
  addOns: "add",
  priceLists: "pl",
  priceListLines: "pll",
  promotions: "prm",
  quotations: "qt",
  quotationLines: "qtl",
  salesOrders: "so",
  salesOrderLines: "sol",
  jobTasks: "tsk",
  jobConsumptions: "jcn",
  qcChecks: "qc",
  deliveries: "dn",
  deliveryLines: "dnl",
  salesInvoices: "inv",
  salesInvoiceLines: "invl",
  creditNotes: "crn",
  receipts: "mr",
  customerRefunds: "rf",
  vendorBills: "bl",
  vendorBillLines: "bll",
  vendorPayments: "vp",
  debitNotes: "dbn",
  cashBankAccounts: "cba",
  fundTransfers: "ct",
  settlements: "set",
  cheques: "chq",
  bankStatements: "bst",
  pettyCashVouchers: "pcv",
  accounts: "acc",
  journals: "jnl",
  journalLines: "jl",
  recurringJournals: "rec",
  vatReturns: "vat",
  taxDeposits: "txd",
  purchaseRequisitions: "pr",
  prLines: "prl",
  purchaseOrders: "po",
  poLines: "pol",
  grns: "grn",
  grnLines: "grnl",
  purchaseReturns: "prn",
  batches: "bat",
  stockMoves: "mov",
  transfers: "trf",
  transferLines: "trfl",
  stockAdjustments: "adj",
  stockCounts: "cnt",
  reportDefinitions: "rpt",
  reportRuns: "run",
  reportSchedules: "sch",
  notifications: "ntf",
  sms: "sms",
  emails: "eml",
  scenarioRuns: "scn",
}

/** Deterministic ids for the stock tables (one row per key). */
export const stockValueId = (itemId: string, locationId: string) =>
  `sv:${itemId}:${locationId}`
export const stockBalanceId = (itemId: string, locationId: string, batchId?: string) =>
  `sb:${itemId}:${locationId}:${batchId ?? "-"}`
