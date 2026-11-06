import type { ISODate, Id, InventoryTag, Ms } from "@/core/db/schema"
import { linesForGoodsAccepted, linesForTransferDispatch, linesForTransferReceipt } from "@/core/ledger/rules"
import { roundQty } from "@/core/stock/value"
import { percentOf } from "@/core/tax/vat"

import { ITEM_BY_ID, ITEMS, RETAIL_ITEMS, TAG_OF_KIND, type ItemDef } from "../content/catalogue"
import { VENDOR_OF_ITEM } from "../content/parties"
import { ITM, LOC, PLANT, USR, VND } from "../content/seed-refs"
import type { EventQueue } from "../engine/events"
import type { World } from "../engine/world"
import { dhakaAt, dhakaDate, isoAddDays, isoWeekday, MINUTE } from "../time"
import { recipeFor, stdValueP } from "./jobs"
import type { SummaryOut } from "./summary"

/**
 * Stock from the cutover C (seed_data.md §4, §7.3, §7.4, §9): reorder rules
 * from the consumption history; a quantity plan (opening balances between
 * minimum and maximum, transfers from the Central Store to each studio twice
 * a week, weekly requisitions and purchase orders with goods received two to
 * five days later, 8% of lines with a QC rejection) settled so every issue
 * is covered and the planted end states hold (Uttara 20 ml of ceramic
 * 2-year, the Central Store 900 ml, 3 to 5 items below minimum at each
 * studio, Gulshan's ceramic enough for two SUV jobs, two Central Store
 * batches expiring within 60 days); then the execution in time order with
 * the stock math, valuing every move and posting R12, R20 and R21.
 */

type Loc = typeof LOC.CST | typeof LOC.GUL | typeof LOC.UTT
const STOCK_LOCS: Loc[] = [LOC.CST, LOC.GUL, LOC.UTT]
const STUDIOS: Loc[] = [LOC.GUL, LOC.UTT]
const STUDIO_ITEMS = ITEMS.filter((i) => !i.variant)
/** Transfer days by studio (isoWeekday): Gulshan Sunday and Wednesday, Uttara Monday and Thursday. */
const TRANSFER_DAYS: Record<string, number[]> = { [LOC.GUL]: [0, 3], [LOC.UTT]: [1, 4] }
const RECEIVE_TIME: Record<string, string> = { [LOC.GUL]: "12:30", [LOC.UTT]: "15:30" }
/** The company van that runs the transfers (invented registration). */
const VAN = "DHAKA METRO-NA 11-2045"
const CC2_CST_TARGET = 900
const CC2_UTT_TARGET = 20

export type Rule = { min: number; max: number }

export type PlannedTransfer = {
  id: Id
  to: Loc
  dispatchAt: Ms
  /** null while in transit */
  receiveAt: Ms | null
  lines: Map<Id, number>
  shortfall?: { itemId: Id; qty: number }
  urgent?: boolean
}

export type PlannedPoLine = { itemId: Id; units: number; unitCostP: number; rejected: number; received: number }
export type PlannedPo = {
  id: Id
  vendorId: Id
  prId?: Id
  orderAt: Ms
  grnId?: Id
  grnAt: Ms | null
  lines: PlannedPoLine[]
  kind: "weekly" | "bengal-partial" | "held-bill"
}

export type StockOut = {
  /** Σ opening stock value at C by `${loc}|${tag}` (the summary history balances to it) */
  openingValue: Map<string, number>
  rules: Map<string, Rule>
  pos: PlannedPo[]
  transfers: PlannedTransfer[]
}

const key = (loc: Id, itemId: Id) => `${loc}|${itemId}`

function roundBase(item: ItemDef, qty: number, up = true): number {
  if (item.baseUom === "ml" || item.baseUom === "g") return Math.max(10, (up ? Math.ceil : Math.round)(qty / 10) * 10)
  return Math.max(1, Math.ceil(qty))
}

/** Largest single-job quantity of an item (an LSUV), for lumpy usage. */
const JOB_MAX = new Map<Id, number>()
for (const item of ITEMS) {
  let m = 0
  for (const sv of ["svc_wsh_exp", "svc_wsh_prm", "svc_int_deep", "svc_int_lth", "svc_int_odr", "svc_pnt_dcn", "svc_pnt_c1", "svc_pnt_c2", "svc_prt_wax", "svc_prt_sln", "svc_prt_cc2", "svc_prt_cc5", "svc_gls_cln", "svc_whl_cln", "svc_whl_cc", "svc_eng_bay", "svc_rst_hl", "svc_rst_trm"]) {
    for (const r of recipeFor(sv, "LSUV")) if (r.itemId === item.id) m = Math.max(m, r.qty)
  }
  JOB_MAX.set(item.id, m)
}

/* ================================================================== *
 * Reorder rules
 * ================================================================== */

export function reorderRules(w: World, q: EventQueue, summary: SummaryOut): Map<string, Rule> {
  const recent = new Map(summary.recentQty)
  const from = isoAddDays(w.cal.today, -56)
  for (const d of q.demand) if (d.date >= from) recent.set(key(d.loc, d.itemId), (recent.get(key(d.loc, d.itemId)) ?? 0) + d.qty)
  const rules = new Map<string, Rule>()
  const weeks = 8
  for (const item of STUDIO_ITEMS) {
    for (const loc of STUDIOS) {
      const weekly = (recent.get(key(loc, item.id)) ?? 0) / weeks
      let rule: Rule
      if (item.kind === "retail") rule = { min: 6, max: 24 }
      else if (weekly === 0 && !JOB_MAX.get(item.id)) rule = { min: item.purchaseFactor, max: item.purchaseFactor * 3 }
      else {
        const min = roundBase(item, Math.max(weekly, 1.5 * (JOB_MAX.get(item.id) ?? 0)))
        rule = { min, max: roundBase(item, Math.max(3 * weekly, 2.5 * min)) }
      }
      rules.set(key(loc, item.id), rule)
    }
  }
  // Planted exception: Uttara keeps at least 100 ml of ceramic 2-year (E3 starts below it).
  rules.set(key(LOC.UTT, ITM.cc2Kit), { min: 100, max: 300 })
  for (const item of ITEMS) {
    const f = item.purchaseFactor
    if (item.variant) {
      rules.set(key(LOC.CST, item.id), { min: 2 * f, max: 6 * f })
      continue
    }
    const weekly = ((recent.get(key(LOC.GUL, item.id)) ?? 0) + (recent.get(key(LOC.UTT, item.id)) ?? 0)) / weeks
    const min = Math.max(f, Math.ceil((6 * weekly) / f) * f)
    rules.set(key(LOC.CST, item.id), { min, max: Math.max(3 * f, Math.ceil((12 * weekly) / f) * f, 2 * min) })
  }
  return rules
}

/* ================================================================== *
 * The quantity plan
 * ================================================================== */

type PlanInput = {
  openings: Map<string, number>
  pinned: Set<string>
  /** Extra quantity forced onto a studio's last transfer (to keep items at or above minimum) */
  boosts: Map<string, number>
}

type PlanResult = {
  transfers: PlannedTransfer[]
  pos: PlannedPo[]
  finals: Map<string, number>
  lastTransfer: Map<Loc, PlannedTransfer>
}

function nextTransferGap(loc: Loc, day: ISODate): number {
  for (let g = 1; g <= 7; g++) if (TRANSFER_DAYS[loc].includes(isoWeekday(isoAddDays(day, g)))) return g
  return 7
}

function simulate(w: World, q: EventQueue, rules: Map<string, Rule>, input: PlanInput): PlanResult {
  const rng = w.ctx.rng("stock-plan")
  const { C, today, now } = w.cal
  const qty = new Map(input.openings)
  const get = (k: string) => qty.get(k) ?? 0
  const bump = (k: string, d: number) => qty.set(k, roundQty(get(k) + d))
  const weeklyAt = (loc: Loc, itemId: Id) => {
    const r = rules.get(key(loc, itemId))
    return r ? r.min / 1 : 0
  }
  const transfers: PlannedTransfer[] = []
  const pos: PlannedPo[] = []
  const lastTransfer = new Map<Loc, PlannedTransfer>()
  const onOrder = new Map<Id, number>()
  let shortfallDone = false

  type Dyn = { at: Ms; seq: number; run: () => void }
  const dyn: Dyn[] = []
  let dseq = 0
  const schedule = (at: Ms, run: () => void) => {
    dyn.push({ at, seq: dseq++, run })
    dyn.sort((a, b) => a.at - b.at || a.seq - b.seq)
  }

  // Daily decision points.
  for (let day = C; day <= today; day = isoAddDays(day, 1)) {
    const wd = isoWeekday(day)
    if (wd === 0 && day < today) schedule(dhakaAt(day, "10:00"), () => purchase(day))
    for (const loc of STUDIOS) {
      if (TRANSFER_DAYS[loc].includes(wd) && day < today) schedule(dhakaAt(day, "09:00"), () => transfer(loc, day))
    }
  }
  // Planted purchase orders: Bengal Detail (40 polishing pads, 24 received) and the held-bill PO from Dhaka Auto Chem.
  const bengalOrder = dhakaAt(isoAddDays(today, -5), "14:30")
  pos.push({ id: PLANT.bengalPartialPo, vendorId: VND.bengalDetail, orderAt: bengalOrder, grnId: PLANT.bengalPartialGrn, grnAt: dhakaAt(isoAddDays(today, -2), "11:30"), kind: "bengal-partial",
    lines: [{ itemId: ITM.polishingPad, units: 40, unitCostP: 850_00, rejected: 0, received: 24 }] })
  pos.push({ id: PLANT.heldBillPo, vendorId: VND.dhakaAutochem, orderAt: dhakaAt(isoAddDays(today, -4), "15:00"), grnId: PLANT.heldBillGrn, grnAt: dhakaAt(isoAddDays(today, -2), "11:00"), kind: "held-bill",
    lines: [
      { itemId: ITM.snowFoam, units: 4, unitCostP: 4_200_00, rejected: 0, received: 4 },
      { itemId: ITM.shampoo, units: 4, unitCostP: 3_600_00, rejected: 0, received: 4 },
      { itemId: ITM.interiorDetailer, units: 3, unitCostP: 4_500_00, rejected: 0, received: 3 },
    ] })
  for (const po of pos) schedule(po.grnAt!, () => receivePo(po))
  // This morning's transfer to Gulshan, dispatched at 09:15 and still in transit.
  schedule(dhakaAt(today, "09:15"), () => {
    const lines = new Map<Id, number>()
    const retail = RETAIL_ITEMS.filter((i) => !input.pinned.has(key(LOC.GUL, i.id))).slice(0, 2)
    for (const item of retail) lines.set(item.id, Math.min(12, Math.floor(get(key(LOC.CST, item.id)))))
    lines.set(ITM.microfiber, Math.min(20, Math.floor(get(key(LOC.CST, ITM.microfiber)))))
    for (const [id, n] of [...lines]) {
      if (n <= 0) lines.delete(id)
      else bump(key(LOC.CST, id), -n)
    }
    if (lines.size) transfers.push({ id: PLANT.inTransitTransfer, to: LOC.GUL, dispatchAt: dhakaAt(today, "09:15"), receiveAt: null, lines })
  })

  function receivePo(po: PlannedPo) {
    for (const l of po.lines) {
      const item = ITEM_BY_ID.get(l.itemId)!
      const accepted = l.received - l.rejected
      bump(key(LOC.CST, l.itemId), accepted * item.purchaseFactor)
      onOrder.set(l.itemId, Math.max(0, (onOrder.get(l.itemId) ?? 0) - l.units * item.purchaseFactor))
    }
  }

  function purchase(day: ISODate) {
    const byVendor = new Map<Id, PlannedPoLine[]>()
    for (const item of ITEMS) {
      if (item.id === ITM.cc2Kit || item.variant) continue
      const rule = rules.get(key(LOC.CST, item.id))!
      const network = (weeklyAt(LOC.GUL, item.id) + weeklyAt(LOC.UTT, item.id)) * 2
      const projected = get(key(LOC.CST, item.id)) + (onOrder.get(item.id) ?? 0) - network
      if (projected >= rule.min) continue
      const units = Math.ceil((rule.max - projected) / item.purchaseFactor)
      if (units <= 0) continue
      const vendorId = VENDOR_OF_ITEM.get(item.id)!
      const list = byVendor.get(vendorId) ?? []
      const unitCostP = Math.round((item.cost * 100 * (1 + rng.float(-0.02, 0.02))) / 100) * 100
      list.push({ itemId: item.id, units, unitCostP, rejected: 0, received: units })
      byVendor.set(vendorId, list)
    }
    const prId = byVendor.size ? w.ctx.seq("pr") : undefined
    for (const [vendorId, lines] of byVendor) {
      const orderAt = dhakaAt(day, "15:00")
      const grnDay = isoAddDays(day, rng.int(2, 5))
      const grnAt = dhakaAt(grnDay, "11:00")
      for (const l of lines) {
        if (l.units >= 3 && rng.bool(0.08)) l.rejected = Math.min(2, l.units - 1)
        onOrder.set(l.itemId, (onOrder.get(l.itemId) ?? 0) + l.units * ITEM_BY_ID.get(l.itemId)!.purchaseFactor)
      }
      const po: PlannedPo = { id: w.ctx.seq("po"), vendorId, prId, orderAt, grnAt: grnAt <= now ? grnAt : null, lines, kind: "weekly" }
      if (po.grnAt) {
        po.grnId = w.ctx.seq("grn")
        schedule(po.grnAt, () => receivePo(po))
      } else {
        for (const l of lines) l.received = 0
      }
      pos.push(po)
    }
  }

  function transfer(loc: Loc, day: ISODate) {
    const gap = nextTransferGap(loc, day)
    const lines = new Map<Id, number>()
    for (const item of STUDIO_ITEMS) {
      const k = key(loc, item.id)
      if (input.pinned.has(k)) continue
      const rule = rules.get(k)!
      const have = get(k)
      const consumed = item.kind !== "retail" && (JOB_MAX.get(item.id) ?? 0) > 0
      const expected = consumed ? (rule.min * (gap + 1)) / 7 : 0
      let send = 0
      if (item.kind === "retail") {
        if (have < 10) send = 24 - have
      } else if (consumed && have - expected < rule.min) {
        send = Math.ceil((rule.max - have) / item.purchaseFactor) * item.purchaseFactor
      }
      const boost = input.boosts.get(`${day}|${k}`) ?? 0
      send += boost
      const cst = get(key(LOC.CST, item.id))
      if (send > cst) send = item.kind === "retail" ? Math.floor(cst) : Math.floor(cst / item.purchaseFactor) * item.purchaseFactor
      if (send <= 0) continue
      lines.set(item.id, send)
    }
    if (!lines.size) return
    const dispatchAt = dhakaAt(day, "09:00")
    const t: PlannedTransfer = { id: w.ctx.seq("trf"), to: loc, dispatchAt, receiveAt: dhakaAt(day, RECEIVE_TIME[loc]), lines }
    if (!shortfallDone && loc === LOC.UTT) {
      const retail = [...lines].find(([id, n]) => ITEM_BY_ID.get(id)!.kind === "retail" && n >= 6)
      if (retail) {
        t.shortfall = { itemId: retail[0], qty: 2 }
        shortfallDone = true
      }
    }
    for (const [id, n] of lines) bump(key(LOC.CST, id), -n)
    schedule(t.receiveAt!, () => {
      for (const [id, n] of lines) bump(key(loc, id), n - (t.shortfall?.itemId === id ? t.shortfall.qty : 0))
    })
    transfers.push(t)
    lastTransfer.set(loc, t)
  }

  // Walk the demand in time order with the decision points interleaved.
  const demand = [...q.demand].sort((a, b) => a.at - b.at)
  let di = 0
  const runDyn = (until: Ms) => {
    while (dyn.length && dyn[0].at <= until) dyn.shift()!.run()
  }
  for (; di < demand.length; di++) {
    const d = demand[di]
    runDyn(d.at)
    const k = key(d.loc, d.itemId)
    if (get(k) + 1e-9 < d.qty) {
      // Urgent transfer from the Central Store, dispatched and received just before the job.
      if (input.pinned.has(k)) throw new Error(`seed: pinned ${k} short`)
      const item = ITEM_BY_ID.get(d.itemId)!
      const rule = rules.get(k)!
      let send = Math.ceil((Math.max(rule.max, d.qty) - get(k)) / item.purchaseFactor) * item.purchaseFactor
      if (item.kind === "retail") send = Math.max(d.qty - get(k), 24 - get(k))
      const cst = get(key(LOC.CST, d.itemId))
      if (send > cst) send = cst
      if (get(k) + send + 1e-9 < d.qty) throw new Error(`seed: no stock anywhere for ${d.itemId} on ${d.date}`)
      bump(key(LOC.CST, d.itemId), -send)
      bump(k, send)
      transfers.push({ id: w.ctx.seq("trf"), to: d.loc as Loc, dispatchAt: d.at - 50 * MINUTE, receiveAt: d.at - 10 * MINUTE, lines: new Map([[d.itemId, send]]), urgent: true })
    }
    bump(k, -d.qty)
  }
  runDyn(now)
  return { transfers, pos, finals: qty, lastTransfer }
}

/* ================================================================== *
 * Plan, then execute
 * ================================================================== */

export function seedStock(w: World, q: EventQueue, summary: SummaryOut): StockOut {
  const rng = w.rng("stock")
  const rules = reorderRules(w, q, summary)
  const windowDemand = new Map<string, number>()
  for (const d of q.demand) windowDemand.set(key(d.loc, d.itemId), (windowDemand.get(key(d.loc, d.itemId)) ?? 0) + d.qty)

  // Pinned below minimum at today: three retail goods per studio, and Uttara's ceramic 2-year at 20 ml.
  const pinned = new Set<string>()
  const openings = new Map<string, number>()
  for (const loc of STUDIOS) {
    const candidates = RETAIL_ITEMS.map((i) => ({ id: i.id, d: windowDemand.get(key(loc, i.id)) ?? 0 }))
      .filter((c) => c.d <= 18)
      .sort((a, b) => b.d - a.d || (a.id < b.id ? -1 : 1))
      .slice(0, 3)
    for (const c of candidates) {
      pinned.add(key(loc, c.id))
      openings.set(key(loc, c.id), rng.int(1, 4) + c.d)
    }
  }
  pinned.add(key(LOC.UTT, ITM.cc2Kit))
  openings.set(key(LOC.UTT, ITM.cc2Kit), CC2_UTT_TARGET + (windowDemand.get(key(LOC.UTT, ITM.cc2Kit)) ?? 0))

  for (const item of ITEMS) {
    for (const loc of STOCK_LOCS) {
      if (loc !== LOC.CST && item.variant) continue
      const k = key(loc, item.id)
      if (openings.has(k)) continue
      const rule = rules.get(k)!
      if (loc === LOC.CST) {
        const units = Math.ceil((rule.min + rng.float(0.15, 0.7) * (rule.max - rule.min)) / item.purchaseFactor)
        openings.set(k, item.id === ITM.cc2Kit ? 4000 : units * item.purchaseFactor)
      } else if (item.kind === "retail") {
        openings.set(k, rng.int(8, 22))
      } else {
        openings.set(k, roundBase(item, rule.min + rng.float(0.45, 0.95) * (rule.max - rule.min), false))
      }
    }
  }

  // Settle the plan: every issue covered, the planted end states exact, the rest at or above minimum.
  const boosts = new Map<string, number>()
  let plan = simulate(w, q, rules, { openings, pinned, boosts })
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    const cc2Final = plan.finals.get(key(LOC.CST, ITM.cc2Kit)) ?? 0
    if (Math.abs(cc2Final - CC2_CST_TARGET) > 1e-9) {
      openings.set(key(LOC.CST, ITM.cc2Kit), roundQty(openings.get(key(LOC.CST, ITM.cc2Kit))! + CC2_CST_TARGET - cc2Final))
      changed = true
    }
    for (const loc of STUDIOS) {
      const last = plan.lastTransfer.get(loc)
      if (!last) continue
      const day = dhakaDate(last.dispatchAt)
      for (const item of STUDIO_ITEMS) {
        const k = key(loc, item.id)
        if (pinned.has(k)) continue
        const floor = Math.max(rules.get(k)!.min, k === key(LOC.GUL, ITM.cc2Kit) ? 100 : 0, k === key(LOC.UTT, ITM.polish) ? 1500 : 0)
        const final = plan.finals.get(k) ?? 0
        if (final + 1e-9 >= floor) continue
        const units = item.kind === "retail" ? Math.ceil(floor - final + 4) : Math.ceil((floor - final) / item.purchaseFactor) * item.purchaseFactor + item.purchaseFactor
        boosts.set(`${day}|${k}`, (boosts.get(`${day}|${k}`) ?? 0) + units)
        changed = true
      }
    }
    if (!changed) break
    plan = simulate(w, q, rules, { openings, pinned, boosts })
  }

  writeReorderRules(w, rules)
  const openingValue = executeOpening(w, openings)
  scheduleExecution(w, q, plan)
  return { openingValue, rules, pos: plan.pos, transfers: plan.transfers }
}

function writeReorderRules(w: World, rules: Map<string, Rule>) {
  const at = w.at(w.cal.C, "08:00")
  for (const [k, r] of rules) {
    const [loc, itemId] = k.split("|")
    w.ctx.bag.put("reorderRules", `rr_${itemId.slice(4)}_${loc.slice(4)}`, at, { itemId, locationId: loc, minQty: r.min, maxQty: r.max, reorderQty: r.max - r.min }, USR.habib)
  }
}

/* ---------------- Opening at C: no journal; values at standard ± 4% ---------------- */

function batchNo(item: ItemDef, date: ISODate, n: number): string {
  return `${item.sku.split("-")[1]}-${date.slice(2, 4)}${date.slice(5, 7)}-${String.fromCharCode(65 + (n % 26))}`
}

function executeOpening(w: World, openings: Map<string, number>): Map<string, number> {
  const rng = w.rng("stock-opening")
  const { C, today } = w.cal
  const at = dhakaAt(C, "00:05")
  const ref = { docType: "opening", docId: "cutover", docNo: () => "Balance at itemised start" }
  const value = new Map<string, number>()
  const oldBatch = new Map<Id, Id>()
  const newBatch = new Map<Id, Id>()
  let n = 0
  for (const item of ITEMS) {
    if (item.kind !== "chemical") continue
    n += 1
    const life = item.shelfLifeDays ?? 730
    if (item.id === ITM.apc1l || item.id === ITM.glassCleaner1l) {
      // The two Central Store batches expiring within 60 days.
      const expiry = isoAddDays(today, item.id === ITM.apc1l ? 38 : 52)
      const received = isoAddDays(expiry, -life)
      oldBatch.set(item.id, w.stock.batch({ itemId: item.id, batchNo: batchNo(item, received, n), expiry, receivedAt: dhakaAt(received, "11:00") }).id)
      continue
    }
    const expOld = isoAddDays(today, rng.int(120, 300))
    const expNew = isoAddDays(expOld, rng.int(90, 200))
    oldBatch.set(item.id, w.stock.batch({ itemId: item.id, batchNo: batchNo(item, isoAddDays(expOld, -life), n), expiry: expOld, receivedAt: dhakaAt(isoAddDays(C, -rng.int(40, 90)), "11:00") }).id)
    newBatch.set(item.id, w.stock.batch({ itemId: item.id, batchNo: batchNo(item, isoAddDays(expNew, -life), n + 26), expiry: expNew, receivedAt: dhakaAt(isoAddDays(C, -rng.int(5, 30)), "11:00") }).id)
  }
  for (const [k, qty] of [...openings].sort()) {
    if (qty <= 0) continue
    const [loc, itemId] = k.split("|")
    const item = ITEM_BY_ID.get(itemId)!
    const total = Math.round(stdValueP(itemId, qty) * (1 + rng.float(-0.04, 0.04)))
    const tag = TAG_OF_KIND[item.kind]
    value.set(`${loc}|${tag}`, (value.get(`${loc}|${tag}`) ?? 0) + total)
    const parts: { batchId?: Id; qty: number }[] = []
    if (item.kind !== "chemical") parts.push({ qty })
    else if (loc !== LOC.CST || !newBatch.has(itemId)) parts.push({ batchId: oldBatch.get(itemId), qty })
    else {
      const units = Math.round(qty / item.purchaseFactor)
      const older = Math.max(1, Math.round(units * 0.35))
      if (units <= 1) parts.push({ batchId: oldBatch.get(itemId), qty })
      else {
        parts.push({ batchId: oldBatch.get(itemId), qty: older * item.purchaseFactor })
        parts.push({ batchId: newBatch.get(itemId), qty: roundQty(qty - older * item.purchaseFactor) })
      }
    }
    let used = 0
    parts.forEach((p, i) => {
      const v = i === parts.length - 1 ? total - used : Math.round((total * p.qty) / qty)
      used += v
      w.stock.receive({ itemId, locationId: loc, qtyBase: p.qty, valueP: v, type: "opening", ref, at, date: C, batchId: p.batchId })
    })
  }
  return value
}

/* ---------------- Goods received, transfers: documents and journals ---------------- */

function scheduleExecution(w: World, q: EventQueue, plan: PlanResult) {
  const { bag } = w.ctx
  const rng = w.rng("stock-docs")
  for (const po of plan.pos) {
    if (!po.grnAt || !po.grnId) continue
    q.add(po.grnAt, () => receiveGoods(w, po))
    for (const l of po.lines) {
      if (!l.rejected) continue
      const back = po.grnAt + rng.int(1, 2) * 24 * 60 * MINUTE
      if (back <= w.cal.now) q.add(back, () => returnRejected(w, po, l.itemId, back))
    }
  }
  for (const t of plan.transfers) {
    const id = t.id
    const row = bag.put("transfers", id, t.dispatchAt - 30 * MINUTE, {
      transferNo: "",
      fromLocationId: LOC.CST,
      toLocationId: t.to,
      status: t.receiveAt ? "received" : "dispatched",
      requestedBy: t.to === LOC.GUL ? USR.shahriar : USR.arif,
      requestedAt: t.dispatchAt - (t.urgent ? 20 : 18 * 60) * MINUTE,
      dispatchedBy: USR.habib,
      dispatchedAt: t.dispatchAt,
      receivedBy: t.receiveAt ? (t.to === LOC.GUL ? USR.shahriar : USR.arif) : undefined,
      receivedAt: t.receiveAt ?? undefined,
      vehicleNo: VAN,
      note: t.urgent ? "Urgent: stock for a booked job" : undefined,
    }, USR.habib)
    const date = dhakaDate(t.dispatchAt)
    w.number("TRF", { date }, t.dispatchAt, (no) => {
      row.transferNo = no
    })
    const docNo = () => row.transferNo
    const lineRows: { itemId: Id; batchId?: Id; qty: number; valueP: number; rowId: Id }[] = []
    q.add(t.dispatchAt, () => {
      const valued: { itemId: Id; tag: InventoryTag; valueP: number }[] = []
      const moveIds: Id[] = []
      for (const [itemId, qty] of t.lines) {
        const res = w.stock.issue({ itemId, locationId: LOC.CST, qtyBase: qty, type: "transfer-out", ref: { docType: "transfers", docId: id, docNo }, at: t.dispatchAt, date })
        valued.push({ itemId, tag: TAG_OF_KIND[ITEM_BY_ID.get(itemId)!.kind], valueP: res.valueP })
        for (const m of res.moves) {
          moveIds.push(m.moveId)
          const tl = bag.put("transferLines", w.ctx.seq("trfl"), t.dispatchAt, {
            transferId: id,
            itemId,
            batchId: m.batchId,
            qtyRequested: m.qtyBase,
            qtySent: m.qtyBase,
            qtyReceived: 0,
            unitCostP: m.qtyBase > 0 ? m.valueP / m.qtyBase : 0,
            valueP: m.valueP,
          }, USR.habib)
          lineRows.push({ itemId, batchId: m.batchId, qty: m.qtyBase, valueP: m.valueP, rowId: tl.id })
        }
      }
      const journal = w.ledger.post({
        rule: "R20",
        date,
        at: t.dispatchAt,
        lines: linesForTransferDispatch({ fromLocationId: LOC.CST, toLocationId: t.to, lines: valued }),
        narration: () => `Transfer dispatched, ${row.transferNo}`,
        source: { app: "st", docType: "transfers", docId: id, docNo },
        preparedBy: USR.habib,
      })
      row.dispatchJournalId = journal.id
      w.stock.linkJournal(moveIds, journal.id)
    })
    if (!t.receiveAt) continue
    const receiveAt = t.receiveAt
    q.add(receiveAt, () => {
      const rdate = dhakaDate(receiveAt)
      const byItem = new Map<Id, { itemId: Id; tag: InventoryTag; receivedValueP: number; shortfallValueP: number }>()
      const moveIds: Id[] = []
      for (const l of lineRows) {
        const tl = bag.get("transferLines", l.rowId)
        const short = t.shortfall?.itemId === l.itemId && l === lineRows.find((x) => x.itemId === l.itemId) ? Math.min(t.shortfall.qty, l.qty) : 0
        const received = roundQty(l.qty - short)
        const receivedValue = short ? Math.round((l.valueP * received) / l.qty) : l.valueP
        tl.qtyReceived = received
        if (short) tl.discrepancyNote = `${short} pieces short on arrival; the van crate was damaged`
        if (received > 0) {
          const res = w.stock.receive({ itemId: l.itemId, locationId: t.to, qtyBase: received, valueP: receivedValue, type: "transfer-in", ref: { docType: "transfers", docId: id, docNo }, at: receiveAt, date: rdate, batchId: l.batchId })
          moveIds.push(...res.moves.map((m) => m.moveId))
        }
        const agg = byItem.get(l.itemId) ?? { itemId: l.itemId, tag: TAG_OF_KIND[ITEM_BY_ID.get(l.itemId)!.kind], receivedValueP: 0, shortfallValueP: 0 }
        agg.receivedValueP += receivedValue
        agg.shortfallValueP += l.valueP - receivedValue
        byItem.set(l.itemId, agg)
      }
      const journal = w.ledger.post({
        rule: "R21",
        date: rdate,
        at: receiveAt,
        lines: linesForTransferReceipt({ toLocationId: t.to, lines: [...byItem.values()] }),
        narration: () => `Transfer received, ${row.transferNo}`,
        source: { app: "st", docType: "transfers", docId: id, docNo },
        preparedBy: t.to === LOC.GUL ? USR.shahriar : USR.arif,
      })
      row.receiveJournalId = journal.id
      row.updatedAt = receiveAt
      w.stock.linkJournal(moveIds, journal.id)
    })
  }
}

/** GRN at the Central Store: accepted lots received at PO cost (R12); rejected lots held in quarantine. */
function receiveGoods(w: World, po: PlannedPo) {
  const { bag } = w.ctx
  const rng = w.rng("grn")
  const at = po.grnAt!
  const date = dhakaDate(at)
  const grnId = po.grnId!
  const grn = bag.put("grns", grnId, at, {
    grnNo: "",
    poId: po.id,
    vendorId: po.vendorId,
    locationId: LOC.CST,
    vendorChallanNo: `CH-${rng.int(10000, 99999)}`,
    receivedBy: USR.habib,
    receivedAt: at,
    date,
  }, USR.habib)
  w.number("GRN", { location: LOC.CST, date }, at, (no) => {
    grn.grnNo = no
  })
  const docNo = () => grn.grnNo
  const valued: { itemId: Id; tag: InventoryTag; valueP: number }[] = []
  const moveIds: Id[] = []
  po.lines.forEach((l, i) => {
    if (!l.received) return
    const item = ITEM_BY_ID.get(l.itemId)!
    const accepted = l.received - l.rejected
    const lineId = w.ctx.seq("grnl")
    let batchId: Id | undefined
    if (item.kind === "chemical") {
      const expiry = isoAddDays(date, (item.shelfLifeDays ?? 730) - rng.int(30, 120))
      batchId = w.stock.batch({ itemId: l.itemId, batchNo: `L${date.slice(2, 4)}${date.slice(5, 7)}-${rng.int(100, 999)}`, expiry, receivedAt: at, grnLineId: lineId }).id
    }
    const valueP = Math.round(accepted * l.unitCostP)
    if (accepted > 0) {
      const res = w.stock.receive({ itemId: l.itemId, locationId: LOC.CST, qtyBase: accepted * item.purchaseFactor, valueP, type: "grn", ref: { docType: "grns", docId: grnId, docNo }, at, date, batchId })
      moveIds.push(...res.moves.map((m) => m.moveId))
      valued.push({ itemId: l.itemId, tag: TAG_OF_KIND[item.kind], valueP })
    }
    let rejectedBatch: Id | undefined
    if (l.rejected) {
      rejectedBatch = w.stock.batch({ itemId: l.itemId, batchNo: `QC-${date.slice(2, 4)}${date.slice(5, 7)}-${rng.int(100, 999)}`, expiry: item.kind === "chemical" ? isoAddDays(date, 45) : undefined, receivedAt: at, grnLineId: lineId, status: "quarantine" }).id
      w.stock.quarantine({ itemId: l.itemId, locationId: LOC.CST, qtyBase: l.rejected * item.purchaseFactor, batchId: rejectedBatch, ref: { docType: "grns", docId: grnId, docNo }, at, date })
    }
    bag.put("grnLines", lineId, at, {
      grnId,
      poLineId: poLineId(po.id, i),
      itemId: l.itemId,
      batchNo: batchId ? w.stock.batches.get(batchId)!.batchNo : undefined,
      expiry: batchId ? w.stock.batches.get(batchId)!.expiry : undefined,
      qtyReceived: l.received,
      qtyAccepted: accepted,
      qtyRejected: l.rejected,
      qtyReturned: 0,
      qtyBilled: 0,
      rejectReason: l.rejected ? (item.kind === "chemical" ? "short-expiry" : "damaged") : undefined,
      quarantine: l.rejected > 0,
      quarantineStatus: l.rejected ? "held" : undefined,
      batchId: batchId ?? rejectedBatch,
      unitCostP: l.unitCostP,
    }, USR.habib)
  })
  if (valued.length) {
    const journal = w.ledger.post({
      rule: "R12",
      date,
      at,
      lines: linesForGoodsAccepted({ partyId: po.vendorId, locationId: LOC.CST, lines: valued }),
      narration: () => `Goods received, ${grn.grnNo}`,
      source: { app: "grn", docType: "grns", docId: grnId, docNo },
      preparedBy: USR.habib,
    })
    grn.journalId = journal.id
    w.stock.linkJournal(moveIds, journal.id)
  }
}

/** A rejected lot goes back to the vendor: the held quantity clears, nothing posts. */
function returnRejected(w: World, po: PlannedPo, itemId: Id, at: Ms) {
  const { bag } = w.ctx
  const line = bag.all("grnLines").find((g) => g.grnId === po.grnId && g.itemId === itemId && g.quarantine)
  if (!line) return
  const grn = bag.get("grns", po.grnId!)
  const item = ITEM_BY_ID.get(itemId)!
  const batch = [...w.stock.batches.values()].find((b) => b.grnLineId === line.id && b.status === "quarantine")!
  w.stock.returnQuarantined({ itemId, locationId: LOC.CST, qtyBase: line.qtyRejected * item.purchaseFactor, batchId: batch.id, ref: { docType: "grns", docId: grn.id, docNo: () => grn.grnNo }, at, date: dhakaDate(at) })
  line.quarantineStatus = "returned"
  line.updatedAt = at
}

export const PO_VAT_PCT = 15
export function poLineVat(units: number, unitCostP: number): number {
  return percentOf(Math.round(units * unitCostP), PO_VAT_PCT)
}

/** PO line id (GRN and bill lines refer to it). */
export function poLineId(poId: Id, index: number): Id {
  return `pol_${poId.replace(/^po_/, "")}_${index + 1}`
}
