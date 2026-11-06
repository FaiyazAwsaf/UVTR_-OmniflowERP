import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import type { OmniflowDb } from "@/core/db/database"
import { ITM, PKG, PL, PROMO, SVC } from "@/core/seed/content/seed-refs"
import { readCatalogue } from "@/modules/pc/catalogue"
import { publishPriceList, saveRecipe, savePriceList, savePromotion, saveService } from "@/modules/pc/commands"
import { effectiveList, listStatusOn, packagePrice, priceRequests, recipeFor, servicePrice } from "@/modules/pc/pricing"

import { actors, refusal, run, seededDb } from "../stl/helpers"

/**
 * PC on the small seed: the class price matrix on the RETAIL, FLEET and
 * DEALER lists, packages exploded with the remainder on the last component,
 * recipes scaled by class, and the catalogue commands (permission, publish
 * archiving the previous list from its date).
 */

let db: OmniflowDb
let as: ReturnType<typeof actors>
beforeAll(async () => {
  db = await seededDb("pc")
  as = actors(db)
}, 120_000)
afterAll(async () => {
  await db.delete()
})

const today = () => dhakaDate(now())

describe("pricing", () => {
  it("prices a service by class on each list", async () => {
    const cat = await readCatalogue(db)
    const retail = effectiveList(cat, PL.retail, today())
    const fleet = effectiveList(cat, PL.fleet, today())
    const dealer = effectiveList(cat, PL.dealer, today())
    expect(retail?.id).toBe(PL.retail)
    expect(servicePrice(cat, retail, SVC.PRT_CC2, "SUV")).toBe(36_000_00)
    expect(servicePrice(cat, fleet, SVC.PRT_CC2, "SUV")).toBe(31_680_00)
    expect(servicePrice(cat, dealer, SVC.WSH_PRM, "LSUV")).toBe(1_000_00)
    expect(servicePrice(cat, dealer, SVC.INT_DEEP, "SD")).toBe(5_500_00)
  })

  it("explodes packages pro rata with the remainder on the last component", async () => {
    const cat = await readCatalogue(db)
    const retail = effectiveList(cat, PL.retail, today())
    const show = packagePrice(cat, retail, PKG.SHOW, "SD")
    // 1,400 + 3,000 + 14,000 + 6,000 = 24,400, 10% off = 21,960.
    expect(show.totalP).toBe(21_960_00)
    expect(show.parts.reduce((s, p) => s + p.priceP, 0)).toBe(21_960_00)
    const dealerNew = packagePrice(cat, effectiveList(cat, PL.dealer, today()), PKG.NEW, "SUV")
    expect(dealerNew.totalP).toBe(40_000_00)
    const priced = priceRequests(cat, {
      priceListId: PL.retail,
      date: today(),
      vehicleClass: "SD",
      requests: [{ kind: "package", packageId: PKG.FRESH }],
      discountPct: 5,
    })
    expect(priced.lines).toHaveLength(3)
    expect(priced.subtotalP).toBe(packagePrice(cat, retail, PKG.FRESH, "SD").totalP)
    expect(priced.totalP).toBe(priced.subtotalP - priced.discountP + priced.vatP)
    expect(priced.lines.every((l) => l.vatP === Math.floor((l.netP * 1500 + 5000) / 10000))).toBe(true)
  })

  it("applies a promotion to its categories only", async () => {
    const cat = await readCatalogue(db)
    const priced = priceRequests(cat, {
      priceListId: PL.retail,
      date: today(),
      vehicleClass: "SD",
      requests: [
        { kind: "service", serviceId: SVC.INT_DEEP },
        { kind: "service", serviceId: SVC.WSH_EXP },
      ],
      discountPct: 0,
      promotionId: PROMO.winter10,
    })
    expect(priced.lines[0].discountP).toBe(550_00)
    expect(priced.lines[1].discountP).toBe(0)
  })

  it("scales the sedan recipe by class (ceramic 2-year: 30 ml, SUV 38 ml)", async () => {
    const cat = await readCatalogue(db)
    const suv = recipeFor(cat, SVC.PRT_CC2, "SUV")
    expect(suv.find((r) => r.itemId === ITM.cc2Kit)?.qtyBase).toBe(38)
    expect(recipeFor(cat, SVC.PRT_CC2, "HB").find((r) => r.itemId === ITM.microfiber)?.qtyBase).toBe(1.7)
  })
})

describe("catalogue commands", () => {
  it("needs pc.catalog.edit and saves a service and a class recipe", async () => {
    const service = (await db.services.get(SVC.RST_TRM))!
    const variants = await db.serviceVariants.where("serviceId").equals(service.id).toArray()
    const input = {
      serviceId: service.id,
      code: service.code,
      nameEn: service.nameEn,
      nameBn: service.nameBn,
      category: service.category,
      warrantyMonths: 3,
      variants: variants.map((v) => ({ vehicleClass: v.vehicleClass, durationMin: v.durationMin + 5, basePriceP: v.basePriceP })),
    }
    expect(await refusal(db, await as("nayeem"), saveService, input)).toBe("denied")
    await run(db, await as("farzana"), saveService, input)
    expect((await db.services.get(service.id))?.warrantyMonths).toBe(3)
    await run(db, await as("farzana"), saveRecipe, { serviceId: service.id, vehicleClass: "LSUV", lines: [{ itemId: ITM.trimRestorer, qtyBase: 70 }] })
    const cat = await readCatalogue(db)
    expect(recipeFor(cat, service.id, "LSUV")).toEqual([{ itemId: ITM.trimRestorer, sedanQty: 70, qtyBase: 70, classSpecific: true }])
    expect(await refusal(db, await as("farzana"), saveRecipe, { serviceId: service.id, vehicleClass: "*", lines: [{ itemId: ITM.rtWipes, qtyBase: 1 }] })).toBe(
      "PC_RECIPE_RETAIL"
    )
  })

  it("publishes the draft RETAIL revision from a date; the old list stays in force until the day before", async () => {
    const from = addDaysISO(today(), 3)
    expect(await refusal(db, await as("nayeem"), publishPriceList, { priceListId: PL.retailDraft, validFrom: from })).toBe("denied")
    expect(await refusal(db, await as("farzana"), publishPriceList, { priceListId: PL.retailDraft, validFrom: addDaysISO(today(), -1) })).toBe(
      "PC_PUBLISH_PAST"
    )
    await run(db, await as("farzana"), publishPriceList, { priceListId: PL.retailDraft, validFrom: from })
    const old = (await db.priceLists.get(PL.retail))!
    expect(old.validTo).toBe(addDaysISO(from, -1))
    expect(listStatusOn(old, today())).toBe("published")
    expect(listStatusOn(old, from)).toBe("archived")
    const cat = await readCatalogue(db)
    expect(effectiveList(cat, PL.retail, today())?.id).toBe(PL.retail)
    expect(effectiveList(cat, PL.retail, from)?.id).toBe(PL.retailDraft)
    // Wash prices +10% from that date.
    expect(servicePrice(cat, effectiveList(cat, PL.retail, from), SVC.WSH_EXP, "SD")).toBe(660_00)
    expect(await refusal(db, await as("farzana"), savePriceList, { priceListId: PL.retailDraft, code: "RETAIL", nameEn: "Retail", nameBn: "খুচরা", kind: "retail", validFrom: from, basis: "override" })).toBe(
      "PC_LIST_NOT_DRAFT"
    )
  })

  it("copies a list into a new draft and saves a promotion", async () => {
    const farzana = await as("farzana")
    const out = await run(db, farzana, savePriceList, {
      copyFromId: PL.fleet,
      code: "FLEET",
      nameEn: "Fleet revision",
      nameBn: "ফ্লিট সংশোধন",
      kind: "fleet",
      validFrom: addDaysISO(today(), 10),
      basis: "discount-pct",
      discountPct: 10,
    })
    expect(await db.priceListLines.where("priceListId").equals(out.priceListId).count()).toBe(await db.priceListLines.where("priceListId").equals(PL.fleet).count())
    await run(db, farzana, savePromotion, {
      code: "EID15",
      nameEn: "Eid wash offer",
      nameBn: "ঈদ ওয়াশ অফার",
      kind: "pct",
      value: 15,
      appliesTo: ["wash"],
      validFrom: today(),
      validTo: addDaysISO(today(), 10),
    })
    expect((await db.promotions.where("code").equals("EID15").first())?.usedCount).toBe(0)
  })
})
