import type { RevenueTag, VehicleClass } from "@/core/db/schema"
import { scaleRecipeQty, standardValue } from "@/core/stock/value"
import { percentOf, spreadAmount, spreadDiscount } from "@/core/tax/vat"
import type { Rng } from "@/lib/mock/rng"

import {
  ADDON_BY_ID,
  CLASS_SHARES,
  durationMin,
  ITEM_BY_ID,
  listPriceP,
  LONG_SERVICES,
  PACKAGE_BY_ID,
  RECIPES,
  SERVICE_BY_ID,
  SERVICE_WEIGHTS,
} from "../content/catalogue"
import { ADDON, PKG, PL } from "../content/seed-refs"
import { servicePriceP } from "./catalogue"

/**
 * Jobs: what a vehicle gets done (services, packages, add-ons) and its
 * price per line (seed_data.md §3, §7.1): gross = unit price, a discount
 * percent spread over the lines to the poisha, VAT 15% per line on the net,
 * rounded half up. Packages explode into one line per component service,
 * the package price spread pro rata to the components' list prices.
 */

export const VAT_PCT = 15

export type JobLine = {
  kind: "service" | "add-on"
  serviceId?: string
  addOnId?: string
  packageId?: string
  /** Service or add-on id */
  refId: string
  cls: VehicleClass
  descriptionEn: string
  descriptionBn: string
  unitPriceP: number
  grossP: number
  discountP: number
  netP: number
  vatP: number
  revenueTag: RevenueTag
  durationMin: number
}

export type JobPick = { serviceIds: string[]; packageId?: string; addOnIds: string[] }

export function drawClass(rng: Rng): VehicleClass {
  return rng.weighted(CLASS_SHARES)
}

/** 1 (70%), 2 (25%) or 3 (5%) distinct services, weighted; long jobs optional. */
export function drawRetailPick(rng: Rng, opts: { allowLong: boolean; allowPackages?: boolean }): JobPick {
  const roll = rng.next()
  if (opts.allowPackages !== false && roll < 0.012) return { serviceIds: [], packageId: PKG.FRESH, addOnIds: [] }
  if (opts.allowPackages !== false && opts.allowLong && roll < 0.022) return { serviceIds: [], packageId: PKG.SHOW, addOnIds: [] }
  const count = rng.weighted<number>([[1, 70], [2, 25], [3, 5]])
  const weights = SERVICE_WEIGHTS.filter(([id]) => opts.allowLong || !LONG_SERVICES.has(id))
  const picked: string[] = []
  while (picked.length < count) {
    const id = rng.weighted(weights.filter(([s]) => !picked.includes(s)))
    picked.push(id)
  }
  const addOnIds: string[] = []
  const cats = new Set(picked.map((id) => SERVICE_BY_ID.get(id)!.category))
  if (cats.has("interior") && rng.bool(0.08)) addOnIds.push(ADDON.PET)
  if (cats.has("wash") && rng.bool(0.04)) addOnIds.push(ADDON.MUD)
  if (cats.has("wash") && !picked.includes("svc_eng_bay") && rng.bool(0.03)) addOnIds.push(ADDON.ENG)
  if (rng.bool(0.01)) addOnIds.push(ADDON.PICKUP)
  return { serviceIds: sortServices(picked), addOnIds }
}

/** Washes first, coatings last: the order the work is done in. */
const ORDER: Record<string, number> = { wash: 0, wheel: 1, engine: 2, paint: 3, glass: 4, interior: 5, restoration: 6, protection: 7 }
export function sortServices(ids: string[]): string[] {
  return [...ids].sort((a, b) => ORDER[SERVICE_BY_ID.get(a)!.category] - ORDER[SERVICE_BY_ID.get(b)!.category])
}

/** Price a pick for a class on a price list, with a discount percent over every line. */
export function priceJob(pick: JobPick, cls: VehicleClass, priceListId: string, discountPct = 0): JobLine[] {
  const lines: JobLine[] = []
  if (pick.packageId) {
    const pkg = PACKAGE_BY_ID.get(pick.packageId)!
    const lists = pkg.serviceIds.map((id) => listPriceP(id, cls))
    const sum = lists.reduce((s, p) => s + p, 0)
    const price = pkg.pricing.kind === "fixed" ? pkg.pricing.prices[cls] : sum - percentOf(sum, pkg.pricing.pct)
    const parts = spreadAmount(lists, price)
    pkg.serviceIds.forEach((id, i) => lines.push(serviceLine(id, cls, parts[i], pick.packageId)))
  }
  for (const id of pick.serviceIds) lines.push(serviceLine(id, cls, servicePriceP(priceListId, id, cls)))
  for (const id of pick.addOnIds) {
    const a = ADDON_BY_ID.get(id)!
    lines.push({
      kind: "add-on",
      addOnId: id,
      refId: id,
      cls,
      descriptionEn: a.nameEn,
      descriptionBn: a.nameBn,
      unitPriceP: a.priceP,
      grossP: a.priceP,
      discountP: 0,
      netP: a.priceP,
      vatP: 0,
      revenueTag: a.revenueTag,
      durationMin: a.durationMin,
    })
  }
  const discounts = discountPct > 0 ? spreadDiscount(lines.map((l) => l.grossP), discountPct) : lines.map(() => 0)
  lines.forEach((l, i) => {
    l.discountP = discounts[i]
    l.netP = l.grossP - l.discountP
    l.vatP = percentOf(l.netP, VAT_PCT)
  })
  return lines
}

function serviceLine(serviceId: string, cls: VehicleClass, priceP: number, packageId?: string): JobLine {
  const sv = SERVICE_BY_ID.get(serviceId)!
  return {
    kind: "service",
    serviceId,
    packageId,
    refId: serviceId,
    cls,
    descriptionEn: `${sv.nameEn} (${cls})`,
    descriptionBn: `${sv.nameBn} (${cls})`,
    unitPriceP: priceP,
    grossP: priceP,
    discountP: 0,
    netP: priceP,
    vatP: 0,
    revenueTag: sv.revenueTag,
    durationMin: durationMin(serviceId, cls),
  }
}

export const lineTotal = (l: Pick<JobLine, "netP" | "vatP">) => l.netP + l.vatP
export const jobTotal = (lines: Pick<JobLine, "netP" | "vatP">[]) => lines.reduce((s, l) => s + l.netP + l.vatP, 0)

/** Recipe quantities of a service for a class (base units, scaled and rounded). */
export function recipeFor(serviceId: string, cls: VehicleClass): { itemId: string; qty: number }[] {
  return (RECIPES[serviceId] ?? []).map(([itemId, qty]) => ({
    itemId,
    qty: scaleRecipeQty(qty, cls, ITEM_BY_ID.get(itemId)!.baseUom),
  }))
}

/** Pick from a credit customer's menu (a service id or "PKG-NEW"). */
export function drawCreditPick(rng: Rng, menu: [string, number][]): JobPick {
  const choice = rng.weighted(menu)
  if (choice === "PKG-NEW") return { serviceIds: [], packageId: PKG.NEW, addOnIds: [] }
  return { serviceIds: [choice], addOnIds: [] }
}

/** The retail price list applies to retail customers; the party's list otherwise. */
export function priceListOf(partyPriceListId?: string): string {
  return partyPriceListId ?? PL.retail
}

/** Standard cost of base units of an item (standard cost is per purchase unit). */
export function stdValueP(itemId: string, qtyBase: number): number {
  const item = ITEM_BY_ID.get(itemId)!
  return standardValue({ standardCostP: item.cost * 100, purchaseFactor: item.purchaseFactor }, qtyBase)
}
