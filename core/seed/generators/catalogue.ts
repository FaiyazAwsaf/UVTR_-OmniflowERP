import type { VehicleClass } from "@/core/db/schema"
import { percentOf } from "@/core/tax/vat"

import {
  ADD_ONS,
  CATEGORY_OF_KIND,
  CLASSES,
  durationMin,
  ITEMS,
  listPriceP,
  PACKAGES,
  RECIPES,
  SERVICES,
  UOMS,
} from "../content/catalogue"
import { CAT, PKG, PL, PROMO, SVC, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { addMonthsISO, isoAddDays, lastOfMonth } from "../time"

/**
 * PC and PM catalogue (seed_data.md §3, §4): units, categories, items with
 * barcodes, services and their class variants, recipes, packages, add-ons,
 * price lists (RETAIL, FLEET, DEALER and the draft RETAIL revision) and
 * promotions. Reorder rules come later, from the consumption history.
 */

export const variantId = (serviceId: string, cls: VehicleClass) => `svv_${serviceId.slice(4)}_${cls.toLowerCase()}`

/** EAN-13 style barcode with a valid check digit (generated, not real). */
export function ean13(n: number): string {
  const body = `894${String(1_000_000_00 + n * 7_919).slice(-9)}`
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3)
  return body + String((10 - (sum % 10)) % 10)
}

/** Price of a service for a class on a price list (poisha, VAT exclusive). */
export function servicePriceP(priceListId: string, serviceId: string, cls: VehicleClass): number {
  const retail = listPriceP(serviceId, cls)
  if (priceListId === PL.fleet) return retail - percentOf(retail, 12)
  if (priceListId === PL.dealer && serviceId === SVC.WSH_PRM) return 1000_00
  return retail
}

export function seedCatalogue(w: World): void {
  const { bag } = w.ctx
  const at = w.at(w.cal.F, "08:00")

  for (const u of UOMS) bag.put("uoms", u.code, at, { code: u.code, nameEn: u.nameEn, nameBn: u.nameBn, dimension: u.dimension })

  bag.put("itemCategories", CAT.CHEM, at, { code: "CHEM", nameEn: "Detailing chemicals", nameBn: "ডিটেইলিং রাসায়নিক", inventoryTag: "INV_CHEMICAL", costTag: "CONSUMABLES_USED" })
  bag.put("itemCategories", CAT.CONS, at, { code: "CONS", nameEn: "Consumables", nameBn: "ভোগ্যপণ্য", inventoryTag: "INV_CONSUMABLE", costTag: "CONSUMABLES_USED" })
  bag.put("itemCategories", CAT.RETAIL, at, { code: "RETAIL", nameEn: "Retail goods", nameBn: "খুচরা পণ্য", inventoryTag: "INV_RETAIL", costTag: "COGS" })

  ITEMS.forEach((item, i) => {
    bag.put("items", item.id, at, {
      sku: item.sku,
      nameEn: item.nameEn,
      nameBn: item.nameBn,
      categoryId: CATEGORY_OF_KIND[item.kind],
      kind: item.kind,
      brand: item.brand,
      baseUom: item.baseUom,
      purchaseUom: item.purchaseUom,
      purchaseFactor: item.purchaseFactor,
      salesUom: item.kind === "retail" ? "pc" : undefined,
      salesFactor: item.kind === "retail" ? 1 : undefined,
      trackBatch: item.kind === "chemical",
      shelfLifeDays: item.kind === "chemical" ? item.shelfLifeDays : undefined,
      standardCostP: item.cost * 100,
      retailPriceP: item.retail !== undefined ? item.retail * 100 : undefined,
      vatCategory: "standard",
      barcode: ean13(i + 1),
      status: "active",
      imageSeed: item.sku,
    })
  })

  SERVICES.forEach((sv, i) => {
    bag.put("services", sv.id, at, {
      code: sv.code,
      nameEn: sv.nameEn,
      nameBn: sv.nameBn,
      category: sv.category,
      descriptionEn: sv.descriptionEn,
      descriptionBn: sv.descriptionBn,
      warrantyMonths: sv.warrantyMonths,
      vatCategory: "standard",
      revenueTag: sv.revenueTag,
      active: true,
      sortOrder: (i + 1) * 10,
    })
    for (const cls of CLASSES) {
      bag.put("serviceVariants", variantId(sv.id, cls), at, {
        serviceId: sv.id,
        vehicleClass: cls,
        durationMin: durationMin(sv.id, cls),
        basePriceP: listPriceP(sv.id, cls),
        active: true,
      })
    }
    for (const [itemId, qty] of RECIPES[sv.id] ?? []) {
      bag.put("serviceRecipes", `rcp_${sv.id.slice(4)}_${itemId.slice(4)}`, at, {
        serviceId: sv.id,
        vehicleClass: "*",
        itemId,
        qtyBase: qty,
      })
    }
  })

  for (const p of PACKAGES) {
    bag.put("packages", p.id, at, {
      code: p.code,
      nameEn: p.nameEn,
      nameBn: p.nameBn,
      serviceIds: p.serviceIds,
      pricing: p.pricing.kind === "fixed" ? { kind: "fixed", prices: { ...p.pricing.prices } } : { ...p.pricing },
      active: true,
    })
  }
  for (const a of ADD_ONS) {
    bag.put("addOns", a.id, at, {
      code: a.code,
      nameEn: a.nameEn,
      nameBn: a.nameBn,
      priceP: a.priceP,
      durationMin: a.durationMin,
      revenueTag: a.revenueTag,
      appliesTo: a.appliesTo,
      active: true,
    })
  }

  // Price lists: RETAIL published since F, FLEET 12% off, DEALER overrides, a draft RETAIL revision.
  const published = { publishedBy: USR.rashed, publishedAt: w.at(w.cal.F, "09:00") }
  bag.put("priceLists", PL.retail, at, { code: "RETAIL", nameEn: "Retail list prices", nameBn: "খুচরা মূল্য তালিকা", kind: "retail", validFrom: w.cal.F, status: "published", basis: "override", ...published }, USR.rashed)
  bag.put("priceLists", PL.fleet, at, { code: "FLEET", nameEn: "Fleet and corporate prices", nameBn: "ফ্লিট ও কর্পোরেট মূল্য", kind: "fleet", validFrom: w.cal.F, status: "published", basis: "discount-pct", discountPct: 12, ...published }, USR.rashed)
  bag.put("priceLists", PL.dealer, at, { code: "DEALER", nameEn: "Dealer prices", nameBn: "ডিলার মূল্য", kind: "dealer", validFrom: w.cal.F, status: "published", basis: "override", ...published }, USR.rashed)
  const nextMonth = addMonthsISO(w.cal.today, 1)
  bag.put("priceLists", PL.retailDraft, w.at(isoAddDays(w.cal.today, -2), "16:00"), {
    code: "RETAIL",
    nameEn: "Retail list prices (wash +10%)",
    nameBn: "খুচরা মূল্য তালিকা (ওয়াশ +১০%)",
    kind: "retail",
    validFrom: nextMonth,
    status: "draft",
    basis: "override",
    revisionOfId: PL.retail,
  }, USR.farzana)

  let n = 0
  const line = (priceListId: string, targetType: "service-variant" | "package" | "item", targetId: string, priceP: number, vehicleClass?: VehicleClass) => {
    n += 1
    bag.put("priceListLines", `pll_${String(n).padStart(4, "0")}`, at, { priceListId, targetType, targetId, priceP, vehicleClass })
  }
  for (const sv of SERVICES) {
    for (const cls of CLASSES) {
      const retail = listPriceP(sv.id, cls)
      line(PL.retail, "service-variant", variantId(sv.id, cls), retail, cls)
      line(PL.fleet, "service-variant", variantId(sv.id, cls), servicePriceP(PL.fleet, sv.id, cls), cls)
      const wash = sv.category === "wash"
      line(PL.retailDraft, "service-variant", variantId(sv.id, cls), wash ? retail + percentOf(retail, 10) : retail, cls)
      if (sv.id === SVC.WSH_PRM) line(PL.dealer, "service-variant", variantId(sv.id, cls), 1000_00, cls)
    }
  }
  const pkgNew = PACKAGES.find((p) => p.id === PKG.NEW)!
  if (pkgNew.pricing.kind === "fixed") {
    for (const cls of CLASSES) line(PL.dealer, "package", PKG.NEW, pkgNew.pricing.prices[cls], cls)
  }
  for (const item of ITEMS) {
    if (item.retail === undefined) continue
    line(PL.retail, "item", item.id, item.retail * 100)
    line(PL.retailDraft, "item", item.id, item.retail * 100)
  }

  // Promotions: WINTER10 this month and next (used 37 times); FIRSTCOAT (used 6 times).
  bag.put("promotions", PROMO.winter10, at, {
    code: "WINTER10",
    nameEn: "Winter interior offer, 10% off",
    nameBn: "শীতের ইন্টেরিয়র অফার, ১০% ছাড়",
    kind: "pct",
    value: 10,
    appliesTo: ["interior"],
    validFrom: w.cal.currentMonthStart,
    validTo: lastOfMonth(nextMonth),
    minOrderP: 0,
    active: true,
    usedCount: 37,
  }, USR.rashed)
  bag.put("promotions", PROMO.firstcoat, at, {
    code: "FIRSTCOAT",
    nameEn: "First ceramic coating, ৳3,000 off",
    nameBn: "প্রথম সিরামিক কোটিং, ৳৩,০০০ ছাড়",
    kind: "amount",
    value: 3000_00,
    appliesTo: ["protection"],
    validFrom: w.cal.F,
    validTo: isoAddDays(addMonthsISO(w.cal.fyStart, 12), -1),
    minOrderP: 20000_00,
    active: true,
    usedCount: 6,
  }, USR.rashed)
}
