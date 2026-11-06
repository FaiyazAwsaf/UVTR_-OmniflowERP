import { describe, expect, it } from "vitest"

import { invoiceOpen } from "@/core/ar/receipt"
import type { Row, TableName } from "@/core/db/tables"
import { DATASET_BY_CODE } from "@/core/reports/datasets"
import { RECIPES } from "@/core/seed/content/catalogue"
import * as REFS from "@/core/seed/content/seed-refs"
import { ITM, LOC, PENDING_APPROVAL_IDS, PL, PLANT, PTY, REC, SVC, USR, VEH } from "@/core/seed/content/seed-refs"
import { periodIdOf } from "@/core/seed/generators/org"
import { addMonthsISO, dhakaAt, dhakaDate, isoAddDays, lastOfMonth } from "@/core/seed/time"
import { scaleRecipeQty } from "@/core/stock/value"

import { built, rows } from "./helpers"

/**
 * The planted states every launcher and the demo story rely on
 * (seed_data.md §8, §9), fixed ids, closed periods, recurring entries,
 * row counts, and data hygiene (synthetic names, no em dashes).
 */

const TABLE_BY_PREFIX: [string, TableName][] = [
  ["loc_", "locations"], ["cc_", "costCentres"], ["bay_", "bays"], ["usr_", "users"], ["cba_", "cashBankAccounts"],
  ["pty_", "parties"], ["veh_", "vehicles"], ["itm_", "items"], ["cat_", "itemCategories"], ["svc_", "services"],
  ["pkg_", "packages"], ["add_", "addOns"], ["pl_", "priceLists"], ["prm_", "promotions"], ["rec_", "recurringJournals"],
  ["po_", "purchaseOrders"], ["apv_", "approvals"], ["pcv_", "pettyCashVouchers"], ["adj_", "stockAdjustments"],
  ["bl_", "vendorBills"], ["grn_", "grns"], ["chq_", "cheques"], ["mr_", "receipts"], ["inv_", "salesInvoices"],
  ["so_", "salesOrders"], ["trf_", "transfers"], ["ses_", "sessions"],
]

function tableOf(id: string): TableName {
  const hit = TABLE_BY_PREFIX.find(([p]) => id.startsWith(p))
  if (!hit) throw new Error(`no table for ${id}`)
  return hit[1]
}

for (const scale of ["full", "small"] as const) {
  describe(`seeded planted states (${scale})`, () => {
    const { bag, today } = built(scale)
    const yesterday = isoAddDays(today, -1)
    const get = <T extends TableName>(t: T, id: string): Row<T> => bag.get(t, id)
    const invoices = rows(bag, "salesInvoices")
    const orders = rows(bag, "salesOrders")
    const tasks = rows(bag, "jobTasks")
    const stock = (itemId: string, loc: string) => bag.find("stockValues", `sv:${itemId}:${loc}`)?.qtyBase ?? 0

    it("every fixed id in seed-refs exists", () => {
      const ids = new Set<string>()
      for (const group of Object.values(REFS)) {
        if (Array.isArray(group)) group.forEach((id) => ids.add(id as string))
        else if (group && typeof group === "object") Object.values(group).forEach((id) => ids.add(id as string))
      }
      expect(ids.size).toBeGreaterThan(120)
      for (const id of ids) expect(bag.find(tableOf(id), id), id).toBeDefined()
    })

    it("row counts are in range", () => {
      expect(bag.count("users")).toBe(21)
      expect(bag.count("roles")).toBe(11)
      expect(bag.count("services")).toBe(18)
      expect(bag.count("items")).toBeGreaterThanOrEqual(55)
      expect(bag.count("items")).toBeLessThanOrEqual(65)
      expect(bag.count("reportDefinitions")).toBe(33)
      const vendors = rows(bag, "parties").filter((p) => p.isVendor).length
      expect(vendors).toBe(14)
      const retail = rows(bag, "parties").filter((p) => p.segment === "retail").length
      const window = orders.filter((o) => o.bookedOn >= isoAddDays(today, scale === "full" ? -30 : -7) && o.bookedOn < today).length
      if (scale === "full") {
        expect(bag.count("parties")).toBeGreaterThanOrEqual(400)
        expect(bag.count("parties")).toBeLessThanOrEqual(460)
        expect(retail).toBeGreaterThanOrEqual(395)
        const retailVehicles = rows(bag, "vehicles").filter((v) => get("parties", v.partyId).segment === "retail").length
        expect(retailVehicles).toBeGreaterThanOrEqual(430)
        expect(retailVehicles).toBeLessThanOrEqual(540)
        expect(window).toBeGreaterThanOrEqual(560)
        expect(window).toBeLessThanOrEqual(760)
      } else {
        expect(retail).toBeGreaterThanOrEqual(38)
        expect(retail).toBeLessThanOrEqual(45)
        expect(window).toBeGreaterThanOrEqual(30)
        expect(window).toBeLessThanOrEqual(120)
      }
    })

    it("J1 to J6: Shahed Kabir, his Corolla Cross and two past orders; Gulshan's C1 and Rakib free from 11:00; ceramic for two SUV jobs", () => {
      const shahed = get("parties", PTY.shahedKabir)
      expect(shahed.nameEn).toBe("Shahed Kabir")
      expect(shahed.phone).toBe("01819-447731")
      const car = get("vehicles", VEH.corollaCross7731)
      expect([car.make, car.model, car.vehicleClass, car.colour, car.regNo]).toEqual(["Toyota", "Corolla Cross", "SUV", "Pearl white", "DHAKA METRO-GHA 15-7731"])
      const past = orders.filter((o) => o.partyId === PTY.shahedKabir)
      expect(past.length).toBe(2)
      for (const o of past) expect(o.status).toBe("closed")
      const from = dhakaAt(today, "11:00")
      const c1 = tasks.filter((t) => t.bayId === "bay_gul_c1" && t.status !== "done" && t.plannedStart + t.plannedMinutes * 60_000 > from)
      expect(c1).toEqual([])
      const rakib = tasks.filter((t) => t.technicianId === USR.rakib && t.status !== "done")
      for (const t of rakib) expect(t.plannedStart + t.plannedMinutes * 60_000).toBeLessThanOrEqual(from)
      const suvJob = scaleRecipeQty(30, "SUV", "ml")
      expect(suvJob).toBe(38)
      expect(stock(ITM.cc2Kit, LOC.GUL)).toBeGreaterThanOrEqual(2 * suvJob)
    })

    it("today's board at 10:30 (seed_data.md §8)", () => {
      const startOfToday = dhakaAt(today, "00:00")
      const count = (loc: string, status: string) =>
        orders.filter((o) => o.locationId === loc && o.status === status && (status !== "booked" || dhakaDate(o.scheduledAt) === today)).length
      const delivered = (loc: string) => orders.filter((o) => o.locationId === loc && o.deliveredAt && o.deliveredAt >= dhakaAt(today, "09:00") && o.status === "closed").length
      expect([count(LOC.GUL, "booked"), count(LOC.GUL, "qc"), count(LOC.GUL, "ready"), delivered(LOC.GUL)]).toEqual([4, 1, 1, 2])
      expect([count(LOC.UTT, "booked"), count(LOC.UTT, "qc"), count(LOC.UTT, "ready"), delivered(LOC.UTT)]).toEqual([3, 1, 1, 1])
      const inProgress = (loc: string) => orders.filter((o) => o.locationId === loc && o.status === "in-progress")
      expect(inProgress(LOC.GUL).map((o) => o.bayId).sort()).toEqual(["bay_gul_d1", "bay_gul_d2", "bay_gul_d3", "bay_gul_w1"])
      const d3 = get("salesOrders", PLANT.gulD3Order)
      expect(d3.startedAt! < startOfToday).toBe(true)
      expect(inProgress(LOC.UTT).map((o) => o.bayId).sort()).toEqual(["bay_utt_d1", "bay_utt_w1"])
      const uttTechsToday = tasks.filter((t) => t.locationId === LOC.UTT && t.plannedStart >= startOfToday).map((t) => t.technicianId)
      expect(new Set(uttTechsToday)).toEqual(new Set([USR.jewel, USR.kamrul]))
      // Nothing from the history runs into today.
      for (const o of orders) {
        if (o.status === "closed" || o.status === "delivered" || o.status === "invoiced") expect(o.deliveredAt!).toBeLessThanOrEqual(dhakaAt(today, "10:30"))
      }
    })

    it("E3: Uttara holds 20 ml of ceramic 2-year (minimum 100), its booked SUV job in C1 needs 38 ml, the Central Store 900 ml", () => {
      expect(stock(ITM.cc2Kit, LOC.UTT)).toBe(20)
      expect(stock(ITM.cc2Kit, LOC.CST)).toBe(900)
      const rule = rows(bag, "reorderRules").find((r) => r.itemId === ITM.cc2Kit && r.locationId === LOC.UTT)!
      expect(rule.minQty).toBe(100)
      const e3 = get("salesOrders", PLANT.e3Order)
      expect(e3.status).toBe("booked")
      expect(e3.bayId).toBe("bay_utt_c1")
      expect(dhakaDate(e3.scheduledAt)).toBe(today)
      expect(get("vehicles", e3.vehicleId!).vehicleClass).toBe("SUV")
      const lines = rows(bag, "salesOrderLines").filter((l) => l.orderId === e3.id)
      expect(lines.map((l) => l.refId)).toEqual([SVC.PRT_CC2])
      const need = RECIPES[SVC.PRT_CC2].find(([id]) => id === ITM.cc2Kit)![1]
      expect(scaleRecipeQty(need, "SUV", "ml")).toBe(38)
      expect(tasks.filter((t) => t.orderId === e3.id).every((t) => t.status === "queued" && t.technicianId !== USR.polash)).toBe(true)
    })

    it("E2: Swift Ride owes exactly ৳3,12,000 in invoices dated 20, 45 and 70 days ago, plus 18 delivered unbilled orders at Gulshan", () => {
      const open = invoices.filter((i) => i.partyId === PTY.swiftRide && invoiceOpen(i) > 0)
      expect(open.map((i) => i.date).sort()).toEqual([isoAddDays(today, -70), isoAddDays(today, -45), isoAddDays(today, -20)])
      expect(open.reduce((s, i) => s + invoiceOpen(i), 0)).toBe(3_12_000_00)
      const unbilled = orders.filter((o) => o.partyId === PTY.swiftRide && o.status === "delivered")
      expect(unbilled.length).toBe(18)
      for (const o of unbilled) {
        expect(o.locationId).toBe(LOC.GUL)
        expect(o.bookedOn >= isoAddDays(today, -14)).toBe(true)
      }
      const total = unbilled.reduce((s, o) => s + o.totalP, 0)
      expect(total).toBeGreaterThan(80_000_00)
      expect(total).toBeLessThan(1_15_000_00)
      expect(3_12_000_00 + total).toBeGreaterThan(get("parties", PTY.swiftRide).creditLimitP)
    })

    it("E8 and the PDC notice: Metro's ৳85,000 cheque dated today and Greenway's ৳40,000 in three days, in hand, receipts pending", () => {
      const e8 = get("receipts", PLANT.e8Receipt)
      const chq = get("cheques", PLANT.e8Cheque)
      expect([e8.status, e8.method, e8.amountP, e8.date]).toEqual(["pending", "cheque", 85_000_00, yesterday])
      expect([chq.status, chq.chequeDate, chq.receivedOn, chq.isPdc, chq.amountP]).toEqual(["in-hand", today, yesterday, true, 85_000_00])
      const metroOpen = invoices.filter((i) => i.partyId === PTY.metroFleet && invoiceOpen(i) > 0).sort((a, b) => (a.date < b.date ? -1 : 1))
      expect(e8.allocations.length).toBe(1)
      expect(e8.allocations[0].invoiceId).toBe(metroOpen[0].id)
      expect(metroOpen[0].reservedP).toBe(e8.allocations[0].amountP)
      expect(metroOpen[0].reservedP).toBeLessThan(invoiceOpen(metroOpen[0]))
      const outstanding = metroOpen.reduce((s, i) => s + invoiceOpen(i), 0)
      expect(outstanding).toBeGreaterThan(1_00_000_00)
      expect(outstanding).toBeLessThan(4_00_000_00)
      const gw = get("cheques", PLANT.greenwayCheque)
      expect([gw.status, gw.chequeDate, gw.receivedOn, gw.amountP, gw.isPdc]).toEqual(["in-hand", isoAddDays(today, 3), yesterday, 40_000_00, true])
      expect(get("receipts", PLANT.greenwayReceipt).status).toBe("pending")
    })

    it("Orbit is on hold for an invoice 74 days past due; the current customers are within terms", () => {
      const orbit = get("parties", PTY.orbit)
      expect(orbit.status).toBe("on-hold")
      expect(dhakaDate(orbit.autoHoldAt!)).toBe(isoAddDays(today, -14))
      expect(orbit.holdReason).toMatch(/^Invoice INV-/)
      const overdue = get("salesInvoices", PLANT.orbitOverdueInvoice)
      expect(overdue.dueDate).toBe(isoAddDays(today, -74))
      expect(invoiceOpen(overdue)).toBe(overdue.totalP)
      for (const id of [PTY.greenway, PTY.bluebird, PTY.skyline, PTY.primeAuto, PTY.wheelsHub, PTY.gearbox, PTY.autoNest]) {
        for (const inv of invoices.filter((i) => i.partyId === id && invoiceOpen(i) > 0)) expect(inv.dueDate >= today, `${id} ${inv.date}`).toBe(true)
      }
    })

    it("E6: Prime Guard's latest bill, today − 13, ৳60,000 + VAT ৳9,000, posted and unpaid, due in 2 days", () => {
      const bill = get("vendorBills", PLANT.e6Bill)
      expect([bill.date, bill.subtotalP, bill.inputVatP, bill.status, bill.paidP, bill.dueDate]).toEqual([isoAddDays(today, -13), 60_000_00, 9_000_00, "posted", 0, isoAddDays(today, 2)])
      const later = rows(bag, "vendorBills").filter((b) => b.partyId === bill.partyId && b.date > bill.date)
      expect(later).toEqual([])
    })

    it("E12: a paid retail invoice from 3 days ago (premium wash and interior deep clean, SUV) with a complaint on its order", () => {
      const inv = get("salesInvoices", PLANT.e12Invoice)
      expect([inv.date, inv.status, inv.kind]).toEqual([isoAddDays(today, -3), "paid", "counter"])
      const lines = rows(bag, "salesInvoiceLines").filter((l) => l.invoiceId === inv.id)
      expect(lines.map((l) => l.serviceId).sort()).toEqual([SVC.INT_DEEP, SVC.WSH_PRM].sort())
      expect(lines.every((l) => l.vehicleClass === "SUV")).toBe(true)
      expect(get("salesOrders", PLANT.e12Order).complaintNote).toBeTruthy()
    })

    it("the four pending approvals of §8, all dated today, routed to the right people; nothing else pending", () => {
      const pending = rows(bag, "approvals").filter((a) => a.status === "pending")
      expect(pending.map((a) => a.id).sort()).toEqual([...PENDING_APPROVAL_IDS].sort())
      for (const a of pending) expect(dhakaDate(a.requestedAt)).toBe(today)
      const po = get("approvals", PLANT.pendingPoApproval)
      expect(po.amountP).toBe(1_48_000_00)
      expect(po.requestedBy).toBe(USR.nusrat)
      expect(po.routedTo).toEqual([USR.farzana, USR.rashed].sort())
      expect(get("purchaseOrders", PLANT.pendingPo).totalP).toBe(1_48_000_00)
      const pcv = get("approvals", PLANT.pendingPettyCashApproval)
      expect([pcv.amountP, pcv.requestedBy]).toEqual([3_500_00, USR.tania])
      expect(pcv.routedTo).toContain(USR.shahriar)
      expect(pcv.routedTo).not.toContain(USR.arif)
      const adj = get("approvals", PLANT.pendingAdjustmentApproval)
      expect(adj.requestedBy).toBe(USR.habib)
      expect(adj.amountP!).toBeGreaterThan(3_000_00)
      expect(adj.amountP!).toBeLessThan(3_900_00)
      expect(adj.routedTo).toContain(USR.arif)
      expect(stock(ITM.polish, LOC.UTT)).toBeGreaterThanOrEqual(1000)
      const bill = get("vendorBills", PLANT.heldBill)
      expect([bill.status, bill.matchStatus, bill.date, bill.journalId]).toEqual(["on-hold", "mismatch", today, undefined])
      expect(bill.matchDiffs.every((d) => d.diffPct === 4)).toBe(true)
      expect(get("approvals", PLANT.heldBillApproval).routedTo).toContain(USR.farzana)
      // Decided approvals: never self-approved; the decider was eligible.
      for (const a of rows(bag, "approvals")) {
        if (!a.decidedBy) continue
        expect(a.decidedBy).not.toBe(a.requestedBy)
        expect(a.routedTo).toContain(a.decidedBy)
      }
    })

    it("the demo story: Bengal Detail's partial PO, the draft RETAIL list, 3 to 5 items below minimum per studio, 2 CST batches expiring within 60 days, a transfer in transit", () => {
      const po = get("purchaseOrders", PLANT.bengalPartialPo)
      expect(po.status).toBe("partial")
      const line = rows(bag, "poLines").find((l) => l.poId === po.id)!
      expect([line.itemId, line.qty, line.qtyReceived]).toEqual([ITM.polishingPad, 40, 24])
      const draft = get("priceLists", PL.retailDraft)
      expect([draft.status, draft.code, draft.validFrom, draft.revisionOfId]).toEqual(["draft", "RETAIL", addMonthsISO(today, 1), PL.retail])
      const draftWash = rows(bag, "priceListLines").find((l) => l.priceListId === PL.retailDraft && l.targetId === "svv_wsh_exp_sd")!
      expect(draftWash.priceP).toBe(660_00)
      const rules = rows(bag, "reorderRules")
      for (const loc of [LOC.GUL, LOC.UTT]) {
        const below = rules.filter((r) => r.locationId === loc && stock(r.itemId, loc) < r.minQty)
        expect(below.length, loc).toBeGreaterThanOrEqual(3)
        expect(below.length, loc).toBeLessThanOrEqual(5)
      }
      const balances = rows(bag, "stockBalances").filter((b) => b.locationId === LOC.CST && b.qtyBase > 0 && b.batchId)
      const soon = balances.filter((b) => {
        const exp = get("batches", b.batchId!).expiry
        return exp && exp <= isoAddDays(today, 60)
      })
      expect(soon.length).toBe(2)
      expect(get("transfers", PLANT.inTransitTransfer).status).toBe("dispatched")
      // One transfer shortfall of 2 pieces, noted on its line.
      const short = rows(bag, "transferLines").filter((l) => l.discrepancyNote)
      expect(short.length).toBe(1)
      expect(short[0].qtySent - short[0].qtyReceived).toBe(2)
      if (scale === "full") {
        // QC rejections went back to the vendor; a mismatched bill was released by Farzana.
        expect(rows(bag, "grnLines").some((g) => g.quarantineStatus === "returned" && g.qtyRejected > 0)).toBe(true)
        const released = rows(bag, "vendorBills").filter((b) => b.matchStatus === "mismatch" && b.status !== "on-hold")
        expect(released.length).toBeGreaterThan(0)
        for (const b of released) expect(get("approvals", b.holdApprovalId!).decidedBy).toBe(USR.farzana)
      }
    })

    it("closed periods are exactly the months before last month and hold nothing pending; recurring entries posted every month before this one", () => {
      const lastMonthStart = addMonthsISO(today, -1)
      for (const p of rows(bag, "periods")) expect(p.status, p.code).toBe(p.startsOn < lastMonthStart ? "closed" : "open")
      const closed = (d: string) => d < lastMonthStart
      for (const j of rows(bag, "journals")) expect(j.status).toBe("posted")
      for (const b of rows(bag, "vendorBills")) if (b.status === "on-hold") expect(closed(b.date)).toBe(false)
      for (const r of rows(bag, "receipts")) if (r.status === "pending") expect(closed(r.date)).toBe(false)
      for (const v of rows(bag, "pettyCashVouchers")) if (v.status !== "posted") expect(closed(v.date)).toBe(false)
      for (const v of rows(bag, "purchaseOrders")) if (v.status === "pending-approval" || v.status === "draft") expect(closed(v.orderDate)).toBe(false)
      for (const a of rows(bag, "stockAdjustments")) if (a.status !== "posted") expect(closed(a.date)).toBe(false)
      const journals = rows(bag, "journals")
      for (let m = `${rows(bag, "periods").map((p) => p.startsOn).sort()[0]}`; m < `${today.slice(0, 7)}-01`; m = addMonthsISO(m, 1)) {
        for (const rec of [REC.depreciation, REC.salary]) {
          expect(journals.some((j) => j.recurringId === rec && j.date === lastOfMonth(m)), `${rec} ${m}`).toBe(true)
        }
      }
      for (const r of rows(bag, "recurringJournals")) expect(r.lastPostedPeriodId).toBe(periodIdOf(lastMonthStart.slice(0, 7)))
      // Statements: reconciled for every closed month (BRAC and Dutch-Bangla), none for last month.
      const statements = rows(bag, "bankStatements")
      expect(statements.every((s) => s.status === "reconciled" && closed(s.fromDate))).toBe(true)
      expect(statements.some((s) => s.fromDate === lastMonthStart)).toBe(false)
      // A year is closed (with its YC voucher) only when all its months are.
      for (const fy of rows(bag, "fiscalYears")) {
        const yc = journals.filter((j) => j.voucherType === "YC" && j.date === fy.endsOn)
        expect(yc.length, fy.code).toBe(fy.status === "closed" ? 1 : 0)
      }
    })

    it("security history: Polash locked by five failures yesterday; Rashed's other session ended by timeout", () => {
      const polash = get("users", USR.polash)
      expect([polash.status, polash.failedAttempts]).toEqual(["locked", 5])
      const fails = rows(bag, "loginEvents").filter((e) => e.userId === USR.polash && e.result === "bad-password" && dhakaDate(e.at) === yesterday)
      expect(fails.length).toBe(5)
      const ses = get("sessions", PLANT.rashedTimeoutSession)
      expect([ses.userId, ses.endedReason, dhakaDate(ses.startedAt)]).toEqual([USR.rashed, "timeout", yesterday])
      const days = new Set(rows(bag, "loginEvents").map((e) => dhakaDate(e.at)))
      expect(days.size).toBeGreaterThanOrEqual(28)
    })

    it("the 33 IRT system reports point at real datasets or FRS screens", () => {
      const defs = rows(bag, "reportDefinitions").sort((a, b) => (a.code < b.code ? -1 : 1))
      expect(defs.map((d) => d.code)).toEqual(Array.from({ length: 33 }, (_, i) => `IRT-${String(i + 1).padStart(2, "0")}`))
      for (const d of defs) {
        expect(d.isSystem).toBe(true)
        if (d.dataset) {
          const ds = DATASET_BY_CODE.get(d.dataset)
          expect(ds, d.code).toBeDefined()
          const keys = new Set(ds!.fields.map((f) => f.key))
          for (const c of [...d.columns, ...(d.groupBy ?? []), ...d.totals]) expect(keys.has(c), `${d.code} ${c}`).toBe(true)
        } else expect(d.frsRoute).toMatch(/^\/frs\//)
      }
      expect(defs.find((d) => d.code === "IRT-16")!.chart).toEqual({ kind: "bar", x: "category", y: "netP", series: "location" })
    })

    it("counters continue from the history", () => {
      const { counters } = built(scale)
      const value = new Map(counters.map((c) => [c.id, c.value]))
      const checkSeries = (nos: string[]) => {
        const max = new Map<string, number>()
        for (const no of nos) {
          const parts = no.split("-")
          const serial = Number(parts.pop())
          const prefix = parts.join("-")
          max.set(prefix, Math.max(max.get(prefix) ?? 0, serial))
        }
        for (const [prefix, m] of max) {
          const parts = prefix.split("-")
          const key = parts.length === 3 ? `no:${parts[0]}:${parts[1]}:${parts[2]}` : `no:${parts[0]}:-:${parts[1]}`
          expect(value.get(key), key).toBe(m)
        }
      }
      checkSeries(rows(bag, "journals").map((j) => j.journalNo))
      checkSeries(invoices.map((i) => i.invoiceNo))
      checkSeries(orders.map((o) => o.orderNo))
      checkSeries(rows(bag, "vendorBills").map((b) => b.billNo))
      checkSeries(rows(bag, "purchaseOrders").map((p) => p.poNo))
    })
  })
}

describe("seed hygiene", () => {
  const { bag } = built("full")

  it("no em dashes anywhere in the seeded text", () => {
    for (const table of bag.tableNames()) {
      for (const row of bag.all(table)) {
        for (const s of strings(row)) expect(s.includes(String.fromCharCode(0x2014)), `${table}/${(row as { id: string }).id}`).toBe(false)
      }
    }
  })

  it("customer names are built only from the synthetic name lists", async () => {
    const names = await import("@/core/seed/content/names")
    const parts = new Set<string>()
    for (const v of Object.values(names)) {
      if (!Array.isArray(v)) continue
      for (const entry of v as unknown[]) if (Array.isArray(entry)) for (const w of String(entry[0]).split(" ")) parts.add(w)
    }
    for (const p of [names.UR_SURNAME, names.MD_PREFIX, names.MST_PREFIX, names.RANI]) for (const w of p[0].split(" ")) parts.add(w)
    const retail = rows(bag, "parties").filter((p) => p.segment === "retail" && p.id !== PTY.shahedKabir && p.id !== PTY.e1Customer)
    for (const p of retail) for (const w of p.nameEn.split(" ")) expect(parts.has(w), p.nameEn).toBe(true)
  })

  it("is deterministic: two builds are identical", async () => {
    const { buildSeed } = await import("@/core/seed")
    const today = built("full").today
    const a = buildSeed({ now: dhakaAt(today, "10:30"), today, scale: "small" })
    const b = buildSeed({ now: dhakaAt(today, "10:30"), today, scale: "small" })
    for (const t of a.bag.tableNames()) expect(JSON.stringify(b.bag.all(t)), t).toBe(JSON.stringify(a.bag.all(t)))
    expect(b.counters).toEqual(a.counters)
  })
})

function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value
  else if (Array.isArray(value)) for (const v of value) yield* strings(v)
  else if (value && typeof value === "object") for (const v of Object.values(value)) yield* strings(v)
}
