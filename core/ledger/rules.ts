import type { AccountTag, ExpenseTag, Id, InventoryTag, Poisha, RevenueTag, VoucherType } from "@/core/db/schema"

/**
 * Posting rules as pure functions (plan §3.4, accounting_rules.md §3): one
 * `linesFor<Doc>` per document type, R1a to R28. No database access. Commands
 * AND the seed call them and pass the result to `postJournal`, so seeded and
 * live books follow identical rules. Workstreams never build journal lines by
 * hand.
 *
 * Amounts: gross = qty × unit price; net = gross − discount; VAT on net;
 * total = net + VAT. Every amount is integer poisha.
 */

/** A journal line before posting: an account (system tag or account id) and one side. */
export type LineInput = {
  account: AccountTag | Id
  debitP?: Poisha
  creditP?: Poisha
  partyId?: Id
  costCentreId?: Id
  locationId?: Id
  itemId?: Id
  description?: string
}

export type RuleCode =
  | "R1a" | "R1b" | "R2" | "R2b" | "R2c" | "R2d" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8"
  | "R9" | "R10" | "R11" | "R12" | "R13" | "R14" | "R15" | "R16" | "R17" | "R18" | "R19"
  | "R20" | "R21" | "R22" | "R23" | "R24" | "R25" | "R26" | "R27a" | "R27b" | "R28"

/** The voucher type each rule posts as (accounting_rules.md §3). R24 may also be PV, RV or CV. */
export const RULE_VOUCHER: Record<RuleCode, VoucherType> = {
  R1a: "OB", R1b: "YC", R2: "SM", R2b: "SM", R2c: "SM", R2d: "SM",
  R3: "RV", R4: "IV", R5: "IV", R6: "SV", R7: "RV", R8: "RV", R9: "RV", R10: "RV",
  R11: "SV", R12: "PJ", R13: "PJ", R14: "PJ", R15: "PV", R16: "PJ", R17: "CV", R18: "CV",
  R19: "PV", R20: "IV", R21: "IV", R22: "IV", R23: "PV", R24: "JV", R25: "JV", R26: "JV",
  R27a: "JV", R27b: "PV", R28: "PV",
}

const dr = (account: AccountTag | Id, amountP: Poisha, dims: Omit<LineInput, "account" | "debitP" | "creditP"> = {}): LineInput => ({
  account,
  debitP: amountP,
  ...dims,
})
const cr = (account: AccountTag | Id, amountP: Poisha, dims: Omit<LineInput, "account" | "debitP" | "creditP"> = {}): LineInput => ({
  account,
  creditP: amountP,
  ...dims,
})

/** A debit when positive, a credit when negative (variances). */
const signed = (account: AccountTag | Id, amountP: Poisha, dims: Omit<LineInput, "account" | "debitP" | "creditP"> = {}): LineInput =>
  amountP >= 0 ? dr(account, amountP, dims) : cr(account, -amountP, dims)

/** Drop lines with no amount (a zero discount, no VAT). */
export function compact(lines: LineInput[]): LineInput[] {
  return lines.filter((l) => (l.debitP ?? 0) !== 0 || (l.creditP ?? 0) !== 0)
}

export function totals(lines: LineInput[]): { debitP: Poisha; creditP: Poisha } {
  let debitP = 0
  let creditP = 0
  for (const l of lines) {
    debitP += l.debitP ?? 0
    creditP += l.creditP ?? 0
  }
  return { debitP, creditP }
}

/** Sum amounts by a key (revenue per tag, consumption per inventory tag). */
function sumBy<T>(rows: T[], key: (row: T) => string, amount: (row: T) => Poisha): Map<string, Poisha> {
  const out = new Map<string, Poisha>()
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + amount(row))
  return out
}

/* ================================================================== *
 * R1a Opening balances (seed) · R1b Year-end closing (seed)
 * ================================================================== */

export type OpeningBalance = {
  account: AccountTag | Id
  /** Positive = debit balance, negative = credit balance */
  balanceP: Poisha
  partyId?: Id
  locationId?: Id
  description?: string
}

/** R1a: every opening balance at F; retained earnings takes the balancing figure. */
export function linesForOpeningBalances(balances: OpeningBalance[]): LineInput[] {
  const lines = balances.map((b) => signed(b.account, b.balanceP, { partyId: b.partyId, locationId: b.locationId, description: b.description }))
  const { debitP, creditP } = totals(lines)
  lines.push(signed("RETAINED_EARNINGS", creditP - debitP))
  return compact(lines)
}

export type YearBalance = {
  account: Id
  type: "income" | "expense"
  /** The year's balance, positive = debit */
  balanceP: Poisha
  locationId?: Id
}

/** R1b: close every income and expense balance of the year to retained earnings. */
export function linesForYearEndClosing(balances: YearBalance[]): LineInput[] {
  const lines = balances.map((b) => signed(b.account, -b.balanceP, { locationId: b.locationId }))
  const { debitP, creditP } = totals(lines)
  lines.push(signed("RETAINED_EARNINGS", creditP - debitP))
  return compact(lines)
}

/* ================================================================== *
 * R2 to R2d Summary history before the cutover (seed only)
 * ================================================================== */

export type DailySummaryInput = {
  locationId: Id
  /** Collections by account tag (till, MFS wallets, CARD_CLEARING) */
  collections: { tag: AccountTag; amountP: Poisha }[]
  discountP: Poisha
  revenue: { tag: RevenueTag; grossP: Poisha }[]
  vatP: Poisha
  /** Consumption of all the day's jobs at standard cost, by inventory tag */
  consumption: { tag: InventoryTag; valueP: Poisha }[]
  /** Retail goods sold at standard cost */
  cogsP: Poisha
}

/** R2: daily retail summary per studio (retail sales; consumption of every job). */
export function linesForDailySummary(input: DailySummaryInput): LineInput[] {
  const at = { locationId: input.locationId }
  const lines: LineInput[] = []
  for (const c of input.collections) lines.push(dr(c.tag, c.amountP, at))
  lines.push(dr("DISCOUNTS", input.discountP, at))
  for (const [tag, gross] of sumBy(input.revenue, (r) => r.tag, (r) => r.grossP)) lines.push(cr(tag, gross, at))
  lines.push(cr("VAT_OUTPUT", input.vatP, at))
  const consumed = input.consumption.reduce((s, c) => s + c.valueP, 0)
  lines.push(dr("CONSUMABLES_USED", consumed, at))
  for (const [tag, value] of sumBy(input.consumption, (c) => c.tag, (c) => c.valueP)) lines.push(cr(tag, value, at))
  lines.push(dr("COGS", input.cogsP, at))
  lines.push(cr("INV_RETAIL", input.cogsP, at))
  return compact(lines)
}

/** R2b: monthly summary purchase per goods vendor (backed by a `summary` bill). */
export function linesForSummaryPurchase(input: {
  partyId: Id
  locationId: Id
  tag: InventoryTag
  netP: Poisha
  vatP: Poisha
}): LineInput[] {
  return compact([
    dr(input.tag, input.netP, { locationId: input.locationId }),
    dr("VAT_CURRENT", input.vatP, { locationId: input.locationId }),
    cr("AP_CONTROL", input.netP + input.vatP, { partyId: input.partyId, locationId: input.locationId }),
  ])
}

/** R2c: monthly summary transfer per studio and tag, CST to the studio (no item). */
export function linesForSummaryTransfer(input: {
  tag: InventoryTag
  fromLocationId: Id
  toLocationId: Id
  valueP: Poisha
}): LineInput[] {
  return compact([
    dr(input.tag, input.valueP, { locationId: input.toLocationId }),
    cr(input.tag, input.valueP, { locationId: input.fromLocationId }),
  ])
}

/** R2d: shrinkage before the cutover, when a balancing purchase would be negative. */
export function linesForShrinkage(input: { tag: InventoryTag; locationId: Id; valueP: Poisha }): LineInput[] {
  return compact([
    dr("INV_LOSS", input.valueP, { locationId: input.locationId }),
    cr(input.tag, input.valueP, { locationId: input.locationId }),
  ])
}

/* ================================================================== *
 * R3, R7 to R10, R28 Customer money
 * ================================================================== */

/** R3: booking deposit, held as customer advance. */
export function linesForDeposit(input: { cashTag: AccountTag; amountP: Poisha; partyId: Id; locationId: Id }): LineInput[] {
  return compact([
    dr(input.cashTag, input.amountP, { locationId: input.locationId }),
    cr("CUSTOMER_ADVANCE", input.amountP, { partyId: input.partyId, locationId: input.locationId }),
  ])
}

/** R7: counter tenders final at checkout (cash net of change, card). bKash and Nagad post later (R9). */
export function linesForCounterTenders(input: {
  partyId: Id
  locationId: Id
  tenders: { cashTag: AccountTag; amountP: Poisha }[]
}): LineInput[] {
  const lines: LineInput[] = []
  for (const t of input.tenders) {
    lines.push(dr(t.cashTag, t.amountP, { locationId: input.locationId }))
    lines.push(cr("AR_CONTROL", t.amountP, { partyId: input.partyId, locationId: input.locationId }))
  }
  return compact(lines)
}

export type ReceiptLinesInput = {
  partyId: Id
  locationId: Id
  /** The account the money lands in (till, bank, MFS wallet, CARD_CLEARING) */
  cashTag: AccountTag
  /** Money received (net of the customer's deductions) */
  amountP: Poisha
  /** VAT the customer deducted at source (VDS, with a Mushak 6.6) */
  vdsP: Poisha
  /** AIT the customer deducted */
  aitP: Poisha
  /** Allocated to invoices */
  allocatedP: Poisha
  /** Unallocated, held as customer advance */
  advanceP: Poisha
}

function receiptLines(input: ReceiptLinesInput): LineInput[] {
  const at = { locationId: input.locationId }
  const party = { partyId: input.partyId, locationId: input.locationId }
  return compact([
    dr(input.cashTag, input.amountP, at),
    dr("VAT_CURRENT", input.vdsP, at),
    dr("AIT_PAID", input.aitP, at),
    cr("AR_CONTROL", input.allocatedP, party),
    cr("CUSTOMER_ADVANCE", input.advanceP, party),
  ])
}

/** R8: customer receipt (cash, card, bank transfer, confirmed MFS) with deductions. */
export const linesForReceipt = receiptLines
/** R9: MFS confirmation: exactly what the pending receipt reserved, the rest as advance. */
export const linesForMfsConfirmation = (input: Omit<ReceiptLinesInput, "vdsP" | "aitP">) =>
  receiptLines({ ...input, vdsP: 0, aitP: 0 })
/** R10: received cheque cleared, dated the clearing day, the bank as the debit. */
export const linesForChequeCleared = receiptLines

/** R28: refund of a customer advance or credit balance. */
export function linesForRefund(input: { partyId: Id; cashTag: AccountTag; amountP: Poisha; locationId: Id }): LineInput[] {
  return compact([
    dr("CUSTOMER_ADVANCE", input.amountP, { partyId: input.partyId, locationId: input.locationId }),
    cr(input.cashTag, input.amountP, { locationId: input.locationId }),
  ])
}

/* ================================================================== *
 * R4, R5 Stock out to jobs and sales · R6, R11 Invoices and credit notes
 * ================================================================== */

export type ValuedItemLine = { itemId: Id; tag: InventoryTag; valueP: Poisha }

/** R4: job consumption at average cost; `reverse` for a return of unused stock. */
export function linesForJobConsumption(input: {
  locationId: Id
  lines: ValuedItemLine[]
  reverse?: boolean
}): LineInput[] {
  const total = input.lines.reduce((s, l) => s + l.valueP, 0)
  const at = { locationId: input.locationId }
  const lines: LineInput[] = [dr("CONSUMABLES_USED", total, at)]
  for (const l of input.lines) lines.push(cr(l.tag, l.valueP, { ...at, itemId: l.itemId }))
  return compact(input.reverse ? swapSides(lines) : lines)
}

/** R5: retail goods out at average cost. */
export function linesForRetailGoodsOut(input: { locationId: Id; lines: { itemId: Id; valueP: Poisha }[] }): LineInput[] {
  const total = input.lines.reduce((s, l) => s + l.valueP, 0)
  const at = { locationId: input.locationId }
  return compact([
    dr("COGS", total, at),
    ...input.lines.map((l) => cr("INV_RETAIL", l.valueP, { ...at, itemId: l.itemId })),
  ])
}

export type InvoiceRuleLine = { revenueTag: RevenueTag; grossP: Poisha; discountP: Poisha; vatP: Poisha }

/** Invoice total from its lines: Σ(gross − discount + VAT). */
export function invoiceTotal(lines: InvoiceRuleLine[]): Poisha {
  return lines.reduce((s, l) => s + l.grossP - l.discountP + l.vatP, 0)
}

/**
 * R6: sales invoice. Dr AR (total), Dr discounts, Cr revenue per tag (gross),
 * Cr output VAT; advance applied in the same voucher: Dr customer advance,
 * Cr AR.
 */
export function linesForSalesInvoice(input: {
  partyId: Id
  locationId: Id
  lines: InvoiceRuleLine[]
  advanceAppliedP: Poisha
}): LineInput[] {
  const at = { locationId: input.locationId }
  const party = { partyId: input.partyId, locationId: input.locationId }
  const discount = input.lines.reduce((s, l) => s + l.discountP, 0)
  const vat = input.lines.reduce((s, l) => s + l.vatP, 0)
  const lines: LineInput[] = [dr("AR_CONTROL", invoiceTotal(input.lines), party), dr("DISCOUNTS", discount, at)]
  for (const [tag, gross] of sumBy(input.lines, (l) => l.revenueTag, (l) => l.grossP)) lines.push(cr(tag, gross, at))
  lines.push(cr("VAT_OUTPUT", vat, at))
  lines.push(dr("CUSTOMER_ADVANCE", input.advanceAppliedP, party))
  lines.push(cr("AR_CONTROL", input.advanceAppliedP, party))
  return compact(lines)
}

/**
 * R11: credit note. Reverses revenue (gross), discount and VAT of the credited
 * lines; Cr AR up to the invoice's open amount, Cr customer advance for the
 * rest; with restock, Dr inventory at the studio's average cost, Cr COGS.
 */
export function linesForCreditNote(input: {
  partyId: Id
  locationId: Id
  lines: InvoiceRuleLine[]
  /** Part credited against the invoice's open amount */
  toInvoiceP: Poisha
  /** The rest, held as customer advance */
  toAdvanceP: Poisha
  restock?: ValuedItemLine[]
}): LineInput[] {
  const at = { locationId: input.locationId }
  const party = { partyId: input.partyId, locationId: input.locationId }
  const lines: LineInput[] = []
  for (const [tag, gross] of sumBy(input.lines, (l) => l.revenueTag, (l) => l.grossP)) lines.push(dr(tag, gross, at))
  lines.push(cr("DISCOUNTS", input.lines.reduce((s, l) => s + l.discountP, 0), at))
  lines.push(dr("VAT_OUTPUT", input.lines.reduce((s, l) => s + l.vatP, 0), at))
  lines.push(cr("AR_CONTROL", input.toInvoiceP, party))
  lines.push(cr("CUSTOMER_ADVANCE", input.toAdvanceP, party))
  const restock = input.restock ?? []
  for (const r of restock) lines.push(dr(r.tag, r.valueP, { ...at, itemId: r.itemId }))
  lines.push(cr("COGS", restock.reduce((s, r) => s + r.valueP, 0), at))
  return compact(lines)
}

/* ================================================================== *
 * R12 to R16 Purchasing and payables
 * ================================================================== */

/** R12: goods accepted at PO cost (GRN, quarantine accepted). */
export function linesForGoodsAccepted(input: { partyId: Id; locationId: Id; lines: ValuedItemLine[] }): LineInput[] {
  const at = { locationId: input.locationId }
  return compact([
    ...input.lines.map((l) => dr(l.tag, l.valueP, { ...at, itemId: l.itemId })),
    cr("GRNI", input.lines.reduce((s, l) => s + l.valueP, 0), { partyId: input.partyId, locationId: input.locationId }),
  ])
}

/**
 * R13: goods bill (matched, or released from hold). Dr GRNI at the PO price,
 * the price difference to PPV, input VAT to the VAT current account with a
 * Mushak 6.3 (else to PPV, not creditable), Cr AP for the bill total.
 */
export function linesForGoodsBill(input: {
  partyId: Id
  locationId: Id
  lines: { grniP: Poisha; ppvP: Poisha; vatP: Poisha }[]
  hasMushak63: boolean
}): LineInput[] {
  const at = { locationId: input.locationId }
  const party = { partyId: input.partyId, locationId: input.locationId }
  const grni = input.lines.reduce((s, l) => s + l.grniP, 0)
  const ppv = input.lines.reduce((s, l) => s + l.ppvP, 0)
  const vat = input.lines.reduce((s, l) => s + l.vatP, 0)
  return compact([
    dr("GRNI", grni, party),
    signed("PPV", ppv + (input.hasMushak63 ? 0 : vat), at),
    dr("VAT_CURRENT", input.hasMushak63 ? vat : 0, at),
    cr("AP_CONTROL", grni + ppv + vat, party),
  ])
}

/** R14: expense bill. VAT to the VAT current account with a Mushak 6.3, else added to the expense. */
export function linesForExpenseBill(input: {
  partyId: Id
  locationId: Id
  lines: { expenseTag: ExpenseTag; netP: Poisha; vatP: Poisha; costCentreId?: Id; locationId?: Id }[]
  hasMushak63: boolean
}): LineInput[] {
  const lines: LineInput[] = []
  let total = 0
  let creditable = 0
  for (const l of input.lines) {
    total += l.netP + l.vatP
    if (input.hasMushak63) creditable += l.vatP
    lines.push(
      dr(l.expenseTag, l.netP + (input.hasMushak63 ? 0 : l.vatP), {
        locationId: l.locationId ?? input.locationId,
        costCentreId: l.costCentreId,
      })
    )
  }
  lines.push(dr("VAT_CURRENT", creditable, { locationId: input.locationId }))
  lines.push(cr("AP_CONTROL", total, { partyId: input.partyId, locationId: input.locationId }))
  return compact(lines)
}

/** R15: vendor payment, AIT and VDS withheld at source. */
export function linesForVendorPayment(input: {
  partyId: Id
  cashTag: AccountTag
  grossP: Poisha
  aitP: Poisha
  vdsP: Poisha
  locationId?: Id
}): LineInput[] {
  const at = { locationId: input.locationId }
  return compact([
    dr("AP_CONTROL", input.grossP, { partyId: input.partyId, locationId: input.locationId }),
    cr(input.cashTag, input.grossP - input.aitP - input.vdsP, at),
    cr("AIT_PAYABLE", input.aitP, at),
    cr("VDS_PAYABLE", input.vdsP, at),
  ])
}

/**
 * R16: purchase return. Not yet billed: Dr GRNI at the PO cost. Billed: the
 * bill price plus its VAT, Dr AP up to the bill's open amount, Dr advances to
 * suppliers for the rest, Cr the VAT claimed. Then Cr inventory at average
 * cost, the difference to PPV.
 */
export function linesForPurchaseReturn(input: {
  partyId: Id
  locationId: Id
  billed: boolean
  lines: {
    itemId: Id
    tag: InventoryTag
    /** Value leaving stock at the location's average cost */
    stockValueP: Poisha
    /** PO cost (unbilled) or bill price (billed) of the returned quantity */
    priceValueP: Poisha
    /** VAT on the bill price (billed only) */
    vatP: Poisha
  }[]
  /** Bill's open amount (billed only) */
  apOpenP?: Poisha
  /** Whether the bill's input VAT was claimed (had a Mushak 6.3) */
  vatClaimed?: boolean
}): LineInput[] {
  const at = { locationId: input.locationId }
  const party = { partyId: input.partyId, locationId: input.locationId }
  const price = input.lines.reduce((s, l) => s + l.priceValueP, 0)
  const stock = input.lines.reduce((s, l) => s + l.stockValueP, 0)
  const lines: LineInput[] = []
  if (!input.billed) {
    lines.push(dr("GRNI", price, party))
  } else {
    const vat = input.lines.reduce((s, l) => s + l.vatP, 0)
    const claimed = input.vatClaimed ? vat : 0
    const due = price + claimed
    const toAp = Math.min(due, Math.max(0, input.apOpenP ?? due))
    lines.push(dr("AP_CONTROL", toAp, party))
    lines.push(dr("ADV_VENDOR", due - toAp, party))
    lines.push(cr("VAT_CURRENT", claimed, at))
  }
  for (const l of input.lines) lines.push(cr(l.tag, l.stockValueP, { ...at, itemId: l.itemId }))
  lines.push(signed("PPV", stock - price, at))
  return compact(lines)
}

/* ================================================================== *
 * R17 to R19, R23 Cash and bank
 * ================================================================== */

/** R17: contra transfer between cash, bank, MFS and petty cash; fees to bank charges. */
export function linesForContra(input: {
  fromTag: AccountTag
  toTag: AccountTag
  amountP: Poisha
  feesP?: Poisha
  fromLocationId?: Id
  toLocationId?: Id
}): LineInput[] {
  const fees = input.feesP ?? 0
  return compact([
    dr(input.toTag, input.amountP, { locationId: input.toLocationId }),
    dr("BANK_CHARGES", fees, { locationId: input.fromLocationId }),
    cr(input.fromTag, input.amountP + fees, { locationId: input.fromLocationId }),
  ])
}

/** R18: card or MFS settlement to bank with merchant fees. */
export function linesForSettlement(input: {
  clearingTag: AccountTag
  bankTag: AccountTag
  grossP: Poisha
  feesP: Poisha
  locationId?: Id
}): LineInput[] {
  const at = { locationId: input.locationId }
  return compact([
    dr(input.bankTag, input.grossP - input.feesP, at),
    dr("MERCHANT_FEES", input.feesP, at),
    cr(input.clearingTag, input.grossP, at),
  ])
}

/** R19: petty cash voucher. */
export function linesForPettyCash(input: {
  pettyTag: AccountTag
  expenseTag: ExpenseTag
  amountP: Poisha
  locationId: Id
  costCentreId?: Id
}): LineInput[] {
  return compact([
    dr(input.expenseTag, input.amountP, { locationId: input.locationId, costCentreId: input.costCentreId }),
    cr(input.pettyTag, input.amountP, { locationId: input.locationId }),
  ])
}

/** R23: bank charge found in reconciliation. */
export function linesForBankCharge(input: { bankTag: AccountTag; amountP: Poisha; locationId?: Id }): LineInput[] {
  return compact([
    dr("BANK_CHARGES", input.amountP, { locationId: input.locationId }),
    cr(input.bankTag, input.amountP, { locationId: input.locationId }),
  ])
}

/* ================================================================== *
 * R20 to R22 Stock movements
 * ================================================================== */

/** R20: transfer dispatch into transit at the source's average cost. */
export function linesForTransferDispatch(input: {
  fromLocationId: Id
  toLocationId: Id
  lines: ValuedItemLine[]
}): LineInput[] {
  const lines: LineInput[] = []
  for (const l of input.lines) {
    lines.push(dr("INV_TRANSIT", l.valueP, { itemId: l.itemId, locationId: input.toLocationId }))
    lines.push(cr(l.tag, l.valueP, { itemId: l.itemId, locationId: input.fromLocationId }))
  }
  return compact(lines)
}

/** R21: transfer receipt at the carried value; a shortfall's share to inventory loss. */
export function linesForTransferReceipt(input: {
  toLocationId: Id
  lines: { itemId: Id; tag: InventoryTag; receivedValueP: Poisha; shortfallValueP: Poisha }[]
}): LineInput[] {
  const lines: LineInput[] = []
  const at = { locationId: input.toLocationId }
  for (const l of input.lines) {
    lines.push(dr(l.tag, l.receivedValueP, { ...at, itemId: l.itemId }))
    lines.push(dr("INV_LOSS", l.shortfallValueP, at))
    lines.push(cr("INV_TRANSIT", l.receivedValueP + l.shortfallValueP, { ...at, itemId: l.itemId }))
  }
  return compact(lines)
}

/**
 * R22: stock adjustment, count variance or internal use. Loss (negative
 * value): Dr inventory loss (or the chosen expense for internal use), Cr
 * inventory. Gain (positive): Dr inventory, Cr inventory loss.
 */
export function linesForStockAdjustment(input: {
  locationId: Id
  lines: { itemId: Id; tag: InventoryTag; valueP: Poisha }[]
  internalUseTag?: ExpenseTag
}): LineInput[] {
  const at = { locationId: input.locationId }
  const offset = input.internalUseTag ?? "INV_LOSS"
  const lines: LineInput[] = []
  for (const l of input.lines) {
    if (l.valueP >= 0) {
      lines.push(dr(l.tag, l.valueP, { ...at, itemId: l.itemId }))
      lines.push(cr(offset, l.valueP, at))
    } else {
      lines.push(dr(offset, -l.valueP, at))
      lines.push(cr(l.tag, -l.valueP, { ...at, itemId: l.itemId }))
    }
  }
  return compact(lines)
}

/* ================================================================== *
 * R24 to R26 Manual, recurring, reversal
 * ================================================================== */

/** R24: manual voucher, as entered (INV-03 keeps it off control accounts). */
export function linesForManualVoucher(lines: LineInput[]): LineInput[] {
  return compact(lines)
}

/** R25: a recurring template's lines for one period (amounts computed by the template). */
export function linesForRecurring(lines: LineInput[]): LineInput[] {
  return compact(lines)
}

/** Monthly straight-line depreciation: cost × annual rate / 12, rounded half up. */
export function monthlyDepreciationP(costP: Poisha, annualPct: number): Poisha {
  return Math.round((costP * annualPct) / 100 / 12)
}

/** R26: reversal, every line with debit and credit swapped. */
export function linesForReversal(lines: LineInput[]): LineInput[] {
  return compact(swapSides(lines))
}

function swapSides(lines: LineInput[]): LineInput[] {
  return lines.map((l) => ({ ...l, debitP: l.creditP, creditP: l.debitP }))
}

/* ================================================================== *
 * R27a, R27b Tax
 * ================================================================== */

/**
 * R27a: VAT return settlement. Sets off min(output VAT of the month, input
 * VAT + VDS credits + carry-forward in); what remains on output VAT is the net
 * payable, what remains of the credits carries forward.
 */
export function vatSettlement(input: { outputVatP: Poisha; creditsP: Poisha }): {
  setOffP: Poisha
  netPayableP: Poisha
  carryForwardP: Poisha
  lines: LineInput[]
} {
  const setOffP = Math.min(input.outputVatP, input.creditsP)
  return {
    setOffP,
    netPayableP: input.outputVatP - setOffP,
    carryForwardP: input.creditsP - setOffP,
    lines: compact([dr("VAT_OUTPUT", setOffP), cr("VAT_CURRENT", setOffP)]),
  }
}

/** R27b: treasury deposit of net VAT, VDS or AIT for a month. */
export function linesForTaxDeposit(input: { kind: "vat" | "vds" | "ait"; amountP: Poisha; bankTag: AccountTag }): LineInput[] {
  const tag: AccountTag = input.kind === "vat" ? "VAT_OUTPUT" : input.kind === "vds" ? "VDS_PAYABLE" : "AIT_PAYABLE"
  return compact([dr(tag, input.amountP), cr(input.bankTag, input.amountP)])
}
