import type { AccountTag, Id, InventoryTag, SalesInvoiceRow, VendorBillRow } from "@/core/db/schema"
import {
  linesForOpeningBalances,
  linesForShrinkage,
  linesForSummaryPurchase,
  linesForSummaryTransfer,
  type OpeningBalance,
} from "@/core/ledger/rules"
import { percentOf } from "@/core/tax/vat"

import { ITEM_BY_ID, TAG_OF_KIND } from "../content/catalogue"
import { GOODS_VENDORS, MAIN_VENDOR_OF_TAG, VENDOR_BY_ID } from "../content/parties"
import { LOC, USR, VND } from "../content/seed-refs"
import type { World } from "../engine/world"
import { addMonthsISO, firstOfMonth, isoAddDays } from "../time"
import type { CreditPlan } from "./credit-plan"
import { stdValueP } from "./jobs"
import { STUDIO_LOC } from "./sales-docs"
import type { StockOut } from "./stock"
import type { SummaryOut } from "./summary"

/**
 * Opening balances at F (seed_data.md §6, R1a), every subledger balance
 * backed by an opening document (credit customers' `opening` invoices,
 * goods vendors' `opening` bills); then the summary purchases (R2b, backed
 * by `summary` bills) and transfers (R2c) before the cutover, the last of
 * each balancing the inventory GL per tag and location to the stock value at
 * C, with shrinkage (R2d) where a balancing purchase would be negative.
 */

const T = (taka: number) => taka * 100

/** Opening inventory per tag and location (no item; stock records start at C). */
const OPENING_INVENTORY: Record<InventoryTag, Record<string, number>> = {
  INV_CHEMICAL: { [LOC.CST]: T(3_70_000), [LOC.GUL]: T(1_55_000), [LOC.UTT]: T(95_000) },
  INV_CONSUMABLE: { [LOC.CST]: T(1_30_000), [LOC.GUL]: T(50_000), [LOC.UTT]: T(35_000) },
  INV_RETAIL: { [LOC.CST]: T(85_000), [LOC.GUL]: T(35_000), [LOC.UTT]: T(25_000) },
}

/** Opening trade payables per goods vendor (৳4,65,000). */
const OPENING_AP: [Id, number][] = [
  [VND.dhakaAutochem, T(1_62_000)],
  [VND.glossGuard, T(1_18_000)],
  [VND.metroChem, T(56_000)],
  [VND.bengalDetail, T(62_000)],
  [VND.northline, T(54_000)],
  [VND.shaplaPack, T(13_000)],
]

export type OpeningOut = {
  journalId: Id
  invoices: Map<number, SalesInvoiceRow>
  bills: VendorBillRow[]
  /** Opening inventory GL by `${loc}|${tag}` */
  inventory: Map<string, number>
}

export function seedOpening(w: World, plan: CreditPlan): OpeningOut {
  const { bag } = w.ctx
  const F = w.cal.F
  const at = w.at(F, "00:01")
  const inventory = new Map<string, number>()
  const balances: OpeningBalance[] = [
    { account: "CASH_TILL_GUL", balanceP: T(85_000), locationId: LOC.GUL },
    { account: "CASH_TILL_UTT", balanceP: T(52_000), locationId: LOC.UTT },
    { account: "PETTY_HQ", balanceP: T(15_000), locationId: LOC.HQ },
    { account: "PETTY_GUL", balanceP: T(10_000), locationId: LOC.GUL },
    { account: "PETTY_UTT", balanceP: T(10_000), locationId: LOC.UTT },
    { account: "BANK_MAIN", balanceP: T(18_40_000) },
    { account: "BANK_COLLECTION", balanceP: T(6_25_000) },
    { account: "MFS_BKASH", balanceP: T(48_000) },
    { account: "MFS_NAGAD", balanceP: T(21_000) },
    { account: "CARD_CLEARING", balanceP: T(36_000) },
  ]
  for (const inv of plan.invoices) {
    if (inv.kind === "opening") balances.push({ account: "AR_CONTROL", balanceP: inv.totalP, partyId: inv.partyId, locationId: STUDIO_LOC[inv.studio], description: "Opening invoice" })
  }
  for (const tag of Object.keys(OPENING_INVENTORY) as InventoryTag[]) {
    for (const [loc, amount] of Object.entries(OPENING_INVENTORY[tag])) {
      const scaled = w.cal.small ? Math.round((amount * w.cal.volume) / T(1_000)) * T(1_000) : amount
      inventory.set(`${loc}|${tag}`, scaled)
      balances.push({ account: tag, balanceP: scaled, locationId: loc })
    }
  }
  const fixed: [AccountTag, number, Id?][] = [
    ["ADV_VENDOR", T(40_000), VND.protech],
    ["DEPOSIT_RENT", T(6_00_000)],
    ["PREPAID", T(1_20_000)],
    ["AIT_PAID", T(1_10_000)],
    ["EQUIPMENT", T(32_00_000)],
    ["ACC_DEP_EQUIPMENT", -T(9_60_000)],
    ["FURNITURE", T(6_50_000)],
    ["ACC_DEP_FURNITURE", -T(1_95_000)],
    ["VEHICLE", T(18_00_000)],
    ["ACC_DEP_VEHICLE", -T(5_40_000)],
    ["FITOUT", T(24_00_000)],
    ["ACC_DEP_FITOUT", -T(7_20_000)],
    ["SALARY_PAYABLE", -T(10_80_000)],
    ["VAT_OUTPUT", -T(1_85_000)],
    ["VDS_PAYABLE", -T(12_000)],
    ["AIT_PAYABLE", -T(21_000)],
    ["ACCRUED_EXP", -T(55_000)],
    ["TERM_LOAN", -T(20_00_000)],
    ["SHARE_CAPITAL", -T(50_00_000)],
  ]
  for (const [account, balanceP, partyId] of fixed) balances.push({ account, balanceP, partyId, locationId: account === "ADV_VENDOR" ? LOC.HQ : undefined })
  for (const [vendorId, amount] of OPENING_AP) balances.push({ account: "AP_CONTROL", balanceP: -amount, partyId: vendorId, locationId: LOC.HQ, description: "Opening bill" })

  const journal = w.ledger.post({
    rule: "R1a",
    date: F,
    at,
    lines: linesForOpeningBalances(balances),
    narration: "Opening balances",
    preparedBy: USR.farzana,
  })

  // Opening invoices (dated in June), each backing the party's opening receivable.
  const invoices = new Map<number, SalesInvoiceRow>()
  for (const p of plan.invoices) {
    if (p.kind !== "opening") continue
    const party = bag.get("parties", p.partyId)
    const loc = STUDIO_LOC[p.studio]
    const iat = w.at(p.date, "10:00")
    const inv = bag.put("salesInvoices", w.ctx.seq("inv"), iat, {
      invoiceNo: "",
      locationId: loc,
      partyId: p.partyId,
      orderIds: [],
      date: p.date,
      issuedAt: iat,
      dueDate: p.dueDate,
      kind: "opening",
      buyerNameEn: party.nameEn,
      buyerBin: party.bin,
      subtotalP: p.subtotalP,
      discountP: 0,
      vatP: p.vatP,
      totalP: p.totalP,
      advanceAppliedP: 0,
      paidP: 0,
      reservedP: 0,
      creditedP: 0,
      status: "posted",
      journalId: journal.id,
      printCount: 1,
      issuedBy: USR.mahbub,
    }, USR.mahbub)
    w.number("INV", { location: loc, date: p.date }, iat, (no) => {
      inv.invoiceNo = no
    })
    invoices.set(p.key, inv)
  }

  // Opening bills per goods vendor (dated in June), paid in the first month with 3% AIT.
  const rng = w.rng("opening")
  const bills: VendorBillRow[] = []
  for (const [vendorId, amount] of OPENING_AP) {
    const date = isoAddDays(F, -rng.int(5, 25))
    const bat = w.at(date, "12:00")
    const terms = VENDOR_BY_ID.get(vendorId)!.terms
    const bill = bag.put("vendorBills", w.ctx.seq("bl"), bat, {
      billNo: "",
      vendorRef: `INV/${date.slice(0, 4)}/${rng.int(1000, 9999)}`,
      partyId: vendorId,
      locationId: LOC.HQ,
      date,
      dueDate: isoAddDays(date, terms),
      kind: "opening",
      grnIds: [],
      hasMushak63: true,
      subtotalP: amount,
      inputVatP: 0,
      totalP: amount,
      paidP: 0,
      debitedP: 0,
      status: "posted",
      matchStatus: "n-a",
      matchDiffs: [],
      journalId: journal.id,
    }, USR.mahbub)
    w.number("BL", { date }, bat, (no) => {
      bill.billNo = no
    })
    bills.push(bill)
  }
  return { journalId: journal.id, invoices, bills, inventory }
}

export type SummaryStockOut = { bills: VendorBillRow[] }

/**
 * R2b and R2c each month before the cutover (dated the 1st, or F), then the
 * balancing: the studios' last transfer per tag brings their GL to the stock
 * value at C; the main vendor's last purchase per tag does the same for the
 * Central Store (shrinkage, R2d, when it would be negative).
 */
export function seedSummaryStock(w: World, summary: SummaryOut, stock: StockOut, opening: OpeningOut): SummaryStockOut {
  const { bag } = w.ctx
  const rng = w.rng("summary-stock")
  const { F, C } = w.cal
  const months: string[] = []
  for (let m = firstOfMonth(F); m < C; m = addMonthsISO(m, 1)) months.push(m)
  const dayOf = (m: string) => (m < F ? F : m)
  const tags: InventoryTag[] = ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"]
  const used = (loc: Id, tag: InventoryTag, m: string) => summary.used.get(`${loc}|${tag}|${m.slice(0, 7)}`) ?? 0
  const target = (loc: Id, tag: InventoryTag) => stock.openingValue.get(`${loc}|${tag}`) ?? 0

  // Transfers to each studio: the month's use, plus the move to the stock value at C spread over the months.
  const transfers = new Map<string, number>()
  for (const loc of [LOC.GUL, LOC.UTT]) {
    for (const tag of tags) {
      const u = months.map((m) => used(loc, tag, m))
      const totalUsed = u.reduce((s, x) => s + x, 0)
      const need = target(loc, tag) - (opening.inventory.get(`${loc}|${tag}`) ?? 0) + totalUsed
      if (need < 0) throw new Error(`seed: studio ${loc} ${tag} stock at the cutover below what transfers can reach`)
      const t = u.map((x) => (totalUsed > 0 ? Math.round((need * x) / totalUsed) : 0))
      t[t.length - 1] = need - t.slice(0, -1).reduce((s, x) => s + x, 0)
      for (let i = t.length - 1; i > 0 && t[i] < 0; i--) {
        t[i - 1] += t[i]
        t[i] = 0
      }
      months.forEach((m, i) => transfers.set(`${loc}|${tag}|${m}`, t[i]))
    }
  }

  // Purchases per goods vendor: the network's use of its items, at standard cost.
  const purchases = new Map<string, number>()
  for (const v of GOODS_VENDORS) {
    for (const m of months) {
      let net = 0
      for (const itemId of v.items!) net += stdValueP(itemId, summary.networkQty.get(`${m.slice(0, 7)}|${itemId}`) ?? 0)
      purchases.set(`${v.id}|${m}`, net)
    }
  }
  // Balance the Central Store per tag on the main vendor's last purchase.
  const shrink = new Map<InventoryTag, number>()
  for (const tag of tags) {
    let gl = opening.inventory.get(`${LOC.CST}|${tag}`) ?? 0
    for (const v of GOODS_VENDORS) {
      if (TAG_OF_KIND[ITEM_BY_ID.get(v.items![0])!.kind] !== tag) continue
      for (const m of months) gl += purchases.get(`${v.id}|${m}`) ?? 0
    }
    for (const loc of [LOC.GUL, LOC.UTT]) for (const m of months) gl -= transfers.get(`${loc}|${tag}|${m}`) ?? 0
    const main = MAIN_VENDOR_OF_TAG[tag]
    const last = `${main}|${months[months.length - 1]}`
    const adjusted = (purchases.get(last) ?? 0) + target(LOC.CST, tag) - gl
    if (adjusted >= 0) purchases.set(last, adjusted)
    else {
      purchases.set(last, 0)
      shrink.set(tag, -adjusted)
    }
  }

  const bills: VendorBillRow[] = []
  for (const m of months) {
    const day = dayOf(m)
    for (const v of GOODS_VENDORS) {
      const net = purchases.get(`${v.id}|${m}`) ?? 0
      if (net <= 0) continue
      const tag = TAG_OF_KIND[ITEM_BY_ID.get(v.items![0])!.kind]
      const vat = percentOf(net, 15)
      const bat = w.at(day, "08:00")
      const bill = bag.put("vendorBills", w.ctx.seq("bl"), bat, {
        billNo: "",
        vendorRef: `SUM/${m.slice(0, 7)}/${rng.int(100, 999)}`,
        partyId: v.id,
        locationId: LOC.CST,
        date: day,
        dueDate: isoAddDays(day, v.terms),
        kind: "summary",
        grnIds: [],
        hasMushak63: true,
        subtotalP: net,
        inputVatP: vat,
        totalP: net + vat,
        paidP: 0,
        debitedP: 0,
        status: "posted",
        matchStatus: "n-a",
        matchDiffs: [],
        journalId: "",
      }, USR.mahbub)
      w.number("BL", { date: day }, bat, (no) => {
        bill.billNo = no
      })
      const journal = w.ledger.post({
        rule: "R2b",
        date: day,
        at: bat,
        lines: linesForSummaryPurchase({ partyId: v.id, locationId: LOC.CST, tag, netP: net, vatP: vat }),
        narration: () => `Summary purchase (history), ${v.nameEn}, bill ${bill.billNo}`,
        source: { app: "ap", docType: "vendorBills", docId: bill.id, docNo: () => bill.billNo },
        preparedBy: USR.mahbub,
      })
      bill.journalId = journal.id
      bills.push(bill)
    }
    for (const loc of [LOC.GUL, LOC.UTT]) {
      for (const tag of tags) {
        const value = transfers.get(`${loc}|${tag}|${m}`) ?? 0
        if (value <= 0) continue
        w.ledger.post({
          rule: "R2c",
          date: day,
          at: w.at(day, "08:30"),
          lines: linesForSummaryTransfer({ tag, fromLocationId: LOC.CST, toLocationId: loc, valueP: value }),
          narration: `Summary transfer (history), Central Store to ${loc === LOC.GUL ? "Gulshan Studio" : "Uttara Studio"}`,
          preparedBy: USR.habib,
        })
      }
    }
  }
  for (const [tag, value] of shrink) {
    if (value <= 0) continue
    const day = isoAddDays(C, -1)
    w.ledger.post({
      rule: "R2d",
      date: day,
      at: w.at(day, "20:00"),
      lines: linesForShrinkage({ tag, locationId: LOC.CST, valueP: value }),
      narration: "Stock shrinkage before cutover",
      preparedBy: USR.habib,
    })
  }
  return { bills }
}
