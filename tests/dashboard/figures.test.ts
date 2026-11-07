import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { AccountTag } from "@/core/db/schema"
import { profitAndLoss } from "@/core/ledger/statements"
import { runReport } from "@/core/reports/runner"
import { ITM, LOC } from "@/core/seed/content/seed-refs"
import { arOpenItems, loadAging } from "@/modules/ar/queries"
import {
  boardStatus,
  compareRange,
  coveredMinutes,
  isLate,
  loadAlerts,
  loadCollections,
  loadFinance,
  loadPositions,
  loadRevenueTrend,
  loadStudioHome,
  loadStudioOps,
  loadTopServices,
  periodRange,
  reportDefinition,
} from "@/modules/dashboard/queries"
import { DASH_PERIODS } from "@/modules/dashboard/types"
import { checkout } from "@/modules/si/commands"

import { actors, gl, key, refused, run, seededDb, trialBalanceTies } from "./helpers"

/**
 * WS-Dash on the small seed: every dashboard figure equals the FRS
 * statement, the GL balance or the IRT report total for the same period and
 * location, and a real counter checkout (a walk-in retail sale at Gulshan)
 * moves revenue today, collections and cash by exactly the invoice amounts.
 */

// Under a full parallel run (and other agents) a loop over every period and location can take longer than 5 s.
vi.setConfig({ testTimeout: 60_000 })

let db: OmniflowDb
let as: ReturnType<typeof actors>
let today: string
const LOCATIONS = [null, LOC.GUL, LOC.UTT, LOC.HQ, LOC.CST] as const
const CASH_TAGS: AccountTag[] = ["CASH_TILL_GUL", "CASH_TILL_UTT", "PETTY_HQ", "PETTY_GUL", "PETTY_UTT", "BANK_MAIN", "BANK_COLLECTION", "MFS_BKASH", "MFS_NAGAD", "CARD_CLEARING"]

beforeAll(async () => {
  db = await seededDb("dash-figures")
  as = actors(db)
  today = dhakaDate(now())
}, 180_000)
afterAll(async () => {
  await db.delete()
})

describe("periods", () => {
  it("today, month to date and last month, with the comparison ranges", () => {
    expect(periodRange("today", "2026-11-07")).toEqual({ from: "2026-11-07", to: "2026-11-07" })
    expect(periodRange("mtd", "2026-11-07")).toEqual({ from: "2026-11-01", to: "2026-11-07" })
    expect(periodRange("last-month", "2026-11-07")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
    expect(periodRange("last-month", "2027-03-01")).toEqual({ from: "2027-02-01", to: "2027-02-28" })
    expect(compareRange("today", "2026-11-07")).toBeNull()
    expect(compareRange("mtd", "2026-11-07")).toEqual({ from: "2026-10-01", to: "2026-10-07" })
    expect(compareRange("mtd", "2027-03-31")).toEqual({ from: "2027-02-01", to: "2027-02-28" })
    expect(compareRange("last-month", "2026-11-07")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
  })

  it("bay minutes count an overlap in one bay once", () => {
    const m = 60_000
    expect(coveredMinutes([[0, 60 * m], [30 * m, 90 * m], [120 * m, 150 * m]])).toBe(120)
    expect(coveredMinutes([[0, 0]])).toBe(0)
  })
})

describe("revenue, margin and collections", () => {
  it("revenue today and for each period, and gross margin, equal the FRS P&L for every location", async () => {
    const accounts = await db.accounts.toArray()
    const lines = await db.journalLines.toArray()
    for (const period of DASH_PERIODS) {
      const range = periodRange(period, today)
      for (const locationId of LOCATIONS) {
        const f = await loadFinance(db, { today, period, locationId })
        const pl = profitAndLoss(accounts, lines, { ...range, locationId })
        const day = profitAndLoss(accounts, lines, { from: today, to: today, locationId })
        expect(f.revenuePeriodP, `${period} ${locationId}`).toBe(pl.netRevenueP)
        expect(f.grossProfitP).toBe(pl.grossProfitP)
        expect(f.costOfSalesP).toBe(pl.totals.costOfSales)
        expect(f.revenueTodayP).toBe(day.netRevenueP)
        if (pl.netRevenueP) expect(f.marginPct).toBeCloseTo((pl.grossProfitP / pl.netRevenueP) * 100, 6)
      }
    }
    const all = await loadFinance(db, { today, period: "mtd" })
    expect(all.revenuePeriodP).toBeGreaterThan(0)
    expect(all.grossProfitP).toBeGreaterThan(0)
    expect(all.grossProfitP).toBeLessThan(all.revenuePeriodP)
  })

  it("the P&L revenue equals the IRT-16 report plus the seed's summary vouchers (R2 history has no invoice lines; no credit notes in the seed)", async () => {
    const def = await reportDefinition(db, "IRT-16")
    const accounts = await db.accounts.toArray()
    const revenue = new Set(accounts.filter((a) => Number(a.code) >= 4110 && Number(a.code) <= 4300).map((a) => a.id))
    const summaryLines = (await db.journalLines.toArray()).filter((l) => l.voucherType === "SM" && revenue.has(l.accountId))
    for (const period of DASH_PERIODS) {
      const range = periodRange(period, today)
      for (const locationId of [null, LOC.GUL, LOC.UTT]) {
        const f = await loadFinance(db, { today, period, locationId })
        const irt = await runReport(db, def, { ...range, locationId: locationId ?? undefined })
        const summaryP = summaryLines
          .filter((l) => l.date >= range.from && l.date <= range.to && (!locationId || l.locationId === locationId))
          .reduce((s, l) => s + l.creditP - l.debitP, 0)
        expect(f.revenuePeriodP, `${period} ${locationId}`).toBe(irt.totals.netP + summaryP)
      }
    }
  })

  it("collections equal the IRT-07 receipts register for the period and location", async () => {
    const def = await reportDefinition(db, "IRT-07")
    for (const period of DASH_PERIODS) {
      const range = periodRange(period, today)
      for (const locationId of LOCATIONS) {
        const c = await loadCollections(db, { ...range, locationId })
        const irt = await runReport(db, def, { ...range, locationId: locationId ?? undefined })
        expect(c.totalP, `${period} ${locationId}`).toBe(irt.totals.amountP)
        expect(c.count).toBe(irt.rowCount)
      }
    }
    expect((await loadCollections(db, periodRange("mtd", today))).totalP).toBeGreaterThan(0)
  })
})

describe("positions", () => {
  it("receivables equal AR_CONTROL and the aging; payables tie to AP_CONTROL; cash and stock equal the GL", async () => {
    const p = await loadPositions(db, { today })
    const aging = await loadAging(db, today, "ar")
    expect(p.receivablesP).toBe(aging.totals.total)
    expect(p.receivablesP).toBe(await gl(db, "AR_CONTROL"))
    const open = await arOpenItems(db, today)
    expect(p.overdueP).toBe(open.filter((i) => i.dpd > 0).reduce((s, i) => s + i.openP, 0))
    expect(p.overdueP).toBeLessThanOrEqual(aging.totals.d0_30 + aging.totals.d31_60 + aging.totals.d61_90 + aging.totals.over90)
    expect(p.overdueP).toBeGreaterThan(0)
    expect(p.payablesOpenP).toBe(-(await gl(db, "AP_CONTROL")))
    expect(p.payablesDueP).toBeLessThanOrEqual(p.payablesOpenP)
    expect(p.payablesDueP).toBeGreaterThanOrEqual(p.payablesOverdueP)
    let cash = 0
    for (const tag of CASH_TAGS) cash += await gl(db, tag, { upTo: today })
    expect(p.cashTotalP).toBe(cash)
    let stock = 0
    for (const tag of ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"] as const) stock += await gl(db, tag, { upTo: today })
    expect(p.stockTotalP).toBe(stock)
    expect(p.inTransitP).toBe(await gl(db, "INV_TRANSIT", { upTo: today }))
  })

  it("per location: receivables by invoice location (IRT-06), cash by account location, stock by location (IRT-23 and stock values)", async () => {
    const all = await loadPositions(db, { today })
    const ar06 = await reportDefinition(db, "IRT-06")
    const ic23 = await reportDefinition(db, "IRT-23")
    let receivables = 0
    let cash = 0
    for (const locationId of [LOC.GUL, LOC.UTT, LOC.HQ, LOC.CST]) {
      const p = await loadPositions(db, { today, locationId })
      const irt06 = await runReport(db, ar06, { locationId })
      expect(p.receivablesP, locationId).toBe(irt06.totals.outstandingP)
      receivables += p.receivablesP
      cash += p.cashTotalP
      const values = await db.stockValues.where("locationId").equals(locationId).toArray()
      const stock = values.reduce((s, v) => s + v.valueP, 0)
      if (locationId !== LOC.HQ) {
        expect(p.stockTotalP, locationId).toBe(stock)
        expect(p.stockTotalP).toBe((await runReport(db, ic23, { locationId })).totals.valueP)
        let glStock = 0
        for (const tag of ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"] as const) glStock += await gl(db, tag, { upTo: today, locationId })
        expect(p.stockTotalP).toBe(glStock)
      }
      // Payables are company-wide whatever the filter.
      expect(p.payablesDueP).toBe(all.payablesDueP)
    }
    expect(receivables).toBe(all.receivablesP)
    expect(cash).toBe(all.cashTotalP)
    expect((await loadPositions(db, { today, locationId: LOC.GUL })).cash.map((c) => c.code).sort()).toEqual(["PETTY-GUL", "TILL-GUL"])
  })
})

describe("IRT figures", () => {
  it("revenue by studio over 30 days equals the IRT-16 report per studio", async () => {
    const def = await reportDefinition(db, "IRT-16")
    const trend = await loadRevenueTrend(db, { today })
    expect(trend.points).toHaveLength(30)
    expect(trend.to).toBe(today)
    const all = await runReport(db, def, { from: trend.from, to: trend.to })
    expect(trend.totalP).toBe(all.totals.netP)
    expect(trend.points.reduce((s, p) => s + p.total, 0)).toBe(all.totals.netP)
    for (const [code, id] of [["GUL", LOC.GUL], ["UTT", LOC.UTT]] as const) {
      const irt = await runReport(db, def, { from: trend.from, to: trend.to, locationId: id })
      expect(trend.byLocation[code], code).toBe(irt.totals.netP)
      expect(irt.totals.netP).toBeGreaterThan(0)
      const one = await loadRevenueTrend(db, { today, locationId: id })
      expect(one.totalP).toBe(irt.totals.netP)
      expect(one.series).toEqual([code])
    }
  })

  it("top services are the IRT-18 report's groups by revenue", async () => {
    const def = await reportDefinition(db, "IRT-18")
    for (const period of DASH_PERIODS) {
      const range = periodRange(period, today)
      for (const locationId of [null, LOC.GUL, LOC.UTT]) {
        const top = await loadTopServices(db, { ...range, locationId, limit: 5 })
        const irt = await runReport(db, def, { ...range, locationId: locationId ?? undefined })
        expect(top.totalP).toBe(irt.totals.netP)
        expect(top.totalQty).toBe(irt.totals.qty)
        const groups = [...(irt.groups ?? [])].sort((a, b) => (b.totals.netP ?? 0) - (a.totals.netP ?? 0))
        expect(top.top.map((s) => s.netP)).toEqual(groups.slice(0, 5).map((g) => g.totals.netP))
        if (top.top.length) expect(top.top[0].key).toBe(String(groups[0].key.service))
      }
    }
    const mtd = await loadTopServices(db, periodRange("mtd", today))
    expect(mtd.top.length).toBeGreaterThan(0)
  })
})

describe("studios today", () => {
  it("jobs by status equal the orders on today's board, and bay use stays within 09:00 to 21:00", async () => {
    const nowMs = now()
    for (const [id, bays] of [[LOC.GUL, 6], [LOC.UTT, 4]] as const) {
      const ops = await loadStudioOps(db, { locationId: id, today, nowMs })
      const orders = await db.salesOrders.where("locationId").equals(id).toArray()
      const count = (s: string) => orders.filter((o) => (s === "delivered" ? ["delivered", "invoiced", "closed"].includes(o.status) && !!o.deliveredAt && dhakaDate(o.deliveredAt) === today : o.status === s)).length
      for (const s of ["booked", "in-progress", "qc", "ready", "delivered"] as const) expect(ops.counts[s], `${id} ${s}`).toBe(count(s))
      expect(ops.late).toBe(orders.filter((o) => ["booked", "in-progress", "qc"].includes(o.status) && o.promisedAt < nowMs).length)
      expect(ops.bayCount).toBe(bays)
      expect(ops.bayMinutes).toBe(bays * 720)
      expect(ops.scheduledMinutes).toBeGreaterThan(0)
      expect(ops.scheduledMinutes).toBeLessThanOrEqual(ops.bayMinutes)
      expect(ops.utilisationPct).toBeCloseTo((ops.scheduledMinutes / ops.bayMinutes) * 100, 6)
      for (const b of ops.bays) expect(b.minutes).toBeLessThanOrEqual(720)
      const onBoard = ops.counts.booked + ops.counts["in-progress"] + ops.counts.qc + ops.counts.ready + ops.counts.delivered
      expect(onBoard).toBeGreaterThan(0)
    }
    // Seed §8 at 10:30: work in progress and in QC at both studios.
    const gul = await loadStudioOps(db, { locationId: LOC.GUL, today, nowMs })
    expect(gul.counts["in-progress"]).toBeGreaterThan(0)
    expect(gul.counts.qc).toBeGreaterThan(0)
  })

  it("the studio home lists today's board, bookings starting today by time, and late jobs", async () => {
    const nowMs = now()
    const home = await loadStudioHome(db, { locationId: LOC.GUL, today, nowMs })
    const ops = await loadStudioOps(db, { locationId: LOC.GUL, today, nowMs })
    expect(home.orders.length).toBe(Object.values(ops.counts).reduce((s, v) => s + v, 0))
    expect(home.late.every((o) => o.late)).toBe(true)
    const orders = await db.salesOrders.where("locationId").equals(LOC.GUL).toArray()
    expect(home.late.length).toBe(orders.filter((o) => boardStatus(o, today) && isLate(o, nowMs)).length)
    const start = atDhaka(today, "00:00")
    expect(home.bookings.length).toBe(orders.filter((o) => o.status !== "cancelled" && o.scheduledAt >= start && o.scheduledAt < start + 86_400_000).length)
    for (let i = 1; i < home.bookings.length; i++) expect(home.bookings[i].scheduledAt).toBeGreaterThanOrEqual(home.bookings[i - 1].scheduledAt)
    expect(home.bookings.some((b) => b.bayCode && b.technicians.length)).toBe(true)
    expect(home.revenueTodayP).toBe((await loadFinance(db, { today, period: "today", locationId: LOC.GUL })).revenueTodayP)
    const deposits = (await db.receipts.where("date").equals(today).toArray()).filter((r) => r.locationId === LOC.GUL && r.orderId && r.status === "posted")
    expect(home.depositsTodayP).toBe(deposits.reduce((s, r) => s + r.amountP, 0))
  })
})

describe("alerts", () => {
  it("count the reorder report rows, quarantine, approvals, bills on hold and cheques due", async () => {
    const alerts = await loadAlerts(db, { today })
    const by = Object.fromEntries(alerts.map((a) => [a.kind, a]))
    const reorder = await runReport(db, await reportDefinition(db, "IRT-25"), {})
    expect(by.reorder.count).toBe(reorder.rowCount)
    expect(by.reorder.count).toBeGreaterThan(0)
    expect(by.approvals.count).toBe(await db.approvals.where("status").equals("pending").count())
    expect(by.approvals.count).toBeGreaterThanOrEqual(4)
    expect(by["bills-on-hold"].count).toBe(await db.vendorBills.where("status").equals("on-hold").count())
    expect(by["bills-on-hold"].count).toBeGreaterThanOrEqual(1)
    expect(by["pdc-due"].count).toBeGreaterThanOrEqual(2)
    expect(by.quarantine.count).toBe(await db.grnLines.where("quarantineStatus").equals("held").count())
    expect(by.expiring.count).toBeGreaterThanOrEqual(2)
    const gul = Object.fromEntries((await loadAlerts(db, { today, locationId: LOC.GUL })).map((a) => [a.kind, a]))
    expect(gul.reorder.href).toBe(`/irt/run/IRT-25?loc=${LOC.GUL}`)
    expect(gul.reorder.count).toBe((await runReport(db, await reportDefinition(db, "IRT-25"), { locationId: LOC.GUL })).rowCount)
  })
})

describe("live: a walk-in retail sale at the Gulshan counter", () => {
  it("moves revenue today, collections and cash by exactly the invoice amounts", async () => {
    const tania = await as("tania")
    const before = {
      finance: await loadFinance(db, { today, period: "mtd" }),
      gulFinance: await loadFinance(db, { today, period: "today", locationId: LOC.GUL }),
      collections: await loadCollections(db, { from: today, to: today }),
      positions: await loadPositions(db, { today }),
      till: await gl(db, "CASH_TILL_GUL"),
    }
    const input = { locationId: LOC.GUL, items: [{ itemId: ITM.rtTyreShine, qty: 1 }], tenders: [{ method: "cash" as const, amountP: 1 }], idempotencyKey: key("probe") }
    const refusal = await refused(db, tania, checkout, input)
    expect(refusal.code).toBe("SI_TENDER_MISMATCH")
    const due = Number(refusal.params.dueP)
    const out = await run(db, tania, checkout, { ...input, tenders: [{ method: "cash", amountP: due, tenderedP: Math.ceil(due / 100_00) * 100_00 }], idempotencyKey: key("sale") })
    const invoice = (await db.salesInvoices.get(out.invoiceId))!
    const lines = await db.salesInvoiceLines.where("invoiceId").equals(invoice.id).toArray()
    const netP = lines.reduce((s, l) => s + l.netP, 0)
    expect(invoice.totalP).toBe(due)
    expect(invoice.partyId).toBe("pty_walk_in")

    const after = {
      finance: await loadFinance(db, { today, period: "mtd" }),
      gulFinance: await loadFinance(db, { today, period: "today", locationId: LOC.GUL }),
      collections: await loadCollections(db, { from: today, to: today }),
      positions: await loadPositions(db, { today }),
      till: await gl(db, "CASH_TILL_GUL"),
    }
    expect(after.finance.revenueTodayP - before.finance.revenueTodayP).toBe(netP)
    expect(after.finance.revenuePeriodP - before.finance.revenuePeriodP).toBe(netP)
    expect(after.gulFinance.revenueTodayP - before.gulFinance.revenueTodayP).toBe(netP)
    expect(after.collections.totalP - before.collections.totalP).toBe(invoice.totalP)
    expect(after.collections.count - before.collections.count).toBe(1)
    expect(after.positions.cashTotalP - before.positions.cashTotalP).toBe(invoice.totalP)
    expect(after.till - before.till).toBe(invoice.totalP)
    // Stock leaves the shelf at average cost (R5): stock value falls, the margin moves with COGS.
    expect(after.positions.stockTotalP).toBeLessThan(before.positions.stockTotalP)
    expect(after.finance.costOfSalesP - before.finance.costOfSalesP).toBe(before.positions.stockTotalP - after.positions.stockTotalP)
    expect(await trialBalanceTies(db)).toBe(true)
  })
})
