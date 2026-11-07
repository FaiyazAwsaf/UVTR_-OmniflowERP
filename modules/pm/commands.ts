import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"

/**
 * PM Product Master commands (plan §6.2, §3.9): items with their unit
 * factors, categories, units of measure and reorder rules per location.
 * Items, categories and units are company-wide (no location scope).
 */

const VAT_CATEGORIES = ["standard", "reduced-10", "reduced-7.5", "reduced-5", "exempt"] as const

const itemInput = z.object({
  id: z.string().optional(),
  expectedVersion: z.number().int().optional(),
  sku: z.string().trim().min(2).max(32),
  nameEn: z.string().trim().min(2),
  nameBn: z.string().trim().default(""),
  categoryId: z.string(),
  kind: z.enum(["chemical", "consumable", "retail"]),
  brand: z.string().trim().optional(),
  baseUom: z.string(),
  purchaseUom: z.string(),
  purchaseFactor: z.number().positive(),
  salesUom: z.string().optional(),
  salesFactor: z.number().positive().optional(),
  trackBatch: z.boolean(),
  shelfLifeDays: z.number().int().positive().optional(),
  standardCostP: z.number().int().nonnegative(),
  retailPriceP: z.number().int().nonnegative().optional(),
  vatCategory: z.enum(VAT_CATEGORIES),
  barcode: z.string().trim().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
})

/** EAN-13 style barcode from a running number (check digit computed). */
export function makeBarcode(serial: number): string {
  const body = `200${String(serial).padStart(9, "0")}`.slice(0, 12)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** `pm.saveItem`: create (pm.item.create) or edit (pm.item.edit) an item → ItemCreated / ItemUpdated. */
export const saveItem = defineCommand({
  name: "pm.saveItem",
  permission: ["pm.item.create", "pm.item.edit"],
  input: itemInput,
  async run(tx, input) {
    const creating = !input.id
    if (!tx.can(creating ? "pm.item.create" : "pm.item.edit")) {
      tx.reject("PERMISSION_DENIED", {}, { audit: true })
    }
    const sku = input.sku.toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9-]*$/.test(sku)) tx.reject("SKU_FORMAT", { sku })
    const [same] = await tx.list("items", "sku", sku)
    if (same && same.id !== input.id) tx.reject("SKU_TAKEN", { sku })
    const category = await tx.get("itemCategories", input.categoryId)
    for (const uom of [input.baseUom, input.purchaseUom, input.salesUom].filter(Boolean) as string[]) {
      if (!(await tx.find("uoms", uom))) tx.reject("UOM_UNKNOWN", { uom })
    }
    if (input.kind === "retail" && (!input.salesUom || input.retailPriceP === undefined)) {
      tx.reject("RETAIL_PRICE_REQUIRED", { sku })
    }
    const fields = {
      sku,
      nameEn: input.nameEn,
      nameBn: input.nameBn || input.nameEn,
      categoryId: category.id,
      kind: input.kind,
      brand: input.brand || undefined,
      baseUom: input.baseUom,
      purchaseUom: input.purchaseUom,
      purchaseFactor: input.purchaseFactor,
      salesUom: input.salesUom || undefined,
      salesFactor: input.salesUom ? (input.salesFactor ?? 1) : undefined,
      trackBatch: input.trackBatch,
      shelfLifeDays: input.trackBatch ? input.shelfLifeDays : undefined,
      standardCostP: input.standardCostP,
      retailPriceP: input.kind === "retail" ? input.retailPriceP : input.retailPriceP || undefined,
      vatCategory: input.vatCategory,
      status: input.status,
    }

    if (creating) {
      const barcode = input.barcode || makeBarcode(await tx.nextNumber("pm:barcode"))
      const item = tx.insert("items", { ...fields, barcode, imageSeed: sku })
      tx.emit("ItemCreated", { refs: { itemId: item.id }, params: { sku } })
      return { id: item.id }
    }

    const current = await tx.get("items", input.id!, { expectedVersion: input.expectedVersion })
    // Stock already carried under the item keeps its unit and its GL tag (the tie per tag).
    const hasStock = (await tx.list("stockMoves", "itemId", current.id)).length > 0
    if (hasStock && current.baseUom !== fields.baseUom) tx.reject("BASE_UOM_LOCKED", { sku })
    if (hasStock && current.categoryId !== fields.categoryId) {
      const before = await tx.get("itemCategories", current.categoryId)
      if (before.inventoryTag !== category.inventoryTag) tx.reject("ITEM_TAG_LOCKED", { sku })
    }
    await tx.update("items", current.id, { ...fields, barcode: input.barcode || current.barcode })
    tx.emit("ItemUpdated", { refs: { itemId: current.id }, params: { sku } })
    return { id: current.id }
  },
})

/** `pm.saveCategory` (pm.item.edit): an item category with its inventory and cost tags. */
export const saveCategory = defineCommand({
  name: "pm.saveCategory",
  permission: "pm.item.edit",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: z.number().int().optional(),
    code: z.string().trim().min(2).max(16),
    nameEn: z.string().trim().min(2),
    nameBn: z.string().trim().default(""),
    parentId: z.string().optional(),
    inventoryTag: z.enum(["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"]),
    costTag: z.enum(["CONSUMABLES_USED", "COGS"]),
  }),
  async run(tx, input) {
    const code = input.code.toUpperCase()
    const [same] = await tx.list("itemCategories", "code", code)
    if (same && same.id !== input.id) tx.reject("CATEGORY_CODE_TAKEN", { code })
    const fields = {
      code,
      nameEn: input.nameEn,
      nameBn: input.nameBn || input.nameEn,
      parentId: input.parentId || undefined,
      inventoryTag: input.inventoryTag,
      costTag: input.costTag,
    }
    if (!input.id) return { id: tx.insert("itemCategories", fields).id }
    const current = await tx.get("itemCategories", input.id, { expectedVersion: input.expectedVersion })
    if (current.inventoryTag !== fields.inventoryTag) {
      const items = await tx.list("items", "categoryId", current.id)
      for (const item of items) {
        if ((await tx.list("stockMoves", "itemId", item.id)).length) tx.reject("CATEGORY_TAG_LOCKED", { code })
      }
    }
    await tx.update("itemCategories", current.id, fields)
    return { id: current.id }
  },
})

/** `pm.saveUom` (pm.item.edit): a unit of measure (id = code). */
export const saveUom = defineCommand({
  name: "pm.saveUom",
  permission: "pm.item.edit",
  input: z.object({
    code: z.string().trim().min(1).max(12),
    nameEn: z.string().trim().min(1),
    nameBn: z.string().trim().default(""),
    dimension: z.enum(["volume", "mass", "count"]),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const code = input.code.toLowerCase()
    if (!/^[a-z][a-z0-9]*$/.test(code)) tx.reject("UOM_FORMAT", { uom: code })
    const current = await tx.find("uoms", code)
    const fields = { code, nameEn: input.nameEn, nameBn: input.nameBn || input.nameEn, dimension: input.dimension }
    if (!current) {
      tx.insert("uoms", { id: code, ...fields })
      return { id: code }
    }
    await tx.update("uoms", code, fields, { expectedVersion: input.expectedVersion })
    return { id: code }
  },
})

/** `pm.saveReorderRule` (pm.reorder.edit): minimum, maximum and reorder quantity per item and location → ReorderRuleChanged. */
export const saveReorderRule = defineCommand({
  name: "pm.saveReorderRule",
  permission: "pm.reorder.edit",
  input: z.object({
    itemId: z.string(),
    locationId: z.string(),
    minQty: z.number().nonnegative(),
    maxQty: z.number().nonnegative(),
    reorderQty: z.number().nonnegative().optional(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    if (input.maxQty < input.minQty) tx.reject("REORDER_MAX_BELOW_MIN")
    const item = await tx.get("items", input.itemId)
    const location = await tx.get("locations", input.locationId)
    if (!location.isStockLocation) tx.reject("NOT_STOCK_LOCATION", { location: location.id })
    const reorderQty = input.reorderQty ?? Math.max(0, input.maxQty - input.minQty)
    const [rule] = await tx.list("reorderRules", "[itemId+locationId]", [item.id, location.id])
    const fields = { itemId: item.id, locationId: location.id, minQty: input.minQty, maxQty: input.maxQty, reorderQty }
    const row = rule
      ? await tx.update("reorderRules", rule.id, fields, { expectedVersion: input.expectedVersion })
      : tx.insert("reorderRules", fields)
    tx.emit("ReorderRuleChanged", {
      refs: { itemId: item.id, locationId: location.id },
      params: { sku: item.sku, min: input.minQty, max: input.maxQty },
      locationId: location.id,
    })
    return { id: row.id }
  },
})
