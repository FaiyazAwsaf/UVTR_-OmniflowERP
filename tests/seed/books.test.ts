import { describe, expect, it } from "vitest"

import { fiscalYearBounds } from "@/config/brand.config"
import { invoiceOpen } from "@/core/ar/receipt"
import type { AccountTag, InventoryTag } from "@/core/db/schema"
import { INVENTORY_TAGS, PARTY_TAGS } from "@/core/ledger/chart"
import { balanceSheet, cashFlow, profitAndLoss, trialBalance } from "@/core/ledger/statements"
import { addMonthsISO, isoAddDays, lastOfMonth } from "@/core/seed/time"
import { historyStart } from "@/core/seed/generators/org"

import { acc, accountsInfo, built, gl as glRaw, rows } from "./helpers"

const gl = (...args: Parameters<typeof glRaw>) => glRaw(...args) + 0

/**
 * The books tie after seeding (seed_data.md §11, plan §14): journals
 * balance and come from posting rules; trial balance, balance sheet and cash
 * flow; every subledger equals its control account; no cash, bank or wallet
 * balance below zero on any day; stock never below zero.
 */

for (const scale of ["full", "small"] as const) {
  describe(`seeded books tie (${scale})`, () => {
    const { bag, today } = built(scale)
    const journals = rows(bag, "journals")
    const lines = rows(bag, "journalLines")
    const accounts = accountsInfo()
    const F = historyStart(today)
    const fyStart = fiscalYearBounds(today).startsOn
    const lastMonthStart = addMonthsISO(today, -1)

    it("every journal balances, comes from a posting rule and is numbered", () => {
      const byJournal = new Map<string, { d: number; c: number; n: number }>()
      for (const l of lines) {
        expect(l.debitP >= 0 && l.creditP >= 0 && !(l.debitP > 0 && l.creditP > 0)).toBe(true)
        expect(Number.isInteger(l.debitP) && Number.isInteger(l.creditP)).toBe(true)
        const s = byJournal.get(l.journalId) ?? { d: 0, c: 0, n: 0 }
        s.d += l.debitP
        s.c += l.creditP
        s.n += 1
        byJournal.set(l.journalId, s)
      }
      const nos = new Set<string>()
      for (const j of journals) {
        const s = byJournal.get(j.id)
        expect(s, j.id).toBeDefined()
        expect(s!.d).toBe(s!.c)
        expect(s!.d).toBe(j.totalP)
        expect(j.totalP).toBeGreaterThan(0)
        expect(j.rule).toMatch(/^R(1a|1b|2|2b|2c|2d|\d+|27a|27b)$/)
        expect(j.status).toBe("posted")
        expect(j.journalNo).toMatch(/^(OB|SM|SV|RV|PV|PJ|IV|CV|JV|YC)-\d{4}-\d{6}$/)
        expect(j.journalNo.slice(0, 2)).toBe(j.voucherType)
        nos.add(j.journalNo)
        if (j.source) expect(j.source.docNo, `${j.journalNo} source`).not.toBe("")
      }
      expect(nos.size).toBe(journals.length)
    })

    it("lines carry the dimensions the invariants require (INV-03, INV-04)", () => {
      const tagOf = new Map(accounts.map((a) => [a.id, a.tag]))
      const control = new Set(accounts.filter((a) => a.isControl).map((a) => a.id))
      const jById = new Map(journals.map((j) => [j.id, j]))
      for (const l of lines) {
        const tag = tagOf.get(l.accountId)
        const j = jById.get(l.journalId)!
        expect(l.date).toBe(j.date)
        expect(l.periodId).toBe(j.periodId)
        if (tag && PARTY_TAGS.includes(tag)) expect(l.partyId, `${j.journalNo} ${tag}`).toBeTruthy()
        if (tag && INVENTORY_TAGS.includes(tag)) {
          expect(l.locationId).toBeTruthy()
          if (!["OB", "SM", "YC"].includes(l.voucherType)) expect(l.itemId, `${j.journalNo} ${tag}`).toBeTruthy()
        }
        if (j.rule === "R24") expect(control.has(l.accountId)).toBe(false)
      }
    })

    it("the trial balance ties and the balance sheet balances", () => {
      const tb = trialBalance(accounts, lines, { from: F, to: today })
      expect(tb.totalDebitP).toBe(tb.totalCreditP)
      expect(tb.balanced).toBe(true)
      const bs = balanceSheet(accounts, lines, { asOf: today, fiscalYearStart: fyStart })
      expect(bs.totalAssetsP).toBe(bs.totalLiabilitiesP + bs.totalEquityP)
      expect(bs.balanced).toBe(true)
    })

    it("the cash flow check holds for the fiscal year to date", () => {
      const cf = cashFlow(accounts, lines, { from: fyStart > F ? fyStart : F, to: today })
      expect(cf.otherP).toBe(0)
      expect(cf.balanced).toBe(true)
    })

    it("AR aging equals AR_CONTROL, per party too", () => {
      const invoices = rows(bag, "salesInvoices")
      const byParty = new Map<string, number>()
      for (const inv of invoices) {
        expect(inv.advanceAppliedP + inv.paidP + inv.creditedP + inv.reservedP).toBeLessThanOrEqual(inv.totalP)
        byParty.set(inv.partyId, (byParty.get(inv.partyId) ?? 0) + invoiceOpen(inv))
      }
      const total = [...byParty.values()].reduce((s, v) => s + v, 0)
      expect(total).toBe(gl(lines, "AR_CONTROL"))
      for (const [partyId, open] of byParty) expect(gl(lines, "AR_CONTROL", { partyId }), partyId).toBe(open)
    })

    it("AP aging equals AP_CONTROL, per vendor too", () => {
      const byParty = new Map<string, number>()
      for (const b of rows(bag, "vendorBills")) {
        if (b.status === "on-hold") continue
        expect(b.paidP + b.debitedP).toBeLessThanOrEqual(b.totalP)
        byParty.set(b.partyId, (byParty.get(b.partyId) ?? 0) + b.totalP - b.paidP - b.debitedP)
      }
      const total = [...byParty.values()].reduce((s, v) => s + v, 0)
      expect(total).toBe(neg(lines, "AP_CONTROL"))
      for (const [partyId, open] of byParty) expect(neg(lines, "AP_CONTROL", { partyId }), partyId).toBe(open)
    })

    it("customer advances by party equal CUSTOMER_ADVANCE", () => {
      const adv = new Map<string, number>()
      for (const r of rows(bag, "receipts")) if (r.status === "posted") adv.set(r.partyId, (adv.get(r.partyId) ?? 0) + r.advanceP)
      for (const inv of rows(bag, "salesInvoices")) adv.set(inv.partyId, (adv.get(inv.partyId) ?? 0) - inv.advanceAppliedP)
      for (const rf of rows(bag, "customerRefunds")) adv.set(rf.partyId, (adv.get(rf.partyId) ?? 0) - rf.amountP)
      let total = 0
      for (const [partyId, v] of adv) {
        expect(neg(lines, "CUSTOMER_ADVANCE", { partyId }), partyId).toBe(v)
        total += v
      }
      expect(total).toBe(neg(lines, "CUSTOMER_ADVANCE"))
    })

    it("accepted, not billed GRN lines equal GRNI", () => {
      const grns = new Map(rows(bag, "grns").map((g) => [g.id, g]))
      const byParty = new Map<string, number>()
      for (const l of rows(bag, "grnLines")) {
        const open = Math.round((l.qtyAccepted - l.qtyBilled) * l.unitCostP)
        const vendor = grns.get(l.grnId)!.vendorId
        byParty.set(vendor, (byParty.get(vendor) ?? 0) + open)
      }
      const total = [...byParty.values()].reduce((s, v) => s + v, 0)
      expect(total).toBe(neg(lines, "GRNI"))
      expect(total).toBeGreaterThan(0)
      for (const [partyId, v] of byParty) expect(neg(lines, "GRNI", { partyId })).toBe(v)
    })

    it("inventory GL per tag and location equals the stock value, and in transit equals dispatched transfers", () => {
      const items = new Map(rows(bag, "items").map((i) => [i.id, i]))
      const cats = new Map(rows(bag, "itemCategories").map((c) => [c.id, c.inventoryTag]))
      const value = new Map<string, number>()
      for (const v of rows(bag, "stockValues")) {
        const tag = cats.get(items.get(v.itemId)!.categoryId)!
        value.set(`${v.locationId}|${tag}`, (value.get(`${v.locationId}|${tag}`) ?? 0) + v.valueP)
      }
      for (const loc of ["loc_cst", "loc_gul", "loc_utt", "loc_hq"]) {
        for (const tag of ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"] as InventoryTag[]) {
          expect(gl(lines, tag, { locationId: loc }), `${loc} ${tag}`).toBe(value.get(`${loc}|${tag}`) ?? 0)
        }
      }
      const dispatched = new Set(rows(bag, "transfers").filter((t) => t.status === "dispatched").map((t) => t.id))
      const transit = rows(bag, "transferLines").filter((l) => dispatched.has(l.transferId)).reduce((s, l) => s + l.valueP, 0)
      expect(gl(lines, "INV_TRANSIT")).toBe(transit)
    })

    it("at the cutover the inventory GL per tag and location equals the opening stock value", () => {
      const C = isoAddDays(today, scale === "small" ? -7 : -30)
      const items = new Map(rows(bag, "items").map((i) => [i.id, i]))
      const cats = new Map(rows(bag, "itemCategories").map((c) => [c.id, c.inventoryTag]))
      const opening = new Map<string, number>()
      for (const m of rows(bag, "stockMoves")) {
        if (m.type !== "opening") continue
        const tag = cats.get(items.get(m.itemId)!.categoryId)!
        opening.set(`${m.locationId}|${tag}`, (opening.get(`${m.locationId}|${tag}`) ?? 0) + m.valueP)
      }
      for (const loc of ["loc_cst", "loc_gul", "loc_utt"]) {
        for (const tag of ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"] as InventoryTag[]) {
          expect(gl(lines, tag, { locationId: loc, before: C }), `${loc} ${tag}`).toBe(opening.get(`${loc}|${tag}`) ?? 0)
        }
      }
    })

    it("VAT and withholding payables equal the months not yet returned", () => {
      const returns = rows(bag, "vatReturns").sort((a, b) => (a.month < b.month ? -1 : 1))
      const last = returns[returns.length - 1]
      expect(last.month < lastMonthStart.slice(0, 7)).toBe(true)
      const jById = new Map(journals.map((j) => [j.id, j]))
      const open = (tag: AccountTag, ruleSet: string[] | null, exclude: string[]) => {
        let s = 0
        for (const l of lines) {
          if (l.accountId !== acc(tag) || l.date < lastMonthStart) continue
          const rule = jById.get(l.journalId)!.rule
          if (exclude.includes(rule) || (ruleSet && !ruleSet.includes(rule))) continue
          s += l.debitP - l.creditP
        }
        return s
      }
      expect(gl(lines, "VAT_OUTPUT")).toBe(open("VAT_OUTPUT", null, ["R27a", "R27b"]))
      expect(gl(lines, "VAT_CURRENT")).toBe(last.carryForwardP + open("VAT_CURRENT", null, ["R27a"]))
      expect(gl(lines, "VDS_PAYABLE")).toBe(open("VDS_PAYABLE", ["R15"], []))
      expect(gl(lines, "AIT_PAYABLE")).toBe(open("AIT_PAYABLE", ["R15"], []))
      // Every month before last month has its return and deposits.
      for (let m = addMonthsISO(F, 0); m < lastMonthStart; m = addMonthsISO(m, 1)) {
        expect(returns.some((r) => r.month === m.slice(0, 7)), m).toBe(true)
      }
    })

    it("no cash, bank or wallet balance is below zero at the end of any day", () => {
      const cashTags: AccountTag[] = ["CASH_TILL_GUL", "CASH_TILL_UTT", "PETTY_HQ", "PETTY_GUL", "PETTY_UTT", "BANK_MAIN", "BANK_COLLECTION", "MFS_BKASH", "MFS_NAGAD", "CARD_CLEARING"]
      for (const tag of cashTags) {
        const id = acc(tag)
        const byDay = new Map<string, number>()
        for (const l of lines) if (l.accountId === id) byDay.set(l.date, (byDay.get(l.date) ?? 0) + l.debitP - l.creditP)
        let bal = 0
        for (let d = F; d <= today; d = isoAddDays(d, 1)) {
          bal += byDay.get(d) ?? 0
          expect(bal, `${tag} on ${d}`).toBeGreaterThanOrEqual(0)
        }
      }
      // The tills hold their float plus this morning's cash.
      expect(gl(lines, "CASH_TILL_GUL")).toBeGreaterThanOrEqual(20_000_00)
      expect(gl(lines, "CASH_TILL_UTT")).toBeGreaterThanOrEqual(15_000_00)
    })

    it("stock never below zero; moves add up to the values; nothing issued from quarantine or past expiry", () => {
      for (const b of rows(bag, "stockBalances")) {
        expect(b.qtyBase).toBeGreaterThanOrEqual(-1e-9)
        expect(b.quarantinedQty).toBeGreaterThanOrEqual(-1e-9)
      }
      const sums = new Map<string, { q: number; v: number }>()
      const batches = new Map(rows(bag, "batches").map((b) => [b.id, b]))
      for (const m of rows(bag, "stockMoves")) {
        if (m.type === "quarantine" || m.type === "quarantine-return") {
          expect(m.valueP).toBe(0)
          continue
        }
        const k = `${m.itemId}|${m.locationId}`
        const s = sums.get(k) ?? { q: 0, v: 0 }
        s.q += m.qtyBase
        s.v += m.valueP
        sums.set(k, s)
        if (m.qtyBase < 0 && m.batchId) {
          const batch = batches.get(m.batchId)!
          expect(batch.status, m.id).toBe("ok")
          if (batch.expiry) expect(batch.expiry >= m.date, m.id).toBe(true)
        }
      }
      for (const v of rows(bag, "stockValues")) {
        expect(v.qtyBase).toBeGreaterThanOrEqual(-1e-9)
        expect(v.valueP).toBeGreaterThanOrEqual(0)
        if (Math.abs(v.qtyBase) < 1e-9) expect(v.valueP).toBe(0)
        const s = sums.get(`${v.itemId}|${v.locationId}`)!
        expect(Math.abs(s.q - v.qtyBase)).toBeLessThan(1e-6)
        expect(s.v).toBe(v.valueP)
      }
    })

    if (scale === "full") {
      it("P&L by month is positive and plausible (service gross margin 75% to 90%)", () => {
        for (let m = F; m < addMonthsISO(today, 0) && m < firstOfCurrent(today); m = addMonthsISO(m, 1)) {
          const pl = profitAndLoss(accounts, lines, { from: m, to: lastOfMonth(m) })
          expect(pl.profitBeforeTaxP, m).toBeGreaterThan(0)
          const consumables = pl.sections.costOfSales.find((s) => s.account.tag === "CONSUMABLES_USED")?.amountP ?? 0
          const services = pl.totals.serviceRevenue - pl.totals.discounts
          const margin = (services - consumables) / services
          expect(margin, `${m} margin ${margin}`).toBeGreaterThanOrEqual(0.75)
          expect(margin, `${m} margin ${margin}`).toBeLessThanOrEqual(0.9)
        }
      })
    }
  })
}

/** The negated GL balance (credit balances as positive), without producing -0. */
function neg(...args: Parameters<typeof glRaw>): number {
  const x = glRaw(...args)
  return x === 0 ? 0 : -x
}

function firstOfCurrent(today: string): string {
  return `${today.slice(0, 7)}-01`
}
