import type { ISODate } from "@/core/db/schema"
import type { Rng } from "@/lib/mock/rng"

import { LONG_SERVICES } from "../content/catalogue"
import { CREDIT_CUSTOMERS, type CreditCustomerDef, type Studio } from "../content/parties"
import { PLANT, PTY, SVC } from "../content/seed-refs"
import type { World } from "../engine/world"
import { addMonthsISO, firstOfMonth, isoAddDays } from "../time"
import { drawCreditPick, jobTotal, priceJob, type JobLine, type JobPick } from "./jobs"
import type { PoolVehicle } from "./parties"

/**
 * Credit customers (seed_data.md §5.2, §7.1, §7.4): jobs over the whole
 * history, consolidated invoices on the 2nd of each month for the previous
 * month (Swift Ride and Orbit on their own schedules anchored to today, so
 * their planted ages hold on any date), and receipts within terms, worked
 * backwards from the state at today.
 */

export type CreditJob = {
  key: number
  partyId: string
  studio: Studio
  date: ISODate
  vehicle: PoolVehicle
  lines: JobLine[]
  totalP: number
  /** Set once the job becomes an order (date at or after the cutover) */
  orderId?: string
  orderLineIds?: string[]
  invoiceKey?: number
}

export type PlannedPayment = { date: ISODate; allocP: number; method: "bank-transfer" | "cheque" }

export type CreditInvoice = {
  key: number
  id?: string
  partyId: string
  studio: Studio
  date: ISODate
  dueDate: ISODate
  kind: "consolidated" | "opening"
  jobs: CreditJob[]
  subtotalP: number
  discountP: number
  vatP: number
  totalP: number
  payments: PlannedPayment[]
}

export type CreditPlan = {
  jobs: CreditJob[]
  invoices: CreditInvoice[]
  /** Swift Ride's open total at today (exactly ৳3,12,000) */
  swiftOpenP: number
}

const SWIFT_OPEN_P = 3_12_000_00
const OPENING_AR_P = 7_85_000_00

function jobsOn(rng: Rng, rate: number): number {
  let k = 0
  let p = rate
  while (k < 3 && rng.next() < p) {
    k += 1
    p *= 0.35
  }
  return k
}

function swiftPick(rng: Rng): JobPick {
  const ids: string[] = [SVC.WSH_PRM]
  if (rng.bool(0.47)) ids.push(SVC.INT_DEEP)
  if (rng.bool(0.15)) ids.push(SVC.ENG_BAY)
  if (rng.bool(0.1)) ids.push(SVC.INT_ODR)
  return { serviceIds: ids, addOnIds: [] }
}

function sumInvoice(jobs: CreditJob[]) {
  let subtotalP = 0
  let discountP = 0
  let vatP = 0
  for (const j of jobs) {
    for (const l of j.lines) {
      subtotalP += l.grossP
      discountP += l.discountP
      vatP += l.vatP
    }
  }
  return { subtotalP, discountP, vatP, totalP: subtotalP - discountP + vatP }
}

export function planCredit(w: World, fleets: Map<string, PoolVehicle[]>): CreditPlan {
  const rng = w.rng("credit")
  const { today, F, C } = w.cal
  const jobs: CreditJob[] = []
  const invoices: CreditInvoice[] = []
  let key = 0
  const day = (n: number) => isoAddDays(today, n)

  const makeJob = (c: CreditCustomerDef, date: ISODate, pick?: JobPick): CreditJob => {
    const vehicle = rng.pick(fleets.get(c.id)!)
    const studio = rng.weighted(c.studios)
    let chosen = pick ?? drawCreditPick(rng, c.services)
    // No multi-day work in the last days of the history (it would run into today).
    if (date >= day(-5) && (chosen.packageId || chosen.serviceIds.some((id) => LONG_SERVICES.has(id)))) chosen = { serviceIds: [SVC.WSH_PRM], addOnIds: [] }
    const lines = priceJob(chosen, vehicle.cls, c.priceListId, 0)
    const job: CreditJob = { key: ++key, partyId: c.id, studio, date, vehicle, lines, totalP: jobTotal(lines) }
    jobs.push(job)
    return job
  }
  const makeInvoice = (c: CreditCustomerDef, studio: Studio, date: ISODate, list: CreditJob[], id?: string): CreditInvoice => {
    const inv: CreditInvoice = {
      key: ++key,
      id,
      partyId: c.id,
      studio,
      date,
      dueDate: isoAddDays(date, c.terms),
      kind: "consolidated",
      jobs: list,
      ...sumInvoice(list),
      payments: [],
    }
    for (const j of list) j.invoiceKey = inv.key
    invoices.push(inv)
    return inv
  }
  /** Days strictly inside (from, to], clipped to the history. */
  const daysIn = (from: ISODate, to: ISODate) => {
    const out: ISODate[] = []
    for (let d = isoAddDays(from, 1); d <= to; d = isoAddDays(d, 1)) if (d >= F) out.push(d)
    return out
  }
  const payLater = (inv: CreditInvoice, c: CreditCustomerDef, lagMin: number, lagMax: number) => {
    const date = isoAddDays(inv.date, rng.int(lagMin, lagMax))
    const method = c.pays === "bank" ? "bank-transfer" : c.pays === "cheque" ? "cheque" : rng.bool(0.5) ? "cheque" : "bank-transfer"
    // A cheque clears two days after it is received; nothing still in hand except the planted PDCs.
    const lastDay = method === "cheque" ? day(-4) : day(-1)
    if (date <= lastDay) inv.payments.push({ date, allocP: inv.totalP, method })
  }

  for (const c of CREDIT_CUSTOMERS) {
    if (c.id === PTY.swiftRide) {
      // Invoices dated exactly 20, 45, 70 (and every 25 further) days ago.
      const offsets: number[] = []
      for (let off = -20; day(off) > isoAddDays(F, 5); off -= 25) offsets.push(off)
      const windows = offsets.map((off, i) => ({ to: day(off), from: i + 1 < offsets.length ? day(offsets[i + 1]) : isoAddDays(F, -1), off }))
      const totals = new Map<number, number>()
      const fill = (from: ISODate, to: ISODate, target: number): CreditJob[] => {
        const days = daysIn(from, to)
        const list: CreditJob[] = []
        let total = 0
        while (total < target && days.length) {
          const job = makeJob(c, rng.pick(days), swiftPick(rng))
          list.push(job)
          total += job.totalP
        }
        return list
      }
      for (const win of windows) {
        let target = Math.round(rng.around(1_04_000_00, 4_000_00, 96_000_00, 1_12_000_00))
        if (win.off === -70) {
          const others = (totals.get(-20) ?? 0) + (totals.get(-45) ?? 0)
          target = SWIFT_OPEN_P - others + 25_000_00
        }
        const list = fill(win.from, win.to, target)
        const id = win.off === -20 ? PLANT.swiftInvoice20 : win.off === -45 ? PLANT.swiftInvoice45 : win.off === -70 ? PLANT.swiftInvoice70 : undefined
        const inv = makeInvoice(c, "GUL", win.to, list, id)
        totals.set(win.off, inv.totalP)
        if (win.off < -70) payLater(inv, c, 23, 29)
      }
      // The oldest open invoice is part paid so the open total is exactly ৳3,12,000.
      const inv70 = invoices.find((i) => i.id === PLANT.swiftInvoice70)
      if (inv70) {
        const open = SWIFT_OPEN_P - (totals.get(-20) ?? 0) - (totals.get(-45) ?? 0)
        if (open <= 0 || open >= inv70.totalP) throw new Error("seed: Swift Ride invoice targets out of range")
        inv70.payments.push({ date: day(-42), allocP: inv70.totalP - open, method: "bank-transfer" })
      }
      // 18 delivered, unbilled orders over the last 14 days (the last 6 in the small profile).
      const span = w.cal.small ? 6 : 13
      let best: CreditJob[] | null = null
      const r2 = w.rng("credit-swift-unbilled")
      for (let attempt = 0; attempt < 8; attempt++) {
        const list: CreditJob[] = []
        for (let i = 0; i < 18; i++) {
          const vehicle = r2.pick(fleets.get(c.id)!)
          const date = day(-1 - (i % span))
          // The last two days' fleet cars get the quick valet (premium wash and engine bay at most).
          const pick = swiftPick(r2)
          if (date >= day(-2)) pick.serviceIds = pick.serviceIds.filter((id) => id !== SVC.INT_DEEP)
          const lines = priceJob(pick, vehicle.cls, c.priceListId, 0)
          list.push({ key: 0, partyId: c.id, studio: "GUL", date, vehicle, lines, totalP: jobTotal(lines) })
        }
        const sum = list.reduce((s, j) => s + j.totalP, 0)
        const bestSum = best ? best.reduce((s, j) => s + j.totalP, 0) : Infinity
        if (Math.abs(sum - 96_000_00) < Math.abs(bestSum - 96_000_00)) best = list
      }
      for (const j of best!) {
        j.key = ++key
        jobs.push(j)
      }
      continue
    }

    if (c.id === PTY.orbit) {
      // An invoice 74 days past due (dated today − 104), then two more paid; no jobs after today − 44.
      const offsets: number[] = [-44, -74]
      for (let off = -104; day(off) > isoAddDays(F, 5); off -= 30) offsets.push(off)
      offsets.sort((a, b) => b - a)
      offsets.forEach((off, i) => {
        const to = day(off)
        const from = i + 1 < offsets.length ? day(offsets[i + 1]) : isoAddDays(F, -1)
        const list: CreditJob[] = []
        for (const d of daysIn(from, to)) for (let k = jobsOn(rng, c.ratePerDay); k > 0; k--) list.push(makeJob(c, d))
        if (!list.length) list.push(makeJob(c, to))
        const inv = makeInvoice(c, "UTT", to, list, off === -104 ? PLANT.orbitOverdueInvoice : undefined)
        if (off !== -104) payLater(inv, c, 18, 27)
      })
      continue
    }

    // The rest: consolidated invoices on the 2nd of each month for the previous month, per studio.
    const lastJobDay = day(-1)
    for (let d = F; d <= lastJobDay; d = isoAddDays(d, 1)) {
      const invoiceDay = isoAddDays(addMonthsISO(d, 1), 1)
      // Jobs before the cutover must be billed by today (they have no order rows).
      if (d < C && invoiceDay > today) continue
      for (let k = jobsOn(rng, c.ratePerDay); k > 0; k--) makeJob(c, d)
    }
    for (let m = firstOfMonth(F); m < w.cal.currentMonthStart; m = addMonthsISO(m, 1)) {
      const invoiceDay = isoAddDays(addMonthsISO(m, 1), 1)
      if (invoiceDay > today) continue
      for (const studio of ["GUL", "UTT"] as Studio[]) {
        const list = jobs.filter((j) => j.partyId === c.id && j.studio === studio && j.date >= m && j.date < addMonthsISO(m, 1))
        if (!list.length) continue
        const inv = makeInvoice(c, studio, invoiceDay, list)
        // Metro Corporate pays late in its terms, so about two months stay open.
        if (c.id === PTY.metroFleet) payLater(inv, c, c.terms - 5, c.terms - 1)
        else payLater(inv, c, Math.max(5, c.terms - 12), c.terms - 2)
      }
    }
  }

  // Opening invoices (dated in June, before F): the opening trade receivables, settled in the first two months.
  const weights = CREDIT_CUSTOMERS.map((c) => c.ratePerDay * (c.segment === "dealer" ? 3 : 1.4))
  const sumW = weights.reduce((s, x) => s + x, 0)
  let left = OPENING_AR_P
  CREDIT_CUSTOMERS.forEach((c, i) => {
    const amount = i === CREDIT_CUSTOMERS.length - 1 ? left : Math.round((OPENING_AR_P * weights[i]) / sumW / 100_00) * 100_00
    left -= amount
    const date = isoAddDays(F, -rng.int(6, 26))
    const vatP = Math.round((amount * 15) / 115)
    const inv: CreditInvoice = {
      key: ++key,
      partyId: c.id,
      studio: c.studios[0][0],
      date,
      dueDate: isoAddDays(date, c.terms),
      kind: "opening",
      jobs: [],
      subtotalP: amount - vatP,
      discountP: 0,
      vatP,
      totalP: amount,
      payments: [],
    }
    const pay = isoAddDays(F, rng.int(8, 50))
    if (pay <= day(-1)) inv.payments.push({ date: pay, allocP: amount, method: c.pays === "cheque" ? "cheque" : "bank-transfer" })
    invoices.push(inv)
  })

  jobs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key - b.key))
  invoices.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key - b.key))
  return { jobs, invoices, swiftOpenP: SWIFT_OPEN_P }
}
