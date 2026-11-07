/**
 * UVTR_OmniflowERP data model (docs/implementation_plan.md §5). Frozen after
 * Phase 1: workstreams read and write these shapes but never change them. Ask
 * the main agent for a change; it updates the plan first.
 *
 * Conventions
 * - Money is integer poisha (৳1 = 100), fields end in `P`. Never floats.
 * - Moments are epoch milliseconds on the demo clock (`Ms`), from `now()`.
 * - Calendar days are `ISODate` strings (YYYY-MM-DD, Dhaka time).
 * - Readable document numbers (INV-GUL-2627-000123) are separate from `id`.
 * - Stock quantities are in the item's base unit (ml, g, pc, roll).
 */

import type { Bilingual, LocationCode, LocationKind, BayKind } from "@/config/brand.config"
import type { TaxSettings, VatCategory, VendorTaxCategory } from "@/config/rules.config"
import type { ApprovalKind, Scope } from "@/core/security/types"
import type { Locale } from "@/lib/i18n/config"

export type { Bilingual, LocationCode, Locale, VatCategory, VendorTaxCategory, ApprovalKind, Scope }

/* ================================================================== *
 * Primitives and the base row
 * ================================================================== */

export type Id = string
/** Epoch milliseconds on the demo clock. */
export type Ms = number
/** Calendar day, YYYY-MM-DD (Dhaka). */
export type ISODate = string
/** Clock time of day, HH:MM (24h). */
export type HHMM = string
/** Integer money in poisha (৳1 = 100 poisha). */
export type Poisha = number
export type Sex = "M" | "F"

/** Where a row was written. One central store (D4: no offline partition). */
export type Origin = "central"

/** Fields every domain row carries. The engine sets them; commands never do. */
export type BaseRow = {
  id: Id
  /** Starts at 1 and increments on every update (optimistic concurrency). */
  version: number
  createdAt: Ms
  updatedAt: Ms
  /** User id, or "system" for seed and sweeper writes. */
  createdBy: Id
  updatedBy: Id
  origin: Origin
}

/** The engine-managed fields, stripped from insert inputs. */
export type BaseField = keyof BaseRow

/** Links from one record to others (§5.10). Used by events, notifications, links. */
export type RefKey =
  | "partyId"
  | "vehicleId"
  | "quotationId"
  | "orderId"
  | "taskId"
  | "deliveryId"
  | "invoiceId"
  | "creditNoteId"
  | "receiptId"
  | "refundId"
  | "billId"
  | "paymentId"
  | "debitNoteId"
  | "chequeId"
  | "statementId"
  | "bankStatementLineId"
  | "fundTransferId"
  | "settlementId"
  | "pettyCashVoucherId"
  | "journalId"
  | "periodId"
  | "vatReturnId"
  | "taxDepositId"
  | "prId"
  | "poId"
  | "grnId"
  | "purchaseReturnId"
  | "transferId"
  | "adjustmentId"
  | "countId"
  | "itemId"
  | "batchId"
  | "locationId"
  | "serviceId"
  | "priceListId"
  | "userId"
  | "roleId"
  | "approvalId"
  | "sessionId"
  | "reportId"
export type Refs = Partial<Record<RefKey, Id>>

/** A link from a voucher or stock move back to its source document. */
export type DocRef = { docType: string; docId: Id; docNo: string }

/* ================================================================== *
 * Shared vocabularies
 * ================================================================== */

/** HB hatchback, SD sedan, SUV, LSUV large SUV or pickup, MPV microbus (seed_data §3). */
export type VehicleClass = "HB" | "SD" | "SUV" | "LSUV" | "MPV"
export const VEHICLE_CLASSES: VehicleClass[] = ["HB", "SD", "SUV", "LSUV", "MPV"]

/** System tags of the chart of accounts (accounting_rules.md §2). */
export type AccountTag =
  | "CASH_TILL_GUL"
  | "CASH_TILL_UTT"
  | "PETTY_HQ"
  | "PETTY_GUL"
  | "PETTY_UTT"
  | "BANK_MAIN"
  | "BANK_COLLECTION"
  | "MFS_BKASH"
  | "MFS_NAGAD"
  | "CARD_CLEARING"
  | "AR_CONTROL"
  | "INV_CHEMICAL"
  | "INV_CONSUMABLE"
  | "INV_RETAIL"
  | "INV_TRANSIT"
  | "ADV_VENDOR"
  | "DEPOSIT_RENT"
  | "PREPAID"
  | "VAT_CURRENT"
  | "AIT_PAID"
  | "EQUIPMENT"
  | "ACC_DEP_EQUIPMENT"
  | "FURNITURE"
  | "ACC_DEP_FURNITURE"
  | "VEHICLE"
  | "ACC_DEP_VEHICLE"
  | "FITOUT"
  | "ACC_DEP_FITOUT"
  | "AP_CONTROL"
  | "GRNI"
  | "CUSTOMER_ADVANCE"
  | "VAT_OUTPUT"
  | "VDS_PAYABLE"
  | "AIT_PAYABLE"
  | "SALARY_PAYABLE"
  | "ACCRUED_EXP"
  | "TERM_LOAN"
  | "SHARE_CAPITAL"
  | "RETAINED_EARNINGS"
  | "REV_WASH"
  | "REV_INTERIOR"
  | "REV_PAINT"
  | "REV_PROTECTION"
  | "REV_GLASS_WHEEL"
  | "REV_RESTORATION"
  | "REV_PRODUCTS"
  | "DISCOUNTS"
  | "OTHER_INCOME"
  | "INTEREST_INCOME"
  | "CONSUMABLES_USED"
  | "COGS"
  | "INV_LOSS"
  | "PPV"
  | "SALARIES"
  | "INCENTIVES"
  | "RENT"
  | "UTILITIES"
  | "TELECOM"
  | "REPAIRS"
  | "MARKETING"
  | "BANK_CHARGES"
  | "MERCHANT_FEES"
  | "DEPRECIATION"
  | "OFFICE"
  | "SECURITY"
  | "CONVEYANCE"
  | "PROFESSIONAL"
  | "WELFARE"
  | "INTEREST_EXPENSE"

export type InventoryTag = "INV_CHEMICAL" | "INV_CONSUMABLE" | "INV_RETAIL"
export type RevenueTag =
  | "REV_WASH"
  | "REV_INTERIOR"
  | "REV_PAINT"
  | "REV_PROTECTION"
  | "REV_GLASS_WHEEL"
  | "REV_RESTORATION"
  | "REV_PRODUCTS"
/** Expense tags a bill line, petty cash voucher or internal use may debit. */
export type ExpenseTag =
  | "SALARIES"
  | "INCENTIVES"
  | "RENT"
  | "UTILITIES"
  | "TELECOM"
  | "REPAIRS"
  | "MARKETING"
  | "BANK_CHARGES"
  | "MERCHANT_FEES"
  | "OFFICE"
  | "SECURITY"
  | "CONVEYANCE"
  | "PROFESSIONAL"
  | "WELFARE"
  | "CONSUMABLES_USED"
  | "INTEREST_EXPENSE"
  | "ACCRUED_EXP"
  | "PREPAID"
  | "ADV_VENDOR"

export type VoucherType = "OB" | "SM" | "SV" | "RV" | "PV" | "PJ" | "IV" | "CV" | "JV" | "YC"

export type ReceiptMethod = "cash" | "card" | "bkash" | "nagad" | "bank-transfer" | "cheque"
export type PayMethod = "bank-transfer" | "cheque" | "cash" | "bkash"

/* ================================================================== *
 * 5.1 Organisation and settings
 * ================================================================== */

export type LocationRow = BaseRow & {
  code: LocationCode
  nameEn: string
  nameBn: string
  kind: LocationKind
  address: Bilingual
  phone: string
  isStockLocation: boolean
  costCentreId: Id
  active: boolean
}

export type BayRow = BaseRow & {
  locationId: Id
  code: string
  nameEn: string
  nameBn: string
  kind: BayKind
  active: boolean
}

export type CostCentreRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  locationId?: Id
}

export type SecurityPolicy = {
  minLength: number
  requireDigit: boolean
  lockoutThreshold: number
  idleTimeoutMin: number
  passwordExpiryDays: number
  /** Role codes that must use MFA */
  mfaRequiredRoles: string[]
}

export type CompanySettings = {
  /** Shown on prints; the identity itself lives in config/brand.config.ts */
  printFooterEn: string
  printFooterBn: string
}

/** Typed values of the `settings` rows, keyed by row id. */
export type SettingsValues = {
  tax: TaxSettings
  security: SecurityPolicy
  /** System tag to account id (FA settings remap tags) */
  postingAccounts: Record<AccountTag, Id>
  company: CompanySettings
}
export type SettingKey = keyof SettingsValues

/** One settings row; `id` is the key ("tax", "security", "postingAccounts", "company"). */
export type SettingRow = BaseRow & { value: unknown }

export type FiscalYearRow = BaseRow & {
  /** "2627" for 01-07-2026 to 30-06-2027 */
  code: string
  startsOn: ISODate
  endsOn: ISODate
  status: "open" | "closed"
}

export type CloseCheck = {
  key: string
  blocking: "yes" | "warning" | "info"
  ok: boolean
  count?: number
}

export type PeriodRow = BaseRow & {
  fiscalYearId: Id
  /** "<fy>-<nn>", fiscal month number from July = 01: "2627-05" is November 2026 */
  code: string
  /** Calendar month, YYYY-MM */
  month: string
  startsOn: ISODate
  endsOn: ISODate
  status: "open" | "closed"
  closedBy?: Id
  closedAt?: Ms
  closeChecklist?: CloseCheck[]
  reopenReason?: string
}

/* ================================================================== *
 * 5.2 Security (SAC, RBAC) and approvals
 * ================================================================== */

export type UserStatus = "active" | "locked" | "disabled"

export type UserRow = BaseRow & {
  username: string
  nameEn: string
  nameBn: string
  designationEn: string
  designationBn: string
  email: string
  phone: string
  employeeNo: string
  homeLocationId: Id
  locationIds: Id[]
  status: UserStatus
  /** sha256(username + ":" + password), simulated */
  passwordHash: string
  passwordSetAt: Ms
  mustChangePassword: boolean
  mfaEnabled: boolean
  failedAttempts: number
  lastLoginAt?: Ms
  avatarSeed: string
  sex: Sex
}

export type RoleRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  descriptionEn: string
  descriptionBn: string
  isSystem: boolean
  active: boolean
}

export type RolePermissionRow = BaseRow & {
  roleId: Id
  permission: string
  scope: Scope
}

export type UserRoleRow = BaseRow & {
  userId: Id
  roleId: Id
  grantedBy: Id
  grantedAt: Ms
}

export type ApprovalLimitRow = BaseRow & {
  roleId: Id
  kind: ApprovalKind
  /** Poisha, or percent for discount-pct; -1 = unlimited; credit-override 1 = yes */
  value: number
}

export type SodRuleRow = BaseRow & {
  code: string
  permissionA: string
  /** A key, or "*.approve" for any approve-column key */
  permissionB: string
  mode: "warn" | "block"
  descriptionEn: string
  descriptionBn: string
  active: boolean
}

/** Platform table: written by commits but not audited (§5.2). */
export type SessionRow = BaseRow & {
  userId: Id
  windowId: string
  locationId: Id
  startedAt: Ms
  /** Wall-clock (not demo-clock) time of the last activity */
  lastActivityRealAt: number
  endedAt?: Ms
  endedReason?: "sign-out" | "forced" | "timeout"
  endedBy?: Id
  method: "password" | "demo-quick"
}

export type LoginEventRow = BaseRow & {
  username: string
  userId?: Id
  at: Ms
  result: "success" | "bad-password" | "locked" | "disabled" | "mfa-failed" | "unknown-user"
  method: "password" | "demo-quick" | "mfa"
  windowId: string
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled"

export type ApprovalRow = BaseRow & {
  kind: ApprovalKind
  /** Table of the document (salesInvoices, vendorPayments, journals, ...) */
  docType: string
  docId: Id
  docNo: string
  locationId?: Id
  amountP?: Poisha
  pct?: number
  requestedBy: Id
  requestedAt: Ms
  /** The approve key a decider must hold (§3.7 table) */
  approveKey: string
  status: ApprovalStatus
  decidedBy?: Id
  decidedAt?: Ms
  /** The requester's reason (or the inline approver's) */
  reason: string
  /** Reason given with the decision */
  decisionReason?: string
  inline: boolean
  pinVerified: boolean
  /** Users who could decide when it was requested (notified); live routing still applies */
  routedTo: Id[]
}

/* ================================================================== *
 * 5.3 Parties (PAR)
 * ================================================================== */

export type PartySegment =
  | "walk-in"
  | "retail"
  | "fleet"
  | "dealer"
  | "corporate"
  | "supplier"
  | "service-provider"
  | "landlord"
  | "utility"
  | "professional"

export type PartyAddress = { label: string; line: string; area: string; city: string }
export type PartyContact = { name: string; designation: string; phone: string; email?: string }

export type PartyRow = BaseRow & {
  /** C-000123 customers, V-0045 vendors */
  code: string
  isCustomer: boolean
  isVendor: boolean
  type: "individual" | "company"
  nameEn: string
  nameBn: string
  segment: PartySegment
  phone: string
  email?: string
  addresses: PartyAddress[]
  contacts: PartyContact[]
  bin?: string
  tin?: string
  nid?: string
  tradeLicense?: string
  creditLimitP: Poisha
  paymentTermsDays: number
  priceListId?: Id
  vendorTaxCategory?: VendorTaxCategory
  deductsVds: boolean
  deductsAit: boolean
  status: "active" | "on-hold" | "blocked"
  holdReason?: string
  autoHoldAt?: Ms
  smsConsent: boolean
  avatarSeed: string
  notes?: string
}

export type VehicleRow = BaseRow & {
  partyId: Id
  /** DHAKA METRO-GA 27-4419 (Latin, always on documents) */
  regNo: string
  regNoBn: string
  make: string
  model: string
  year: number
  colour: string
  vehicleClass: VehicleClass
  vin?: string
  notes?: string
  lastServiceAt?: Ms
  active: boolean
}

/* ================================================================== *
 * 5.4 Products and services (PM, PC)
 * ================================================================== */

export type UomRow = BaseRow & {
  /** id equals code */
  code: string
  nameEn: string
  nameBn: string
  dimension: "volume" | "mass" | "count"
}

export type ItemCategoryRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  parentId?: Id
  inventoryTag: InventoryTag
  /** Expense tag a job's use of this category debits (CONSUMABLES_USED) or COGS for retail */
  costTag: "CONSUMABLES_USED" | "COGS"
}

export type ItemKind = "chemical" | "consumable" | "retail"

export type ItemRow = BaseRow & {
  sku: string
  nameEn: string
  nameBn: string
  categoryId: Id
  kind: ItemKind
  brand?: string
  baseUom: string
  purchaseUom: string
  /** Base units per purchase unit (a 5 L can = 5,000 ml) */
  purchaseFactor: number
  salesUom?: string
  /** Base units per sales unit */
  salesFactor?: number
  trackBatch: boolean
  shelfLifeDays?: number
  /** Per purchase unit */
  standardCostP: Poisha
  /** Per sales unit, VAT exclusive */
  retailPriceP?: Poisha
  vatCategory: VatCategory
  barcode: string
  status: "active" | "inactive"
  imageSeed: string
}

export type ReorderRuleRow = BaseRow & {
  itemId: Id
  locationId: Id
  /** Base units */
  minQty: number
  maxQty: number
  reorderQty: number
}

export type ServiceCategory =
  | "wash"
  | "interior"
  | "paint"
  | "protection"
  | "glass"
  | "wheel"
  | "engine"
  | "restoration"

export type ServiceRow = BaseRow & {
  /** PRT-CC2 */
  code: string
  nameEn: string
  nameBn: string
  category: ServiceCategory
  descriptionEn: string
  descriptionBn: string
  warrantyMonths?: number
  vatCategory: VatCategory
  revenueTag: RevenueTag
  active: boolean
  sortOrder: number
}

export type ServiceVariantRow = BaseRow & {
  serviceId: Id
  vehicleClass: VehicleClass
  durationMin: number
  /** Retail list price, VAT exclusive */
  basePriceP: Poisha
  active: boolean
}

export type ServiceRecipeRow = BaseRow & {
  serviceId: Id
  /** A class, or "*" for the sedan recipe scaled by the class factors */
  vehicleClass: VehicleClass | "*"
  itemId: Id
  /** Base units */
  qtyBase: number
}

export type PackageRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  serviceIds: Id[]
  pricing:
    | { kind: "bundle-pct"; pct: number }
    | { kind: "fixed"; prices: Partial<Record<VehicleClass, Poisha>> }
  active: boolean
}

export type AddOnRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  priceP: Poisha
  durationMin: number
  revenueTag: RevenueTag
  appliesTo: ServiceCategory[]
  active: boolean
}

export type PriceListRow = BaseRow & {
  /** RETAIL / FLEET / DEALER / custom */
  code: string
  nameEn: string
  nameBn: string
  kind: "retail" | "fleet" | "dealer" | "custom"
  validFrom: ISODate
  validTo?: ISODate
  status: "draft" | "published" | "archived"
  basis: "override" | "discount-pct"
  discountPct?: number
  publishedBy?: Id
  publishedAt?: Ms
  /** For a draft revision: the list it will replace */
  revisionOfId?: Id
}

export type PriceListLineRow = BaseRow & {
  priceListId: Id
  targetType: "service-variant" | "package" | "item"
  targetId: Id
  /** For packages with a fixed price per class */
  vehicleClass?: VehicleClass
  priceP: Poisha
}

export type PromotionRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  kind: "pct" | "amount"
  /** Percent, or poisha for `amount` */
  value: number
  appliesTo: ServiceCategory[]
  validFrom: ISODate
  validTo: ISODate
  minOrderP: Poisha
  active: boolean
  usedCount: number
}

/* ================================================================== *
 * 5.5 Sales (STL, SI, SD)
 * ================================================================== */

export type SalesLineKind = "service" | "add-on" | "item"

/** Shared priced-line shape (quotation, order and invoice lines). */
export type PricedLine = {
  kind: SalesLineKind
  /** Service, add-on or item id */
  refId: Id
  packageId?: Id
  vehicleClass?: VehicleClass
  descriptionEn: string
  descriptionBn: string
  qty: number
  unitPriceP: Poisha
  discountP: Poisha
  vatRatePct: number
  vatP: Poisha
  /** qty × unit price − discount */
  netP: Poisha
  revenueTag: RevenueTag
}

export type QuotationRow = BaseRow & {
  quoteNo: string
  locationId: Id
  partyId: Id
  vehicleId?: Id
  advisorId: Id
  priceListId: Id
  promotionId?: Id
  discountPct: number
  discountApprovalId?: Id
  status: "draft" | "sent" | "accepted" | "rejected" | "expired"
  validUntil: ISODate
  inspectionNotes: string
  subtotalP: Poisha
  discountP: Poisha
  vatP: Poisha
  totalP: Poisha
  orderId?: Id
  sentAt?: Ms
}

export type QuotationLineRow = BaseRow & PricedLine & { quotationId: Id; lineNo: number }

export type SalesOrderStatus =
  | "booked"
  | "in-progress"
  | "qc"
  | "ready"
  | "delivered"
  | "invoiced"
  | "closed"
  | "cancelled"

export type SalesOrderRow = BaseRow & {
  orderNo: string
  kind: "service" | "product" | "b2b"
  locationId: Id
  partyId: Id
  vehicleId?: Id
  quotationId?: Id
  advisorId: Id
  priceListId: Id
  promotionId?: Id
  status: SalesOrderStatus
  /** Calendar day of the booking (for lists and reports) */
  bookedOn: ISODate
  scheduledAt: Ms
  bayId?: Id
  promisedAt: Ms
  discountPct: number
  discountApprovalId?: Id
  /** Deposits received */
  advanceP: Poisha
  odometerKm?: number
  conditionNotes?: string
  /** A complaint or note added after delivery (E12) */
  complaintNote?: string
  photoCount: number
  cancelReason?: string
  subtotalP: Poisha
  discountP: Poisha
  vatP: Poisha
  totalP: Poisha
  /** Status moments for the timeline and turnaround reports */
  startedAt?: Ms
  qcAt?: Ms
  readyAt?: Ms
  deliveredAt?: Ms
  invoicedAt?: Ms
  closedAt?: Ms
  cancelledAt?: Ms
}

export type SalesOrderLineRow = BaseRow &
  PricedLine & {
    orderId: Id
    lineNo: number
    status: "open" | "done" | "cancelled"
    qtyDelivered: number
    qtyInvoiced: number
  }

export type JobTaskRow = BaseRow & {
  orderId: Id
  orderLineId: Id
  locationId: Id
  serviceId?: Id
  technicianId: Id
  bayId: Id
  plannedStart: Ms
  plannedMinutes: number
  status: "queued" | "in-progress" | "done"
  startedAt?: Ms
  finishedAt?: Ms
  minutes?: number
}

export type JobConsumptionRow = BaseRow & {
  orderId: Id
  orderLineId?: Id
  taskId?: Id
  itemId: Id
  locationId: Id
  /** Base units the recipe calls for (0 for extras and returns) */
  standardQty: number
  /** Base units actually used (negative for a return) */
  actualQty: number
  kind: "recipe" | "extra" | "return"
  valueP: Poisha
  stockMoveIds: Id[]
  at: Ms
  by: Id
}

export type QcItem = { key: string; ok: boolean; note?: string }

export type QcCheckRow = BaseRow & {
  orderId: Id
  items: QcItem[]
  result: "pass" | "fail"
  checkedBy: Id
  at: Ms
}

export type DeliveryRow = BaseRow & {
  deliveryNo: string
  orderId: Id
  kind: "vehicle-handover" | "goods"
  locationId: Id
  status: "delivered"
  checklist: QcItem[]
  signatureName?: string
  signatureSvg?: string
  signedAt?: Ms
  gatePassNo?: string
  deliveredBy: Id
  deliveredAt: Ms
  journalId?: Id
}

export type DeliveryLineRow = BaseRow & {
  deliveryId: Id
  orderLineId: Id
  itemId: Id
  qtyBase: number
  batchId?: Id
  stockMoveId: Id
}

export type SalesInvoiceStatus = "posted" | "partially-paid" | "paid" | "credited"

export type SalesInvoiceRow = BaseRow & {
  /** Mushak 6.3 serial, INV-GUL-2627-000123 */
  invoiceNo: string
  locationId: Id
  partyId: Id
  orderIds: Id[]
  date: ISODate
  /** Moment of issue (Mushak 6.3 shows date and time) */
  issuedAt: Ms
  dueDate: ISODate
  kind: "counter" | "credit" | "consolidated" | "opening"
  buyerNameEn: string
  buyerBin?: string
  subtotalP: Poisha
  discountP: Poisha
  vatP: Poisha
  totalP: Poisha
  advanceAppliedP: Poisha
  paidP: Poisha
  /** Held by pending receipts (cheque in hand, MFS waiting) */
  reservedP: Poisha
  creditedP: Poisha
  status: SalesInvoiceStatus
  creditOverrideApprovalId?: Id
  journalId: Id
  printCount: number
  issuedBy: Id
}

export type SalesInvoiceLineRow = BaseRow & {
  invoiceId: Id
  lineNo: number
  orderLineId?: Id
  serviceId?: Id
  itemId?: Id
  /** add-on id when the line is an add-on */
  addOnId?: Id
  vehicleId?: Id
  vehicleClass?: VehicleClass
  descriptionEn: string
  descriptionBn: string
  qty: number
  unitPriceP: Poisha
  discountP: Poisha
  vatRatePct: number
  vatP: Poisha
  netP: Poisha
  revenueTag: RevenueTag
  /** Denormalised for reports */
  date: ISODate
  locationId: Id
  partyId: Id
  advisorId?: Id
}

export type CreditNoteLine = {
  invoiceLineId: Id
  qty?: number
  grossP: Poisha
  discountP: Poisha
  netP: Poisha
  vatP: Poisha
}

export type CreditNoteRow = BaseRow & {
  /** Mushak 6.7, CRN-2627-0031 */
  creditNoteNo: string
  invoiceId: Id
  partyId: Id
  locationId: Id
  date: ISODate
  reason: string
  lines: CreditNoteLine[]
  totalP: Poisha
  restock: boolean
  status: "pending-approval" | "posted" | "rejected"
  approvalId?: Id
  journalId?: Id
  /** Part credited to the invoice's open amount / to customer advance (R11) */
  toInvoiceP?: Poisha
  toAdvanceP?: Poisha
}

/* ================================================================== *
 * 5.6 Receivables, payables, cash and bank (AR, AP, CAB)
 * ================================================================== */

export type Allocation = { invoiceId: Id; amountP: Poisha }
export type BillAllocation = { billId: Id; amountP: Poisha }

export type ReceiptRow = BaseRow & {
  receiptNo: string
  locationId: Id
  partyId: Id
  date: ISODate
  method: ReceiptMethod
  cashBankAccountId: Id
  amountP: Poisha
  ref?: string
  chequeId?: Id
  status: "pending" | "posted" | "timed-out" | "bounced"
  allocations: Allocation[]
  /** Unallocated, held as customer advance */
  advanceP: Poisha
  vdsDeductedP: Poisha
  aitDeductedP: Poisha
  certificateNo?: string
  /** A booking deposit for this order */
  orderId?: Id
  journalId?: Id
  idempotencyKey: string
  /** Moment the receipt was taken (MFS timeout counts from here) */
  at: Ms
  /** Cash tendered and change given (counter) */
  tenderedP?: Poisha
  changeP?: Poisha
  takenBy: Id
}

export type CustomerRefundRow = BaseRow & {
  refundNo: string
  locationId: Id
  partyId: Id
  date: ISODate
  method: "cash" | "bkash" | "nagad" | "bank-transfer"
  cashBankAccountId: Id
  amountP: Poisha
  source: "deposit" | "credit-note" | "overpayment"
  orderId?: Id
  creditNoteId?: Id
  reason: string
  journalId: Id
}

export type MatchDiff = {
  poLineId?: Id
  itemId?: Id
  field: "qty" | "price"
  expected: number
  actual: number
  /** Price difference in percent */
  diffPct?: number
}

export type VendorBillRow = BaseRow & {
  billNo: string
  /** The vendor's own invoice reference (unique per vendor, INV-12) */
  vendorRef: string
  partyId: Id
  locationId: Id
  date: ISODate
  dueDate: ISODate
  kind: "goods" | "expense" | "opening" | "summary"
  poId?: Id
  grnIds: Id[]
  hasMushak63: boolean
  subtotalP: Poisha
  inputVatP: Poisha
  totalP: Poisha
  paidP: Poisha
  /** Reduced by debit notes; open amount = total − paid − debited */
  debitedP: Poisha
  status: "on-hold" | "posted" | "partially-paid" | "paid"
  matchStatus: "matched" | "mismatch" | "n-a"
  matchDiffs: MatchDiff[]
  holdApprovalId?: Id
  journalId?: Id
}

export type VendorBillLineRow = BaseRow & {
  billId: Id
  lineNo: number
  poLineId?: Id
  grnLineId?: Id
  itemId?: Id
  expenseTag?: ExpenseTag
  description: string
  qty: number
  unitPriceP: Poisha
  vatRatePct: number
  vatP: Poisha
  netP: Poisha
  costCentreId?: Id
}

export type VendorPaymentRow = BaseRow & {
  paymentNo: string
  partyId: Id
  date: ISODate
  method: PayMethod
  cashBankAccountId: Id
  grossP: Poisha
  aitP: Poisha
  vdsP: Poisha
  netPaidP: Poisha
  allocations: BillAllocation[]
  chequeId?: Id
  chequeNo?: string
  aitCertificateNo?: string
  /** Mushak 6.6 */
  vdsCertificateNo?: string
  status: "pending-approval" | "posted" | "rejected"
  approvalId?: Id
  journalId?: Id
  preparedBy: Id
}

export type DebitNoteRow = BaseRow & {
  /** Mushak 6.8, DBN-2627-0009 */
  debitNoteNo: string
  billId?: Id
  partyId: Id
  date: ISODate
  reason: string
  netP: Poisha
  vatP: Poisha
  totalP: Poisha
  purchaseReturnId?: Id
  journalId: Id
}

export type CashBankKind = "cash-till" | "petty-cash" | "bank" | "mfs" | "card-clearing"

export type CashBankAccountRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  kind: CashBankKind
  accountTag: AccountTag
  locationId?: Id
  bankName?: string
  branchName?: string
  accountNoMasked?: string
  /** Till float */
  floatP?: Poisha
  /** Petty cash imprest */
  imprestP?: Poisha
  active: boolean
}

export type FundTransferRow = BaseRow & {
  transferNo: string
  kind: "deposit" | "withdrawal" | "transfer" | "top-up"
  fromAccountId: Id
  toAccountId: Id
  amountP: Poisha
  feesP: Poisha
  date: ISODate
  ref?: string
  journalId: Id
}

export type SettlementRow = BaseRow & {
  settlementNo: string
  kind: "card" | "bkash" | "nagad"
  clearingAccountId: Id
  bankAccountId: Id
  grossP: Poisha
  feesP: Poisha
  netP: Poisha
  date: ISODate
  ref: string
  journalId: Id
}

export type ChequeStatus =
  | "in-hand"
  | "deposited"
  | "cleared"
  | "bounced"
  | "issued"
  | "presented"
  | "cancelled"

export type ChequeRow = BaseRow & {
  direction: "received" | "issued"
  chequeNo: string
  bankName: string
  /** Our account: deposited into (received) or drawn on (issued) */
  cashBankAccountId: Id
  partyId: Id
  amountP: Poisha
  chequeDate: ISODate
  receivedOn?: ISODate
  isPdc: boolean
  status: ChequeStatus
  receiptId?: Id
  paymentId?: Id
  dueNoticeAt?: Ms
  history: { status: ChequeStatus; at: Ms; by: Id }[]
}

export type StatementLine = {
  lineId: string
  date: ISODate
  description: string
  ref: string
  /** Signed: + money in, − money out */
  amountP: Poisha
  matchedJournalLineIds: Id[]
  matchedBy?: "auto" | "manual" | "charge"
  note?: string
}

export type BankStatementRow = BaseRow & {
  cashBankAccountId: Id
  fromDate: ISODate
  toDate: ISODate
  fileName: string
  importedAt: Ms
  status: "imported" | "reconciled" | "superseded"
  openingBalanceP: Poisha
  closingBalanceP: Poisha
  lines: StatementLine[]
  reconciledAt?: Ms
  reconciledBy?: Id
}

export type PettyCashVoucherRow = BaseRow & {
  voucherNo: string
  cashBankAccountId: Id
  locationId: Id
  date: ISODate
  expenseTag: ExpenseTag
  amountP: Poisha
  payee: string
  description: string
  status: "pending-approval" | "posted" | "rejected"
  approvalId?: Id
  journalId?: Id
  preparedBy: Id
}

/* ================================================================== *
 * 5.7 Accounting and tax (FA, FRS)
 * ================================================================== */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense"

export type AccountRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  type: AccountType
  parentId?: Id
  isGroup: boolean
  normalSide: "debit" | "credit"
  tag?: AccountTag
  isControl: boolean
  active: boolean
}

export type JournalStatus = "draft" | "pending-approval" | "posted" | "reversed" | "discarded"

export type JournalSource = { app: string; docType: string; docId: Id; docNo: string }

export type JournalRow = BaseRow & {
  /** <TYPE>-<FY>-<6>: JV-2627-000417 (a draft keeps its number when it posts) */
  journalNo: string
  voucherType: VoucherType
  date: ISODate
  periodId: Id
  source?: JournalSource
  narration: string
  status: JournalStatus
  totalP: Poisha
  /** Posting rule code that built the lines (R6, R24, ...) */
  rule: string
  approvalId?: Id
  reversalOfId?: Id
  reversedById?: Id
  preparedBy: Id
  postedBy?: Id
  postedAt?: Ms
  recurringId?: Id
  /**
   * Lines of a draft or pending-approval manual voucher. `journalLines` rows
   * exist only for posted (and later reversed) journals, so the ledger never
   * needs a status filter.
   */
  draftLines?: TemplateLine[]
}

export type JournalLineRow = BaseRow & {
  journalId: Id
  lineNo: number
  accountId: Id
  debitP: Poisha
  creditP: Poisha
  partyId?: Id
  costCentreId?: Id
  locationId?: Id
  itemId?: Id
  description?: string
  /** Denormalised for reports */
  date: ISODate
  periodId: Id
  voucherType: VoucherType
  /** Set when the line is matched to a bank statement line */
  reconciledStatementLineId?: string
}

/** A line of a manual voucher or recurring template, before posting. */
export type TemplateLine = {
  /** An account id or a system tag */
  account: Id | AccountTag
  debitP: Poisha
  creditP: Poisha
  partyId?: Id
  costCentreId?: Id
  locationId?: Id
  description?: string
}

export type RecurringJournalRow = BaseRow & {
  code: string
  nameEn: string
  nameBn: string
  frequency: "monthly"
  kind: "depreciation" | "salary-accrual" | "prepaid-amortisation" | "custom"
  lines: TemplateLine[]
  lastPostedPeriodId?: Id
  active: boolean
}

export type VatReturnRow = BaseRow & {
  periodId: Id
  /** YYYY-MM the return is for */
  month: string
  outputVatP: Poisha
  inputVatP: Poisha
  vdsCreditP: Poisha
  carryInP: Poisha
  netPayableP: Poisha
  carryForwardP: Poisha
  status: "submitted"
  nbrRef: string
  submittedBy: Id
  submittedAt: Ms
  journalId: Id
}

export type TaxDepositRow = BaseRow & {
  depositNo: string
  /** YYYY-MM the tax is for (may precede the books for opening liabilities) */
  forMonth: string
  kind: "vat" | "vds" | "ait"
  amountP: Poisha
  cashBankAccountId: Id
  challanRef: string
  date: ISODate
  journalId: Id
}

/* ================================================================== *
 * 5.8 Purchasing and inventory (PTL, GRN, ST, IC)
 * ================================================================== */

export type PurchaseRequisitionRow = BaseRow & {
  prNo: string
  locationId: Id
  requestedBy: Id
  reason: "reorder" | "job-demand" | "manual"
  status: "draft" | "pending-approval" | "approved" | "rejected" | "ordered"
  totalP: Poisha
  approvalId?: Id
  note?: string
  date: ISODate
}

export type PrLineRow = BaseRow & {
  prId: Id
  itemId: Id
  /** Purchase units */
  qty: number
  estUnitCostP: Poisha
  suggestedVendorId?: Id
}

export type PurchaseOrderRow = BaseRow & {
  poNo: string
  vendorId: Id
  /** Deliver to */
  locationId: Id
  prId?: Id
  status: "draft" | "pending-approval" | "issued" | "partial" | "received" | "closed" | "cancelled"
  orderDate: ISODate
  expectedDate: ISODate
  subtotalP: Poisha
  vatP: Poisha
  totalP: Poisha
  approvalId?: Id
  sentAt?: Ms
  buyerId: Id
  cancelReason?: string
}

export type PoLineRow = BaseRow & {
  poId: Id
  lineNo: number
  itemId: Id
  /** Purchase units */
  qty: number
  /** Per purchase unit */
  unitCostP: Poisha
  vatRatePct: number
  qtyReceived: number
  qtyRejected: number
  qtyReturned: number
  qtyBilled: number
}

export type GrnRow = BaseRow & {
  grnNo: string
  poId: Id
  vendorId: Id
  locationId: Id
  vendorChallanNo?: string
  receivedBy: Id
  receivedAt: Ms
  date: ISODate
  note?: string
  journalId?: Id
}

export type RejectReason = "damaged" | "short-expiry" | "wrong-item" | "other"

export type GrnLineRow = BaseRow & {
  grnId: Id
  poLineId: Id
  itemId: Id
  batchNo?: string
  expiry?: ISODate
  /** Purchase units */
  qtyReceived: number
  qtyAccepted: number
  qtyRejected: number
  qtyReturned: number
  qtyBilled: number
  rejectReason?: RejectReason
  quarantine: boolean
  quarantineStatus?: "held" | "accepted" | "returned"
  batchId?: Id
  /** Per purchase unit (PO cost) */
  unitCostP: Poisha
}

export type PurchaseReturnLine = {
  grnLineId: Id
  itemId: Id
  batchId?: Id
  qtyBase: number
  valueP: Poisha
}

export type PurchaseReturnRow = BaseRow & {
  returnNo: string
  vendorId: Id
  grnId?: Id
  locationId: Id
  date: ISODate
  reason: string
  lines: PurchaseReturnLine[]
  billId?: Id
  debitNoteId?: Id
  journalId: Id
}

export type BatchRow = BaseRow & {
  itemId: Id
  batchNo: string
  expiry?: ISODate
  receivedAt: Ms
  grnLineId?: Id
  status: "ok" | "quarantine" | "expired"
  expiryAlertAt?: Ms
}

/** Quantities per item, location and batch (FEFO). id = sb:<item>:<location>:<batch|->. */
export type StockBalanceRow = BaseRow & {
  itemId: Id
  locationId: Id
  batchId?: Id
  /** Usable base units (excludes quarantined); `updatedAt` comes from the base row */
  qtyBase: number
  quarantinedQty: number
}

/** Authoritative value per item and location. id = sv:<item>:<location>. */
export type StockValueRow = BaseRow & {
  itemId: Id
  locationId: Id
  qtyBase: number
  valueP: Poisha
}

export type StockMoveType =
  | "opening"
  | "grn"
  | "issue-job"
  | "sale-delivery"
  | "transfer-out"
  | "transfer-in"
  | "adjust"
  | "count-variance"
  | "return-vendor"
  | "return-customer"
  | "internal-use"
  | "quarantine"
  | "quarantine-accept"
  | "quarantine-return"

export type StockMoveRow = BaseRow & {
  itemId: Id
  locationId: Id
  batchId?: Id
  type: StockMoveType
  /** Signed base units */
  qtyBase: number
  /** Signed poisha */
  valueP: Poisha
  ref: DocRef
  at: Ms
  date: ISODate
  journalId?: Id
}

export type TransferRow = BaseRow & {
  /** Mushak 6.5 challan, TRF-2627-0157 */
  transferNo: string
  fromLocationId: Id
  toLocationId: Id
  status: "requested" | "dispatched" | "received" | "cancelled"
  requestedBy: Id
  requestedAt: Ms
  dispatchedBy?: Id
  dispatchedAt?: Ms
  receivedBy?: Id
  receivedAt?: Ms
  vehicleNo?: string
  note?: string
  dispatchJournalId?: Id
  receiveJournalId?: Id
}

export type TransferLineRow = BaseRow & {
  transferId: Id
  itemId: Id
  batchId?: Id
  /** Base units */
  qtyRequested: number
  qtySent: number
  qtyReceived: number
  /** Per base unit at dispatch (display) */
  unitCostP: number
  /** The value that left the source */
  valueP: Poisha
  discrepancyNote?: string
}

export type AdjustmentLine = { itemId: Id; batchId?: Id; qtyBase: number; valueP: Poisha }

export type StockAdjustmentRow = BaseRow & {
  adjustmentNo: string
  locationId: Id
  date: ISODate
  reason: "damage" | "expiry" | "loss" | "found" | "correction" | "internal-use"
  expenseTag?: ExpenseTag
  note?: string
  lines: AdjustmentLine[]
  status: "pending-approval" | "posted" | "rejected"
  approvalId?: Id
  journalId?: Id
  preparedBy: Id
}

export type CountLine = {
  itemId: Id
  batchId?: Id
  expectedQty: number
  countedQty?: number
  varianceQty: number
  varianceValueP: Poisha
}

export type StockCountRow = BaseRow & {
  countNo: string
  locationId: Id
  scope: "all" | Id[]
  status: "open" | "counted" | "pending-approval" | "posted" | "cancelled"
  snapshotAt: Ms
  date: ISODate
  lines: CountLine[]
  approvalId?: Id
  journalId?: Id
  openedBy: Id
}

/* ================================================================== *
 * 5.9 Reporting (IRT)
 * ================================================================== */

export type ReportFilter = {
  field: string
  op: "eq" | "neq" | "in" | "gte" | "lte" | "between" | "contains"
  value: string | number | (string | number)[]
}

export type ReportDefinitionRow = BaseRow & {
  /** IRT-01 .. IRT-33 for system reports */
  code: string
  nameEn: string
  nameBn: string
  suite: "fms" | "sdm" | "scm" | "csc"
  app: string
  /** A dataset code, or undefined when the report is an FRS screen */
  dataset?: string
  frsRoute?: string
  columns: string[]
  filters: ReportFilter[]
  /** Relative date range applied by default (e.g. last 30 days) */
  dateRange?: { field: string; lastDays?: number; preset?: "mtd" | "ytd" | "last-month" }
  groupBy?: string[]
  sort?: { field: string; dir: "asc" | "desc" }
  totals: string[]
  chart?: { kind: "bar" | "line" | "donut"; x: string; y: string; series?: string }
  isSystem: boolean
  ownerId?: Id
  shared: boolean
  descriptionEn?: string
  descriptionBn?: string
}

export type ReportRunRow = BaseRow & {
  definitionId: Id
  runBy: Id
  at: Ms
  params: Record<string, unknown>
  rowCount: number
}

export type ReportScheduleRow = BaseRow & {
  definitionId: Id
  frequency: "daily" | "weekly" | "monthly"
  time: HHMM
  recipients: string[]
  format: "csv" | "pdf"
  active: boolean
  lastSentAt?: Ms
  nextDueAt?: Ms
  ownerId: Id
}

/* ================================================================== *
 * 5.10 Communication, platform and demo
 * ================================================================== */

export type NotificationRow = BaseRow & {
  userId: Id
  kind: string
  titleKey: string
  params: Record<string, string | number>
  refs: Refs
  /** Route to open */
  href?: string
  read: boolean
  at: Ms
}

export type SmsRow = BaseRow & {
  to: string
  partyId?: Id
  locationId?: Id
  lang: Locale
  templateId: string
  /** Document numbers, dates and amounts only (§11) */
  text: string
  parts: number
  encoding: "GSM" | "UCS-2"
  kind: "transactional" | "promotional"
  status: "queued" | "sent" | "delivered" | "failed"
  queuedAt: Ms
  deliveredAt?: Ms
}

export type EmailRow = BaseRow & {
  to: string[]
  subjectKey: string
  params: Record<string, string | number>
  /** Attachment names (not generated) */
  attachments: string[]
  status: "queued" | "sent"
  at: Ms
  refs: Refs
}

export type ScenarioRunRow = BaseRow & {
  scenarioId: string
  at: Ms
  userId: Id
  refs: Refs
}

/* ---------------- Engine-owned (no BaseRow) ---------------- */

/** Who committed, as recorded on events and audit rows. */
export type ActorRef = {
  userId: Id
  username: string
  name: string
  sessionId: string | null
  locationId: Id | null
}

export type EventRow = {
  /** Global order within this database; assigned under the commit lock */
  seq: number
  id: Id
  type: string
  v: number
  /** Demo-clock time */
  at: Ms
  /** Wall-clock time the commit happened */
  realAt: number
  actor: ActorRef
  locationId: Id | null
  /** Owning app of the event (from the catalog), for filters */
  app: string
  refs: Refs
  summaryKey: string
  params: Record<string, string | number>
  consumers: string[]
  commitId: Id
  command: string
  origin: Origin
}

export type AuditAction = "insert" | "update" | "delete" | "blocked" | "system"

export type AuditRow = {
  seq: number
  commitId: Id
  command: string
  /** App of the command (the prefix of its name) */
  app: string
  at: Ms
  actor: ActorRef
  action: AuditAction
  /** Table name, or "command" for blocked attempts and system entries */
  entity: string
  entityId: Id
  /** Document number when the row is a document */
  docNo?: string
  /** Changed fields only, before and after */
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reason?: string
  approvedBy?: Id
  /** Rule code for blocked attempts */
  code?: string
  origin: Origin
  prevHash: string
  hash: string
}

export type CounterRow = { id: string; value: number }

export type IdempotencyRow = {
  key: string
  commitId: Id
  command: string
  result: unknown
  at: Ms
}

/* ---------------- Control database (demo controls) ---------------- */

export type ClockRow = { id: "clock"; offsetMs: number; updatedAt: number }

export type DemoMetaRow = {
  id: "meta"
  seedVersion: number
  /** Wall-clock time of the last seed */
  seededAt: number
  /** Demo day the seed is anchored to */
  seedDate: ISODate
  scale: "full" | "small"
}
