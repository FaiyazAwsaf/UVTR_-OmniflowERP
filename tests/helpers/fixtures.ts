import { z } from "zod"

import type { OmniflowDb } from "@/core/db/database"
import type { ItemRow, PartyRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { SYSTEM_ACTOR, type Tx } from "@/core/engine/types"

/** Run arbitrary writes as the system actor in one engine commit (test setup only). */
export async function asSystem<O>(db: OmniflowDb, write: (tx: Tx) => Promise<O>, name = "test.fixture"): Promise<O> {
  const def = defineCommand({
    name,
    permission: "system",
    input: z.object({}),
    run: (tx) => write(tx),
  })
  return (await commit(def, {}, { db, actor: SYSTEM_ACTOR })).result
}

type Data<T> = Omit<T, "id" | "version" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "origin">

export function partyData(code: string, over: Partial<Data<PartyRow>> = {}): Data<PartyRow> {
  return {
    code,
    isCustomer: true,
    isVendor: false,
    type: "individual",
    nameEn: `Party ${code}`,
    nameBn: `পার্টি ${code}`,
    segment: "retail",
    phone: "01711-000001",
    addresses: [],
    contacts: [],
    creditLimitP: 0,
    paymentTermsDays: 0,
    deductsVds: false,
    deductsAit: false,
    status: "active",
    smsConsent: true,
    avatarSeed: code,
    ...over,
  }
}

/** Item categories CHEM / CONS / RETAIL and a few items (seed_data.md §4 shapes). */
export async function seedTestItems(db: OmniflowDb): Promise<void> {
  await asSystem(db, async (tx) => {
    tx.insert("itemCategories", { id: "cat_chem", code: "CHEM", nameEn: "Chemicals", nameBn: "রাসায়নিক", inventoryTag: "INV_CHEMICAL", costTag: "CONSUMABLES_USED" })
    tx.insert("itemCategories", { id: "cat_cons", code: "CONS", nameEn: "Consumables", nameBn: "ভোগ্যপণ্য", inventoryTag: "INV_CONSUMABLE", costTag: "CONSUMABLES_USED" })
    tx.insert("itemCategories", { id: "cat_retail", code: "RETAIL", nameEn: "Retail", nameBn: "খুচরা", inventoryTag: "INV_RETAIL", costTag: "COGS" })
    const item = (id: string, over: Partial<Data<ItemRow>>): Data<ItemRow> & { id: string } => ({
      id,
      sku: id.toUpperCase(),
      nameEn: id,
      nameBn: id,
      categoryId: "cat_chem",
      kind: "chemical",
      baseUom: "ml",
      purchaseUom: "kit",
      purchaseFactor: 50,
      trackBatch: true,
      standardCostP: 6_500_00,
      vatCategory: "standard",
      barcode: "0",
      status: "active",
      imageSeed: id,
      ...over,
    })
    tx.insert("items", item("itm_cc2", {}))
    tx.insert("items", item("itm_mft", { categoryId: "cat_cons", kind: "consumable", baseUom: "pc", purchaseUom: "pack", purchaseFactor: 10, trackBatch: false, standardCostP: 2_200_00 }))
    tx.insert("items", item("itm_afr", { categoryId: "cat_retail", kind: "retail", baseUom: "pc", purchaseUom: "carton", purchaseFactor: 24, trackBatch: false, standardCostP: 4_320_00, retailPriceP: 350_00, salesUom: "pc", salesFactor: 1 }))
    tx.insert("reorderRules", { itemId: "itm_cc2", locationId: "loc_gul", minQty: 100, maxQty: 300, reorderQty: 200 })
  })
}
