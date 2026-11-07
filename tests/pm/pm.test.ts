import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ITM, LOC } from "@/core/seed/content/seed-refs"
import { makeBarcode, saveCategory, saveItem, saveReorderRule, saveUom } from "@/modules/pm/commands"

import { refused, run, scmDb, type ScmDb } from "../ic/scm"

/** PM (plan §6.2): items with unit factors, categories, units and reorder rules per location. */

let s: ScmDb
beforeAll(async () => {
  s = await scmDb("pm")
}, 120_000)
afterAll(async () => {
  await s.db.delete()
})

const newItem = {
  sku: "CH-CC2-100",
  nameEn: "Ceramic coating, 2-year (100 ml kit)",
  nameBn: "সিরামিক কোটিং, ২ বছর (১০০ মিলি কিট)",
  categoryId: "cat_chem",
  kind: "chemical" as const,
  baseUom: "ml",
  purchaseUom: "kit",
  purchaseFactor: 100,
  trackBatch: true,
  shelfLifeDays: 540,
  standardCostP: 12_000_00,
  vatCategory: "standard" as const,
  barcode: "",
  status: "active" as const,
}

describe("pm.saveItem", () => {
  it("creates an item with a generated barcode; a cashier may not", async () => {
    await refused(s, saveItem, newItem, "tania", "DENIED")
    const out = await run(s, saveItem, newItem, "nusrat")
    const item = (await s.db.items.get(out.id))!
    expect(item.sku).toBe("CH-CC2-100")
    expect(item.purchaseFactor).toBe(100)
    expect(item.barcode).toMatch(/^\d{13}$/)
    expect(await s.db.events.where("type").equals("ItemCreated").count()).toBe(1)
    await refused(s, saveItem, newItem, "nusrat", "SKU_TAKEN")
  })

  it("edits an item but locks the base unit and the GL tag of stock already carried", async () => {
    const item = (await s.db.items.get(ITM.polish))!
    const base = { ...item, id: item.id, expectedVersion: item.version, brand: item.brand, salesUom: item.salesUom, retailPriceP: item.retailPriceP }
    const out = await run(s, saveItem, { ...base, standardCostP: 3_500_00 }, "habib")
    expect((await s.db.items.get(out.id))?.standardCostP).toBe(3_500_00)
    const fresh = (await s.db.items.get(ITM.polish))!
    await refused(s, saveItem, { ...base, expectedVersion: fresh.version, baseUom: "g" }, "habib", "BASE_UOM_LOCKED")
    await refused(s, saveItem, { ...base, expectedVersion: fresh.version, categoryId: "cat_cons" }, "habib", "ITEM_TAG_LOCKED")
    await refused(s, saveItem, { ...base, expectedVersion: fresh.version - 1 }, "habib", "conflict")
  })

  it("makes EAN-13 style barcodes with a check digit", () => {
    const code = makeBarcode(42)
    expect(code).toHaveLength(13)
    const digits = code.split("").map(Number)
    const sum = digits.slice(0, 12).reduce((s2, d, i) => s2 + d * (i % 2 === 0 ? 1 : 3), 0)
    expect((10 - (sum % 10)) % 10).toBe(digits[12])
  })
})

describe("categories, units and reorder rules", () => {
  it("saves a category and a unit; a store keeper edits, an advisor may not", async () => {
    await refused(s, saveUom, { code: "drum", nameEn: "Drum", dimension: "count" }, "nayeem", "DENIED")
    await run(s, saveUom, { code: "drum", nameEn: "Drum", nameBn: "ড্রাম", dimension: "count" }, "habib")
    expect((await s.db.uoms.get("drum"))?.nameBn).toBe("ড্রাম")
    const cat = await run(s, saveCategory, { code: "pack", nameEn: "Packaging", inventoryTag: "INV_CONSUMABLE", costTag: "CONSUMABLES_USED" }, "habib")
    expect((await s.db.itemCategories.get(cat.id))?.code).toBe("PACK")
    const chem = (await s.db.itemCategories.get("cat_chem"))!
    await refused(s, saveCategory, { id: chem.id, expectedVersion: chem.version, code: chem.code, nameEn: chem.nameEn, inventoryTag: "INV_RETAIL", costTag: chem.costTag }, "habib", "CATEGORY_TAG_LOCKED")
  })

  it("sets a reorder rule per location → ReorderRuleChanged", async () => {
    await refused(s, saveReorderRule, { itemId: ITM.cc2Kit, locationId: LOC.UTT, minQty: 100, maxQty: 300 }, "shahriar", "DENIED")
    await refused(s, saveReorderRule, { itemId: ITM.cc2Kit, locationId: LOC.UTT, minQty: 300, maxQty: 100 }, "habib", "REORDER_MAX_BELOW_MIN")
    await refused(s, saveReorderRule, { itemId: ITM.cc2Kit, locationId: LOC.HQ, minQty: 1, maxQty: 2 }, "habib", "NOT_STOCK_LOCATION")
    const [rule] = await s.db.reorderRules.where("[itemId+locationId]").equals([ITM.cc2Kit, LOC.UTT]).toArray()
    await run(s, saveReorderRule, { itemId: ITM.cc2Kit, locationId: LOC.UTT, minQty: 120, maxQty: 360, expectedVersion: rule?.version }, "habib")
    const [after] = await s.db.reorderRules.where("[itemId+locationId]").equals([ITM.cc2Kit, LOC.UTT]).toArray()
    expect(after.minQty).toBe(120)
    expect(after.reorderQty).toBe(240)
    expect(await s.db.events.where("type").equals("ReorderRuleChanged").count()).toBe(1)
  })
})
