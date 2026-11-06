import type { AccountRow, AccountTag, ISODate, Id, JournalLineRow, Poisha } from "@/core/db/schema"

/**
 * Statement builders (accounting_rules.md §6), pure functions over posted
 * ledger lines and the chart. FRS screens, the dashboard, IRT and the
 * "books tie" tests all use them. Balances are signed: debit positive.
 */

export type LedgerLine = Pick<
  JournalLineRow,
  "accountId" | "debitP" | "creditP" | "date" | "locationId" | "partyId" | "journalId" | "voucherType" | "itemId"
>
export type AccountInfo = Pick<
  AccountRow,
  "id" | "code" | "nameEn" | "nameBn" | "type" | "parentId" | "isGroup" | "normalSide" | "tag" | "isControl"
>

const net = (l: LedgerLine) => l.debitP - l.creditP

/** Signed balance (debit positive) of lines matching a filter. */
export function balanceOf(lines: LedgerLine[], filter: (l: LedgerLine) => boolean = () => true): Poisha {
  let sum = 0
  for (const l of lines) if (filter(l)) sum += net(l)
  return sum
}

/** Balance per account id (debit positive), optionally up to a day. */
export function balancesByAccount(lines: LedgerLine[], asOf?: ISODate): Map<Id, Poisha> {
  const out = new Map<Id, Poisha>()
  for (const l of lines) {
    if (asOf && l.date > asOf) continue
    out.set(l.accountId, (out.get(l.accountId) ?? 0) + net(l))
  }
  return out
}

/* ---------------- Trial balance ---------------- */

export type TrialBalanceRow = {
  account: AccountInfo
  openingP: Poisha
  debitP: Poisha
  creditP: Poisha
  closingP: Poisha
}

/** Every postable account with opening balance, period debits and credits, closing balance. */
export function trialBalance(
  accounts: AccountInfo[],
  lines: LedgerLine[],
  range: { from: ISODate; to: ISODate }
): { rows: TrialBalanceRow[]; totalDebitP: Poisha; totalCreditP: Poisha; closingNetP: Poisha; balanced: boolean } {
  const byId = new Map<Id, TrialBalanceRow>()
  for (const a of accounts) {
    if (a.isGroup) continue
    byId.set(a.id, { account: a, openingP: 0, debitP: 0, creditP: 0, closingP: 0 })
  }
  for (const l of lines) {
    if (l.date > range.to) continue
    const row = byId.get(l.accountId)
    if (!row) continue
    if (l.date < range.from) row.openingP += net(l)
    else {
      row.debitP += l.debitP
      row.creditP += l.creditP
    }
  }
  let totalDebitP = 0
  let totalCreditP = 0
  let closingNetP = 0
  const rows = [...byId.values()].sort((a, b) => a.account.code.localeCompare(b.account.code))
  for (const r of rows) {
    r.closingP = r.openingP + r.debitP - r.creditP
    totalDebitP += r.debitP
    totalCreditP += r.creditP
    closingNetP += r.closingP
  }
  return { rows, totalDebitP, totalCreditP, closingNetP, balanced: totalDebitP === totalCreditP && closingNetP === 0 }
}

/** Running balance down a sorted ledger (account ledger screen). */
export function ledgerWithRunningBalance<T extends LedgerLine>(
  openingP: Poisha,
  lines: T[]
): (T & { runningP: Poisha })[] {
  let running = openingP
  return lines.map((l) => {
    running += net(l)
    return { ...l, runningP: running }
  })
}

/* ---------------- Profit and loss ---------------- */

export type PlSectionKey =
  | "serviceRevenue"
  | "productSales"
  | "discounts"
  | "costOfSales"
  | "operatingExpenses"
  | "otherIncome"
  | "financeCosts"

/** Which P&L section an account code falls in (accounting_rules.md §6). */
export function plSectionOf(code: string): PlSectionKey | null {
  const n = Number(code)
  if (n >= 4110 && n <= 4160) return "serviceRevenue"
  if (n === 4200) return "productSales"
  if (n === 4300) return "discounts"
  if (n >= 4910 && n <= 4999) return "otherIncome"
  if (n >= 5100 && n <= 5999) return "costOfSales"
  if (n >= 6100 && n <= 6999) return "operatingExpenses"
  if (n >= 7100 && n <= 7999) return "financeCosts"
  return null
}

export type ProfitAndLoss = {
  /** Per section: accounts with their amount (income positive as earned, costs positive as spent) */
  sections: Record<PlSectionKey, { account: AccountInfo; amountP: Poisha }[]>
  totals: Record<PlSectionKey, Poisha>
  netRevenueP: Poisha
  grossProfitP: Poisha
  operatingProfitP: Poisha
  profitBeforeTaxP: Poisha
}

/**
 * P&L for a period, optionally for one location (HQ costs carry HQ). The YC
 * voucher is excluded (it only moves a closed year's result).
 */
export function profitAndLoss(
  accounts: AccountInfo[],
  lines: LedgerLine[],
  range: { from: ISODate; to: ISODate; locationId?: Id | null }
): ProfitAndLoss {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const amounts = new Map<Id, Poisha>()
  for (const l of lines) {
    if (l.voucherType === "YC" || l.date < range.from || l.date > range.to) continue
    if (range.locationId && l.locationId !== range.locationId) continue
    const account = byId.get(l.accountId)
    if (!account || !plSectionOf(account.code)) continue
    amounts.set(l.accountId, (amounts.get(l.accountId) ?? 0) + net(l))
  }
  const sections: ProfitAndLoss["sections"] = {
    serviceRevenue: [],
    productSales: [],
    discounts: [],
    costOfSales: [],
    operatingExpenses: [],
    otherIncome: [],
    financeCosts: [],
  }
  const totals = Object.fromEntries(Object.keys(sections).map((k) => [k, 0])) as Record<PlSectionKey, Poisha>
  for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const section = plSectionOf(account.code)
    if (!section || account.isGroup) continue
    const signedDebit = amounts.get(account.id) ?? 0
    // Income shown as earned (credit positive); discounts and costs as spent (debit positive).
    const incomeLike = section === "serviceRevenue" || section === "productSales" || section === "otherIncome"
    const amountP = incomeLike ? -signedDebit : signedDebit
    sections[section].push({ account, amountP })
    totals[section] += amountP
  }
  const netRevenueP = totals.serviceRevenue + totals.productSales - totals.discounts
  const grossProfitP = netRevenueP - totals.costOfSales
  const operatingProfitP = grossProfitP - totals.operatingExpenses
  const profitBeforeTaxP = operatingProfitP + totals.otherIncome - totals.financeCosts
  return { sections, totals, netRevenueP, grossProfitP, operatingProfitP, profitBeforeTaxP }
}

/* ---------------- Balance sheet ---------------- */

export type BalanceSheet = {
  nonCurrentAssets: { account: AccountInfo; amountP: Poisha }[]
  currentAssets: { account: AccountInfo; amountP: Poisha }[]
  currentLiabilities: { account: AccountInfo; amountP: Poisha }[]
  nonCurrentLiabilities: { account: AccountInfo; amountP: Poisha }[]
  equity: { account: AccountInfo; amountP: Poisha }[]
  /** Result of an earlier fiscal year not yet closed (no YC voucher yet) */
  unclosedEarlierResultP: Poisha
  /** Current year result: P&L from the fiscal year start, computed, not posted */
  currentYearResultP: Poisha
  totalAssetsP: Poisha
  totalLiabilitiesP: Poisha
  totalEquityP: Poisha
  balanced: boolean
}

/** Balance sheet at a date (accounting_rules.md §6). */
export function balanceSheet(
  accounts: AccountInfo[],
  lines: LedgerLine[],
  opts: { asOf: ISODate; fiscalYearStart: ISODate }
): BalanceSheet {
  const balances = balancesByAccount(lines, opts.asOf)
  const out: BalanceSheet = {
    nonCurrentAssets: [],
    currentAssets: [],
    currentLiabilities: [],
    nonCurrentLiabilities: [],
    equity: [],
    unclosedEarlierResultP: 0,
    currentYearResultP: 0,
    totalAssetsP: 0,
    totalLiabilitiesP: 0,
    totalEquityP: 0,
    balanced: false,
  }
  // Income and expense balances: before the year start = an unclosed earlier year; after = this year.
  let earlier = 0
  let current = 0
  const plAccounts = new Set(accounts.filter((a) => a.type === "income" || a.type === "expense").map((a) => a.id))
  for (const l of lines) {
    if (l.date > opts.asOf || !plAccounts.has(l.accountId)) continue
    if (l.date < opts.fiscalYearStart) earlier += net(l)
    else if (l.voucherType !== "YC") current += net(l)
    else earlier += net(l)
  }
  out.unclosedEarlierResultP = -earlier
  out.currentYearResultP = -current

  for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    if (account.isGroup) continue
    const bal = balances.get(account.id) ?? 0
    const n = Number(account.code)
    if (account.type === "asset") {
      const row = { account, amountP: bal }
      if (n >= 1200) out.nonCurrentAssets.push(row)
      else out.currentAssets.push(row)
      out.totalAssetsP += bal
    } else if (account.type === "liability") {
      const row = { account, amountP: -bal }
      if (n >= 2200) out.nonCurrentLiabilities.push(row)
      else out.currentLiabilities.push(row)
      out.totalLiabilitiesP += -bal
    } else if (account.type === "equity") {
      out.equity.push({ account, amountP: -bal })
      out.totalEquityP += -bal
    }
  }
  out.totalEquityP += out.unclosedEarlierResultP + out.currentYearResultP
  out.balanced = out.totalAssetsP === out.totalLiabilitiesP + out.totalEquityP
  return out
}

/* ---------------- Cash flow (indirect) ---------------- */

const CASH_TAGS: AccountTag[] = [
  "CASH_TILL_GUL",
  "CASH_TILL_UTT",
  "PETTY_HQ",
  "PETTY_GUL",
  "PETTY_UTT",
  "BANK_MAIN",
  "BANK_COLLECTION",
  "MFS_BKASH",
  "MFS_NAGAD",
  "CARD_CLEARING",
]
const WORKING_ASSET_TAGS: AccountTag[] = [
  "AR_CONTROL",
  "INV_CHEMICAL",
  "INV_CONSUMABLE",
  "INV_RETAIL",
  "INV_TRANSIT",
  "ADV_VENDOR",
  "DEPOSIT_RENT",
  "PREPAID",
  "VAT_CURRENT",
  "AIT_PAID",
]
const WORKING_LIABILITY_TAGS: AccountTag[] = [
  "AP_CONTROL",
  "GRNI",
  "CUSTOMER_ADVANCE",
  "VAT_OUTPUT",
  "VDS_PAYABLE",
  "AIT_PAYABLE",
  "SALARY_PAYABLE",
  "ACCRUED_EXP",
]
const FIXED_TAGS: AccountTag[] = ["EQUIPMENT", "FURNITURE", "VEHICLE", "FITOUT"]
const DEP_TAGS: AccountTag[] = ["ACC_DEP_EQUIPMENT", "ACC_DEP_FURNITURE", "ACC_DEP_VEHICLE", "ACC_DEP_FITOUT"]
const FINANCING_TAGS: AccountTag[] = ["TERM_LOAN", "SHARE_CAPITAL"]

export type CashFlow = {
  profitBeforeTaxP: Poisha
  depreciationP: Poisha
  workingCapital: { tag: AccountTag; amountP: Poisha }[]
  operatingP: Poisha
  investing: { tag: AccountTag; amountP: Poisha }[]
  investingP: Poisha
  financing: { tag: AccountTag; amountP: Poisha }[]
  financingP: Poisha
  /** Movements on accounts outside every category (should be zero) */
  otherP: Poisha
  netChangeP: Poisha
  /** The actual change in cash, bank, MFS and card clearing */
  cashChangeP: Poisha
  balanced: boolean
}

/**
 * Indirect cash flow for a period. Opening (OB) and year-end closing (YC)
 * vouchers are not flows and are left out; the total is checked against the
 * change in cash, bank, MFS and card clearing.
 */
export function cashFlow(accounts: AccountInfo[], lines: LedgerLine[], range: { from: ISODate; to: ISODate }): CashFlow {
  const tagOf = new Map(accounts.map((a) => [a.id, a.tag]))
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]))
  const delta = new Map<AccountTag, Poisha>()
  let pl = 0
  let other = 0
  for (const l of lines) {
    if (l.date < range.from || l.date > range.to) continue
    if (l.voucherType === "OB" || l.voucherType === "YC") continue
    const type = typeOf.get(l.accountId)
    const tag = tagOf.get(l.accountId)
    if (type === "income" || type === "expense") {
      pl += net(l)
      continue
    }
    if (!tag) {
      other += net(l)
      continue
    }
    delta.set(tag, (delta.get(tag) ?? 0) + net(l))
  }
  const d = (tag: AccountTag) => delta.get(tag) ?? 0
  const depreciationP = -DEP_TAGS.reduce((s, t) => s + d(t), 0)
  const workingCapital = [
    ...WORKING_ASSET_TAGS.map((tag) => ({ tag, amountP: -d(tag) })),
    ...WORKING_LIABILITY_TAGS.map((tag) => ({ tag, amountP: -d(tag) })),
  ]
  const investing = FIXED_TAGS.map((tag) => ({ tag, amountP: -d(tag) }))
  const financing = FINANCING_TAGS.map((tag) => ({ tag, amountP: -d(tag) }))
  const known = new Set<AccountTag>([...CASH_TAGS, ...WORKING_ASSET_TAGS, ...WORKING_LIABILITY_TAGS, ...FIXED_TAGS, ...DEP_TAGS, ...FINANCING_TAGS])
  for (const [tag, value] of delta) if (!known.has(tag)) other += value
  const profitBeforeTaxP = -pl
  const operatingP = profitBeforeTaxP + depreciationP + workingCapital.reduce((s, w) => s + w.amountP, 0)
  const investingP = investing.reduce((s, w) => s + w.amountP, 0)
  const financingP = financing.reduce((s, w) => s + w.amountP, 0)
  const netChangeP = operatingP + investingP + financingP - other
  const cashChangeP = CASH_TAGS.reduce((s, t) => s + d(t), 0)
  return {
    profitBeforeTaxP,
    depreciationP,
    workingCapital,
    operatingP,
    investing,
    investingP,
    financing,
    financingP,
    otherP: other,
    netChangeP,
    cashChangeP,
    balanced: netChangeP === cashChangeP,
  }
}
