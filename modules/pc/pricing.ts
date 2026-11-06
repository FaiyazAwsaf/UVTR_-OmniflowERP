import type { TaxSettings } from "@/config/rules.config"
import type {
  AddOnRow,
  ISODate,
  Id,
  ItemRow,
  PackageRow,
  Poisha,
  PriceListLineRow,
  PriceListRow,
  PricedLine,
  PromotionRow,
  ServiceRecipeRow,
  ServiceRow,
  ServiceVariantRow,
  VehicleClass,
} from "@/core/db/schema"
import { scaleRecipeQty } from "@/core/stock/value"
import { percentOf, spreadAmount, spreadDiscount, vatRateOf } from "@/core/tax/vat"

/**
 * PC pricing (seed_data.md §3, plan §6.1), pure. Commands build a
 * `Catalogue` from the transaction (`loadCatalogue` in ./catalogue.ts) and
 * screens build the same snapshot from live queries, so a quotation priced
 * on screen is priced identically by the command that saves it.
 *
 * - A party's price list resolves to the list of the same code that is
 *   effective on the day (a published RETAIL revision takes over from its
 *   valid-from date).
 * - A service is priced from the list's line for its class variant, else the
 *   list's discount percent off the retail price, else the retail price.
 * - Packages explode into one line per component service; the package price
 *   (bundle percent off the sum, or the fixed price for the class) is spread
 *   pro rata to the components' prices, the last one taking the remainder.
 * - A discount percent is spread over every line's gross to the poisha; a
 *   promotion adds its own discount to the lines of its categories.
 * - VAT per line on the net, rounded half up (core/tax/vat.ts).
 */

export type Catalogue = {
  services: Map<Id, ServiceRow>
  /** `${serviceId}:${class}` */
  variants: Map<string, ServiceVariantRow>
  recipes: ServiceRecipeRow[]
  packages: Map<Id, PackageRow>
  addOns: Map<Id, AddOnRow>
  items: Map<Id, ItemRow>
  priceLists: PriceListRow[]
  /** `${priceListId}:${targetId}:${class or ""}` */
  listLines: Map<string, PriceListLineRow>
  promotions: Map<Id, PromotionRow>
  tax: TaxSettings
}

export type CatalogueRows = {
  services: ServiceRow[]
  variants: ServiceVariantRow[]
  recipes: ServiceRecipeRow[]
  packages: PackageRow[]
  addOns: AddOnRow[]
  items: ItemRow[]
  priceLists: PriceListRow[]
  listLines: PriceListLineRow[]
  promotions: PromotionRow[]
  tax: TaxSettings
}

export const variantKey = (serviceId: Id, cls: VehicleClass) => `${serviceId}:${cls}`
const lineKey = (priceListId: Id, targetId: Id, cls?: VehicleClass) => `${priceListId}:${targetId}:${cls ?? ""}`

export function buildCatalogue(rows: CatalogueRows): Catalogue {
  return {
    services: new Map(rows.services.map((s) => [s.id, s])),
    variants: new Map(rows.variants.map((v) => [variantKey(v.serviceId, v.vehicleClass), v])),
    recipes: rows.recipes,
    packages: new Map(rows.packages.map((p) => [p.id, p])),
    addOns: new Map(rows.addOns.map((a) => [a.id, a])),
    items: new Map(rows.items.map((i) => [i.id, i])),
    priceLists: rows.priceLists,
    listLines: new Map(rows.listLines.map((l) => [lineKey(l.priceListId, l.targetId, l.vehicleClass), l])),
    promotions: new Map(rows.promotions.map((p) => [p.id, p])),
    tax: rows.tax,
  }
}

/* ================================================================== *
 * Price lists
 * ================================================================== */

/** Whether a published list is in force on a day. */
export function listInForce(list: PriceListRow, date: ISODate): boolean {
  if (list.status === "draft") return false
  return list.validFrom <= date && (!list.validTo || list.validTo >= date)
}

/** Display status of a list on a day: draft, published (in force or scheduled), archived. */
export function listStatusOn(list: PriceListRow, date: ISODate): "draft" | "published" | "scheduled" | "archived" {
  if (list.status === "draft") return "draft"
  if (list.validTo && list.validTo < date) return "archived"
  if (list.status === "archived" && (!list.validTo || list.validTo < date)) return "archived"
  if (list.validFrom > date) return "scheduled"
  return "published"
}

/**
 * The list a party is priced on for a day: the published list with the same
 * code in force that day (the latest valid-from wins), else the party's own
 * list, else the retail list.
 */
export function effectiveList(cat: Catalogue, priceListId: Id | undefined, date: ISODate): PriceListRow | undefined {
  const own = cat.priceLists.find((l) => l.id === priceListId)
  const code = own?.code ?? "RETAIL"
  const inForce = cat.priceLists
    .filter((l) => l.code === code && listInForce(l, date))
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0))
  return inForce[0] ?? own ?? cat.priceLists.find((l) => l.code === "RETAIL" && l.status !== "draft")
}

/** The retail list price of a service for a class (the variant's base price). */
export function listPrice(cat: Catalogue, serviceId: Id, cls: VehicleClass): Poisha {
  return cat.variants.get(variantKey(serviceId, cls))?.basePriceP ?? 0
}

/** A service's price for a class on a list. */
export function servicePrice(cat: Catalogue, list: PriceListRow | undefined, serviceId: Id, cls: VehicleClass): Poisha {
  const variant = cat.variants.get(variantKey(serviceId, cls))
  const base = variant?.basePriceP ?? 0
  if (!list) return base
  if (variant) {
    const line = cat.listLines.get(lineKey(list.id, variant.id, cls)) ?? cat.listLines.get(lineKey(list.id, variant.id))
    if (line) return line.priceP
  }
  if (list.basis === "discount-pct" && list.discountPct) return base - percentOf(base, list.discountPct)
  return base
}

/** A package's price for a class on a list, and its spread over the components. */
export function packagePrice(
  cat: Catalogue,
  list: PriceListRow | undefined,
  packageId: Id,
  cls: VehicleClass
): { totalP: Poisha; parts: { serviceId: Id; priceP: Poisha; listP: Poisha }[] } {
  const pkg = cat.packages.get(packageId)
  if (!pkg) return { totalP: 0, parts: [] }
  const weights = pkg.serviceIds.map((id) => servicePrice(cat, list, id, cls))
  const sum = weights.reduce((s, w) => s + w, 0)
  const fixedLine = list ? cat.listLines.get(lineKey(list.id, pkg.id, cls)) : undefined
  let totalP: Poisha
  if (fixedLine) totalP = fixedLine.priceP
  else if (pkg.pricing.kind === "fixed") totalP = pkg.pricing.prices[cls] ?? sum
  else totalP = sum - percentOf(sum, pkg.pricing.pct)
  const spread = spreadAmount(weights, totalP)
  return { totalP, parts: pkg.serviceIds.map((serviceId, i) => ({ serviceId, priceP: spread[i], listP: weights[i] })) }
}

/** A retail item's price (per sales unit) on a list, else its retail price. */
export function itemPrice(cat: Catalogue, list: PriceListRow | undefined, itemId: Id): Poisha {
  const item = cat.items.get(itemId)
  if (list) {
    const line = cat.listLines.get(lineKey(list.id, itemId))
    if (line) return line.priceP
  }
  const retail = cat.priceLists.find((l) => l.code === "RETAIL" && l.status === "published")
  const retailLine = retail ? cat.listLines.get(lineKey(retail.id, itemId)) : undefined
  return retailLine?.priceP ?? item?.retailPriceP ?? 0
}

/** Duration of a service for a class (minutes). */
export function serviceDuration(cat: Catalogue, serviceId: Id, cls: VehicleClass): number {
  return cat.variants.get(variantKey(serviceId, cls))?.durationMin ?? 60
}

/* ================================================================== *
 * Recipes
 * ================================================================== */

export type RecipeLine = { itemId: Id; sedanQty: number; qtyBase: number; classSpecific: boolean }

/**
 * A service's recipe for a class: class-specific rows when the service has
 * any for that class, else the sedan rows ("*") scaled by the class factors
 * (whole ml or g, 0.05 pc or roll, half up).
 */
export function recipeFor(cat: Pick<Catalogue, "recipes" | "items">, serviceId: Id, cls: VehicleClass): RecipeLine[] {
  const rows = cat.recipes.filter((r) => r.serviceId === serviceId)
  const own = rows.filter((r) => r.vehicleClass === cls)
  if (own.length) return own.map((r) => ({ itemId: r.itemId, sedanQty: r.qtyBase, qtyBase: r.qtyBase, classSpecific: true }))
  return rows
    .filter((r) => r.vehicleClass === "*")
    .map((r) => {
      const uom = cat.items.get(r.itemId)?.baseUom ?? "ml"
      return { itemId: r.itemId, sedanQty: r.qtyBase, qtyBase: scaleRecipeQty(r.qtyBase, cls, uom), classSpecific: false }
    })
}

/* ================================================================== *
 * Pricing a quotation or order
 * ================================================================== */

export type LineRequest =
  | { kind: "service"; serviceId: Id }
  | { kind: "package"; packageId: Id }
  | { kind: "add-on"; addOnId: Id; qty?: number }
  | { kind: "item"; itemId: Id; qty: number }

export type PricedDraft = PricedLine & {
  durationMin: number
  grossP: Poisha
  totalP: Poisha
}

export type PricingInput = {
  priceListId?: Id
  date: ISODate
  vehicleClass?: VehicleClass | null
  requests: LineRequest[]
  discountPct: number
  promotionId?: Id | null
}

export type PricingResult = {
  list: PriceListRow | undefined
  lines: PricedDraft[]
  subtotalP: Poisha
  discountP: Poisha
  vatP: Poisha
  totalP: Poisha
  promotionP: Poisha
  durationMin: number
  /** Why a request could not be priced (no class for a service, unknown id) */
  problems: string[]
}

/** Whether a promotion applies on a day to an order of this gross. */
export function promotionApplies(promo: PromotionRow | undefined, date: ISODate, grossP: Poisha): promo is PromotionRow {
  return !!promo && promo.active && promo.validFrom <= date && promo.validTo >= date && grossP >= promo.minOrderP
}

/** Price the requested lines for a vehicle class on the party's list (see the module comment). */
export function priceRequests(cat: Catalogue, input: PricingInput): PricingResult {
  const list = effectiveList(cat, input.priceListId, input.date)
  const cls = input.vehicleClass ?? null
  const problems: string[] = []
  const lines: PricedDraft[] = []
  const vatOf = (category: ServiceRow["vatCategory"]) => vatRateOf(category, cat.tax)

  const serviceLine = (serviceId: Id, priceP: Poisha, packageId?: Id): PricedDraft | null => {
    const sv = cat.services.get(serviceId)
    if (!sv || !cls) {
      problems.push(!cls ? "NO_CLASS" : `UNKNOWN_SERVICE:${serviceId}`)
      return null
    }
    return {
      kind: "service",
      refId: sv.id,
      packageId,
      vehicleClass: cls,
      descriptionEn: `${sv.nameEn} (${cls})`,
      descriptionBn: `${sv.nameBn} (${cls})`,
      qty: 1,
      unitPriceP: priceP,
      grossP: priceP,
      discountP: 0,
      vatRatePct: vatOf(sv.vatCategory),
      vatP: 0,
      netP: priceP,
      totalP: priceP,
      revenueTag: sv.revenueTag,
      durationMin: serviceDuration(cat, sv.id, cls),
    }
  }

  for (const req of input.requests) {
    if (req.kind === "service") {
      const line = cls ? serviceLine(req.serviceId, servicePrice(cat, list, req.serviceId, cls)) : serviceLine(req.serviceId, 0)
      if (line) lines.push(line)
    } else if (req.kind === "package") {
      if (!cls) {
        problems.push("NO_CLASS")
        continue
      }
      const pkg = packagePrice(cat, list, req.packageId, cls)
      if (!pkg.parts.length) problems.push(`UNKNOWN_PACKAGE:${req.packageId}`)
      for (const part of pkg.parts) {
        const line = serviceLine(part.serviceId, part.priceP, req.packageId)
        if (line) lines.push(line)
      }
    } else if (req.kind === "add-on") {
      const addOn = cat.addOns.get(req.addOnId)
      if (!addOn) {
        problems.push(`UNKNOWN_ADDON:${req.addOnId}`)
        continue
      }
      const qty = req.qty ?? 1
      const gross = Math.round(qty * addOn.priceP)
      lines.push({
        kind: "add-on",
        refId: addOn.id,
        vehicleClass: cls ?? undefined,
        descriptionEn: addOn.nameEn,
        descriptionBn: addOn.nameBn,
        qty,
        unitPriceP: addOn.priceP,
        grossP: gross,
        discountP: 0,
        vatRatePct: vatOf("standard"),
        vatP: 0,
        netP: gross,
        totalP: gross,
        revenueTag: addOn.revenueTag,
        durationMin: addOn.durationMin * qty,
      })
    } else {
      const item = cat.items.get(req.itemId)
      if (!item) {
        problems.push(`UNKNOWN_ITEM:${req.itemId}`)
        continue
      }
      const unit = itemPrice(cat, list, item.id)
      const gross = Math.round(req.qty * unit)
      lines.push({
        kind: "item",
        refId: item.id,
        descriptionEn: item.nameEn,
        descriptionBn: item.nameBn,
        qty: req.qty,
        unitPriceP: unit,
        grossP: gross,
        discountP: 0,
        vatRatePct: vatOf(item.vatCategory),
        vatP: 0,
        netP: gross,
        totalP: gross,
        revenueTag: "REV_PRODUCTS",
        durationMin: 0,
      })
    }
  }

  // Discount percent over every line's gross, then the promotion on its categories.
  const discounts = input.discountPct > 0 ? spreadDiscount(lines.map((l) => l.grossP), input.discountPct) : lines.map(() => 0)
  const gross = lines.reduce((s, l) => s + l.grossP, 0)
  const promo = input.promotionId ? cat.promotions.get(input.promotionId) : undefined
  let promotionP = 0
  const promoParts = lines.map(() => 0)
  if (promotionApplies(promo, input.date, gross)) {
    const applicable = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.kind === "service" && promo.appliesTo.includes(cat.services.get(l.refId)!.category))
    const base = applicable.reduce((s, { l, i }) => s + l.grossP - discounts[i], 0)
    const amount = promo.kind === "pct" ? percentOf(base, promo.value) : Math.min(promo.value, base)
    const parts = spreadAmount(
      applicable.map(({ l, i }) => l.grossP - discounts[i]),
      amount
    )
    applicable.forEach(({ i }, k) => {
      promoParts[i] = parts[k]
    })
    promotionP = amount
  }
  lines.forEach((l, i) => {
    l.discountP = Math.min(l.grossP, discounts[i] + promoParts[i])
    l.netP = l.grossP - l.discountP
    l.vatP = percentOf(l.netP, l.vatRatePct)
    l.totalP = l.netP + l.vatP
  })

  const subtotalP = lines.reduce((s, l) => s + l.grossP, 0)
  const discountP = lines.reduce((s, l) => s + l.discountP, 0)
  const vatP = lines.reduce((s, l) => s + l.vatP, 0)
  return {
    list,
    lines,
    subtotalP,
    discountP,
    vatP,
    totalP: subtotalP - discountP + vatP,
    promotionP,
    durationMin: lines.reduce((s, l) => s + l.durationMin, 0),
    problems,
  }
}

/** Totals of priced lines (orders and invoices): gross, discount, VAT, total. */
export function totalsOf(lines: Pick<PricedLine, "qty" | "unitPriceP" | "discountP" | "vatP">[]): {
  subtotalP: Poisha
  discountP: Poisha
  vatP: Poisha
  totalP: Poisha
} {
  const subtotalP = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPriceP), 0)
  const discountP = lines.reduce((s, l) => s + l.discountP, 0)
  const vatP = lines.reduce((s, l) => s + l.vatP, 0)
  return { subtotalP, discountP, vatP, totalP: subtotalP - discountP + vatP }
}
