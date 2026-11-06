import type { ISODate, InventoryTag, RevenueTag } from "@/core/db/schema"
import { linesForDailySummary } from "@/core/ledger/rules"
import { percentOf } from "@/core/tax/vat"

import { ITEM_BY_ID, RETAIL_WEIGHTS, TAG_OF_KIND } from "../content/catalogue"
import { LOC } from "../content/seed-refs"
import type { World } from "../engine/world"
import { isoAddDays, isoWeekday } from "../time"
import type { CreditPlan } from "./credit-plan"
import { drawClass, drawRetailPick, priceJob, recipeFor, stdValueP } from "./jobs"
import type { Studio } from "./scheduler"
import { STUDIO_BASE, WEEKDAY_FACTOR, growthFactor } from "./volumes"

/**
 * F to C − 1 (seed_data.md §7.1): one `SM` voucher per studio per day (R2)
 * for the retail jobs (credit customers are itemised separately), with the
 * consumption of all the day's jobs at the studio and the retail goods sold,
 * both at standard cost. Records the consumption per month for the summary
 * transfers and purchases (R2b, R2c) and the recent quantities for the
 * reorder rules.
 */

export type SummaryOut = {
  /** Standard value consumed, by `${loc}|${tag}|${YYYY-MM}` (job consumption and retail COGS) */
  used: Map<string, number>
  /** Network quantity used or sold, by `${YYYY-MM}|${itemId}` */
  networkQty: Map<string, number>
  /** Quantity per `${loc}|${itemId}` over the 8 weeks before today (reorder rules) */
  recentQty: Map<string, number>
}

const STUDIO_NAME = { GUL: "Gulshan Studio", UTT: "Uttara Studio" } as const
const TILL_TAG = { GUL: "CASH_TILL_GUL", UTT: "CASH_TILL_UTT" } as const

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

export function seedSummary(w: World, credit: CreditPlan): SummaryOut {
  const rng = w.rng("summary")
  const { F, C, today, volume } = w.cal
  const out: SummaryOut = { used: new Map(), networkQty: new Map(), recentQty: new Map() }
  const recentFrom = isoAddDays(today, -56)
  const creditByDay = new Map<string, typeof credit.jobs>()
  for (const j of credit.jobs) {
    if (j.date >= C) continue
    const k = `${j.date}|${j.studio}`
    const list = creditByDay.get(k) ?? []
    list.push(j)
    creditByDay.set(k, list)
  }

  for (let day: ISODate = F; day < C; day = isoAddDays(day, 1)) {
    const month = day.slice(0, 7)
    for (const studio of ["GUL", "UTT"] as Studio[]) {
      const loc = LOC[studio]
      const n = Math.max(1, Math.round(STUDIO_BASE[studio] * WEEKDAY_FACTOR[isoWeekday(day)] * rng.around(1, 0.06, 0.88, 1.12) * growthFactor(w, day) * volume))
      const revenue = new Map<RevenueTag, number>()
      let discount = 0
      let vat = 0
      let collected = 0
      const qty = new Map<string, number>()
      const use = (itemId: string, q: number) => qty.set(itemId, (qty.get(itemId) ?? 0) + q)

      for (let i = 0; i < n; i++) {
        const cls = drawClass(rng)
        const pick = drawRetailPick(rng, { allowLong: true })
        const roll = rng.next()
        const pct = roll < 0.03 ? 10 : roll < 0.18 ? 5 : 0
        for (const l of priceJob(pick, cls, "pl_retail", pct)) {
          revenue.set(l.revenueTag, (revenue.get(l.revenueTag) ?? 0) + l.grossP)
          discount += l.discountP
          vat += l.vatP
          collected += l.netP + l.vatP
          if (l.serviceId) for (const r of recipeFor(l.serviceId, cls)) use(r.itemId, r.qty)
        }
      }
      // Credit customers' jobs that day: consumption only (their revenue is invoiced).
      for (const j of creditByDay.get(`${day}|${studio}`) ?? []) {
        for (const l of j.lines) if (l.serviceId) for (const r of recipeFor(l.serviceId, j.vehicle.cls)) use(r.itemId, r.qty)
      }
      // Retail goods, about ৳2,500 a day.
      const target = rng.around(2_500_00, 700_00, 900_00, 4_500_00) * volume * growthFactor(w, day)
      let goods = 0
      const sold = new Map<string, number>()
      while (goods < target) {
        const itemId = rng.weighted(RETAIL_WEIGHTS)
        const q = rng.bool(0.15) ? 2 : 1
        sold.set(itemId, (sold.get(itemId) ?? 0) + q)
        goods += ITEM_BY_ID.get(itemId)!.retail! * 100 * q
      }
      let cogs = 0
      for (const [itemId, q] of sold) {
        const net = ITEM_BY_ID.get(itemId)!.retail! * 100 * q
        revenue.set("REV_PRODUCTS", (revenue.get("REV_PRODUCTS") ?? 0) + net)
        const lineVat = percentOf(net, 15)
        vat += lineVat
        collected += net + lineVat
        const value = stdValueP(itemId, q)
        cogs += value
        add(out.used, `${loc}|INV_RETAIL|${month}`, value)
        add(out.networkQty, `${month}|${itemId}`, q)
        if (day >= recentFrom) add(out.recentQty, `${loc}|${itemId}`, q)
      }
      const consumption = new Map<InventoryTag, number>()
      for (const [itemId, q] of qty) {
        const value = stdValueP(itemId, q)
        const tag = TAG_OF_KIND[ITEM_BY_ID.get(itemId)!.kind]
        consumption.set(tag, (consumption.get(tag) ?? 0) + value)
        add(out.used, `${loc}|${tag}|${month}`, value)
        add(out.networkQty, `${month}|${itemId}`, q)
        if (day >= recentFrom) add(out.recentQty, `${loc}|${itemId}`, q)
      }

      // Collections: cash 34%, card 28%, bKash 30%, Nagad 8% (with a little noise).
      const card = Math.round(collected * rng.around(0.28, 0.03, 0.22, 0.34))
      const bkash = Math.round(collected * rng.around(0.3, 0.03, 0.24, 0.36))
      const nagad = Math.round(collected * rng.around(0.08, 0.015, 0.05, 0.11))
      const cash = collected - card - bkash - nagad
      w.ledger.post({
        rule: "R2",
        date: day,
        at: w.at(day, "21:30"),
        lines: linesForDailySummary({
          locationId: loc,
          collections: [
            { tag: TILL_TAG[studio], amountP: cash },
            { tag: "CARD_CLEARING", amountP: card },
            { tag: "MFS_BKASH", amountP: bkash },
            { tag: "MFS_NAGAD", amountP: nagad },
          ],
          discountP: discount,
          revenue: [...revenue].map(([tag, grossP]) => ({ tag, grossP })),
          vatP: vat,
          consumption: [...consumption].map(([tag, valueP]) => ({ tag, valueP })),
          cogsP: cogs,
        }),
        narration: `Daily sales summary (history), ${STUDIO_NAME[studio]}`,
      })
    }
  }
  return out
}
