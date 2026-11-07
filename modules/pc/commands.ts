import { z } from "zod"

import { addDaysISO } from "@/core/clock/dates"
import { VEHICLE_CLASSES, type RevenueTag, type ServiceCategory } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"

import { listStatusOn } from "./pricing"

/**
 * PC Product Configuration commands (plan §6.2, §3.9). Catalogue edits need
 * `pc.catalog.edit`; publishing a price list needs `pc.pricelist.publish`.
 * Prices are VAT exclusive poisha; recipe quantities are base units.
 */

const CLASS = z.enum(["HB", "SD", "SUV", "LSUV", "MPV"])
const CATEGORY = z.enum(["wash", "interior", "paint", "protection", "glass", "wheel", "engine", "restoration"])
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Revenue tag of a service category (accounting_rules.md §2). */
export const REVENUE_TAG_OF: Record<ServiceCategory, RevenueTag> = {
  wash: "REV_WASH",
  interior: "REV_INTERIOR",
  paint: "REV_PAINT",
  protection: "REV_PROTECTION",
  glass: "REV_GLASS_WHEEL",
  wheel: "REV_GLASS_WHEEL",
  engine: "REV_RESTORATION",
  restoration: "REV_RESTORATION",
}

const variantIdOf = (serviceId: string, cls: string) => `svv_${serviceId.replace(/^svc_/, "")}_${cls.toLowerCase()}`

/** Create or edit a service with its class variants (durations, retail price, active). */
export const saveService = defineCommand({
  name: "pc.saveService",
  permission: "pc.catalog.edit",
  input: z.object({
    serviceId: z.string().optional(),
    expectedVersion: z.number().optional(),
    code: z.string().trim().min(2).max(16),
    nameEn: z.string().trim().min(2),
    nameBn: z.string().trim().min(1),
    category: CATEGORY,
    descriptionEn: z.string().default(""),
    descriptionBn: z.string().default(""),
    warrantyMonths: z.number().int().min(0).max(120).optional(),
    active: z.boolean().default(true),
    variants: z
      .array(z.object({ vehicleClass: CLASS, durationMin: z.number().int().min(5).max(3000), basePriceP: z.number().int().min(0), active: z.boolean().default(true) }))
      .min(1),
  }),
  async run(tx, input) {
    const code = input.code.toUpperCase()
    const fields = {
      code,
      nameEn: input.nameEn,
      nameBn: input.nameBn,
      category: input.category,
      descriptionEn: input.descriptionEn,
      descriptionBn: input.descriptionBn,
      warrantyMonths: input.warrantyMonths || undefined,
      vatCategory: "standard" as const,
      revenueTag: REVENUE_TAG_OF[input.category],
      active: input.active,
    }
    let serviceId = input.serviceId
    if (serviceId) {
      await tx.update("services", serviceId, fields, { expectedVersion: input.expectedVersion })
    } else {
      const [dup] = await tx.list("services", "code", code)
      if (dup) tx.reject("PC_CODE_TAKEN", { code })
      const all = await tx.all("services")
      serviceId = tx.insert("services", {
        id: `svc_${code.toLowerCase().replace(/-/g, "_")}`,
        ...fields,
        sortOrder: Math.max(0, ...all.map((s) => s.sortOrder)) + 10,
      }).id
    }
    for (const v of input.variants) {
      const id = variantIdOf(serviceId, v.vehicleClass)
      const existing = await tx.find("serviceVariants", id)
      const [byIndex] = existing ? [existing] : await tx.list("serviceVariants", "[serviceId+vehicleClass]", [serviceId, v.vehicleClass])
      if (byIndex) await tx.update("serviceVariants", byIndex.id, { durationMin: v.durationMin, basePriceP: v.basePriceP, active: v.active })
      else tx.insert("serviceVariants", { id, serviceId, vehicleClass: v.vehicleClass, durationMin: v.durationMin, basePriceP: v.basePriceP, active: v.active })
    }
    tx.emit("ServiceUpdated", { refs: { serviceId }, params: { code } })
    return { serviceId }
  },
})

/** Replace a service's recipe for the sedan base ("*") or one class (base units). */
export const saveRecipe = defineCommand({
  name: "pc.saveRecipe",
  permission: "pc.catalog.edit",
  input: z.object({
    serviceId: z.string(),
    vehicleClass: z.union([z.literal("*"), CLASS]),
    lines: z.array(z.object({ itemId: z.string(), qtyBase: z.number().positive() })),
  }),
  async run(tx, input) {
    const service = await tx.get("services", input.serviceId)
    const seen = new Set<string>()
    for (const line of input.lines) {
      if (seen.has(line.itemId)) tx.reject("PC_RECIPE_DUPLICATE")
      seen.add(line.itemId)
      const item = await tx.get("items", line.itemId)
      if (item.kind === "retail") tx.reject("PC_RECIPE_RETAIL", { item: item.sku })
    }
    const existing = (await tx.list("serviceRecipes", "serviceId", service.id)).filter((r) => r.vehicleClass === input.vehicleClass)
    for (const row of existing) await tx.remove("serviceRecipes", row.id)
    for (const line of input.lines) {
      tx.insert("serviceRecipes", {
        serviceId: service.id,
        vehicleClass: input.vehicleClass,
        itemId: line.itemId,
        qtyBase: line.qtyBase,
      })
    }
    tx.emit("RecipeUpdated", { refs: { serviceId: service.id }, params: { code: service.code } })
    return { count: input.lines.length }
  },
})

/** Create or edit a package (bundle percent off, or fixed prices per class). */
export const savePackage = defineCommand({
  name: "pc.savePackage",
  permission: "pc.catalog.edit",
  input: z.object({
    packageId: z.string().optional(),
    expectedVersion: z.number().optional(),
    code: z.string().trim().min(2).max(16),
    nameEn: z.string().trim().min(2),
    nameBn: z.string().trim().min(1),
    serviceIds: z.array(z.string()).min(2),
    pricing: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("bundle-pct"), pct: z.number().min(0).max(90) }),
      z.object({ kind: z.literal("fixed"), prices: z.partialRecord(CLASS, z.number().int().min(0)) }),
    ]),
    active: z.boolean().default(true),
  }),
  async run(tx, input) {
    for (const id of input.serviceIds) await tx.get("services", id)
    const code = input.code.toUpperCase()
    const fields = { code, nameEn: input.nameEn, nameBn: input.nameBn, serviceIds: input.serviceIds, pricing: input.pricing, active: input.active }
    let packageId = input.packageId
    if (packageId) await tx.update("packages", packageId, fields, { expectedVersion: input.expectedVersion })
    else {
      const [dup] = await tx.list("packages", "code", code)
      if (dup) tx.reject("PC_CODE_TAKEN", { code })
      packageId = tx.insert("packages", fields).id
    }
    tx.emit("ServiceUpdated", { params: { code } })
    return { packageId }
  },
})

const LIST_LINE = z.object({
  targetType: z.enum(["service-variant", "package", "item"]),
  targetId: z.string(),
  vehicleClass: CLASS.optional(),
  priceP: z.number().int().min(0),
})

/**
 * Create or edit a DRAFT price list (published lists never change: a new
 * revision is a new draft). A new draft copies the lines of `copyFromId`.
 */
export const savePriceList = defineCommand({
  name: "pc.savePriceList",
  permission: "pc.catalog.edit",
  input: z.object({
    priceListId: z.string().optional(),
    expectedVersion: z.number().optional(),
    copyFromId: z.string().optional(),
    code: z.string().trim().min(2).max(16),
    nameEn: z.string().trim().min(2),
    nameBn: z.string().trim().min(1),
    kind: z.enum(["retail", "fleet", "dealer", "custom"]),
    validFrom: ISO,
    basis: z.enum(["override", "discount-pct"]),
    discountPct: z.number().min(0).max(90).optional(),
    /** Replace every line (omit to keep the lines) */
    lines: z.array(LIST_LINE).optional(),
  }),
  async run(tx, input) {
    const fields = {
      code: input.code.toUpperCase(),
      nameEn: input.nameEn,
      nameBn: input.nameBn,
      kind: input.kind,
      validFrom: input.validFrom,
      basis: input.basis,
      discountPct: input.basis === "discount-pct" ? input.discountPct : undefined,
    }
    let priceListId = input.priceListId
    let lines = input.lines
    if (priceListId) {
      const list = await tx.get("priceLists", priceListId, { expectedVersion: input.expectedVersion })
      if (list.status !== "draft") tx.reject("PC_LIST_NOT_DRAFT", { code: list.code })
      await tx.update("priceLists", priceListId, fields)
    } else {
      const source = input.copyFromId ? await tx.get("priceLists", input.copyFromId) : undefined
      priceListId = tx.insert("priceLists", { ...fields, status: "draft", revisionOfId: source?.id }).id
      if (!lines && source) {
        lines = (await tx.list("priceListLines", "priceListId", source.id)).map((l) => ({
          targetType: l.targetType,
          targetId: l.targetId,
          vehicleClass: l.vehicleClass,
          priceP: l.priceP,
        }))
      }
    }
    if (lines) {
      for (const old of await tx.list("priceListLines", "priceListId", priceListId)) await tx.remove("priceListLines", old.id)
      for (const line of lines) tx.insert("priceListLines", { priceListId, ...line })
    }
    return { priceListId }
  },
})

/**
 * Publish a draft price list from a date (plan §6.2): the list of the same
 * code in force until then is archived from that date (it stays in force
 * the day before, and shows as archived once the date arrives).
 */
export const publishPriceList = defineCommand({
  name: "pc.publishPriceList",
  permission: "pc.pricelist.publish",
  input: z.object({ priceListId: z.string(), validFrom: ISO, expectedVersion: z.number().optional() }),
  async run(tx, input) {
    const list = await tx.get("priceLists", input.priceListId, { expectedVersion: input.expectedVersion })
    if (list.status !== "draft") tx.reject("PC_LIST_NOT_DRAFT", { code: list.code })
    const today = tx.today()
    if (input.validFrom < today) tx.reject("PC_PUBLISH_PAST", { date: input.validFrom })
    const lines = await tx.list("priceListLines", "priceListId", list.id)
    if (!lines.length && list.basis === "override") tx.reject("PC_LIST_EMPTY", { code: list.code })
    const dayBefore = addDaysISO(input.validFrom, -1)
    for (const other of await tx.list("priceLists", "code", list.code)) {
      if (other.id === list.id || other.status === "draft") continue
      if (listStatusOn(other, input.validFrom) === "archived") continue
      if (other.validFrom >= input.validFrom) {
        // A later revision scheduled after this one would never apply: archive it now.
        await tx.update("priceLists", other.id, { status: "archived", validTo: addDaysISO(other.validFrom, -1) })
        continue
      }
      await tx.update("priceLists", other.id, {
        validTo: dayBefore,
        status: input.validFrom <= today ? "archived" : "published",
      })
    }
    await tx.update("priceLists", list.id, {
      status: "published",
      validFrom: input.validFrom,
      validTo: undefined,
      publishedBy: tx.actor.userId,
      publishedAt: tx.now(),
    })
    tx.emit("PriceListPublished", { refs: { priceListId: list.id }, params: { code: list.code } })
    return { priceListId: list.id }
  },
})

/** Create or edit a promotion (percent or amount off services of some categories). */
export const savePromotion = defineCommand({
  name: "pc.savePromotion",
  permission: "pc.catalog.edit",
  input: z.object({
    promotionId: z.string().optional(),
    expectedVersion: z.number().optional(),
    code: z.string().trim().min(3).max(16),
    nameEn: z.string().trim().min(2),
    nameBn: z.string().trim().min(1),
    kind: z.enum(["pct", "amount"]),
    value: z.number().positive(),
    appliesTo: z.array(CATEGORY).min(1),
    validFrom: ISO,
    validTo: ISO,
    minOrderP: z.number().int().min(0).default(0),
    active: z.boolean().default(true),
  }),
  async run(tx, input) {
    if (input.validTo < input.validFrom) tx.reject("PC_DATES")
    if (input.kind === "pct" && input.value > 50) tx.reject("PC_PROMO_PCT")
    const code = input.code.toUpperCase()
    const fields = {
      code,
      nameEn: input.nameEn,
      nameBn: input.nameBn,
      kind: input.kind,
      value: input.kind === "amount" ? Math.round(input.value) : input.value,
      appliesTo: input.appliesTo,
      validFrom: input.validFrom,
      validTo: input.validTo,
      minOrderP: input.minOrderP,
      active: input.active,
    }
    let promotionId = input.promotionId
    if (promotionId) await tx.update("promotions", promotionId, fields, { expectedVersion: input.expectedVersion })
    else {
      const [dup] = await tx.list("promotions", "code", code)
      if (dup) tx.reject("PC_CODE_TAKEN", { code })
      promotionId = tx.insert("promotions", { ...fields, usedCount: 0 }).id
    }
    tx.emit("PromotionSaved", { params: { code } })
    return { promotionId }
  },
})

export const PC_CLASSES = VEHICLE_CLASSES
