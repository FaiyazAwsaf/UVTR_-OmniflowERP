import type { RevenueTag, ServiceCategory, VehicleClass } from "@/core/db/schema"

import { ADDON, ITM, PKG, SVC } from "./seed-refs"

/**
 * The service catalogue and the item master (seed_data.md §3, §4). Prices
 * are VAT-exclusive taka, CONFIRM: CLIENT. Brand names are fictional.
 */

export const CLASSES: VehicleClass[] = ["HB", "SD", "SUV", "LSUV", "MPV"]

/** Duration factors by class (seed_data.md §3, rounded to 5 minutes). */
export const DURATION_FACTORS: Record<VehicleClass, number> = {
  HB: 0.85,
  SD: 1,
  SUV: 1.2,
  LSUV: 1.4,
  MPV: 1.4,
}

export type ServiceDef = {
  id: string
  code: string
  nameEn: string
  nameBn: string
  category: ServiceCategory
  revenueTag: RevenueTag
  /** Taka by class: HB, SD, SUV, LSUV, MPV */
  prices: [number, number, number, number, number]
  durationSd: number
  warrantyMonths?: number
  descriptionEn: string
  descriptionBn: string
  /** Bay the job needs (seed scheduling) */
  bay: "wash" | "detailing" | "coating"
}

const s = (
  id: string,
  code: string,
  nameEn: string,
  nameBn: string,
  category: ServiceCategory,
  revenueTag: RevenueTag,
  prices: [number, number, number, number, number],
  durationSd: number,
  bay: ServiceDef["bay"],
  descriptionEn: string,
  descriptionBn: string,
  warrantyMonths?: number
): ServiceDef => ({ id, code, nameEn, nameBn, category, revenueTag, prices, durationSd, bay, descriptionEn, descriptionBn, warrantyMonths })

export const SERVICES: ServiceDef[] = [
  s(SVC.WSH_EXP, "WSH-EXP", "Express exterior wash", "এক্সপ্রেস এক্সটেরিয়র ওয়াশ", "wash", "REV_WASH", [500, 600, 800, 1000, 1000], 40, "wash",
    "Snow foam pre-wash, hand wash, dry and tyre shine.", "স্নো ফোম প্রি-ওয়াশ, হাতে ধোয়া, শুকানো ও টায়ার শাইন।"),
  s(SVC.WSH_PRM, "WSH-PRM", "Premium wash (foam, hand wash, vacuum, glass, tyre shine)", "প্রিমিয়াম ওয়াশ", "wash", "REV_WASH", [1200, 1400, 1800, 2200, 2200], 90, "wash",
    "Foam, two-bucket hand wash, vacuum, glass inside and out, tyre shine.", "ফোম, হাতে ধোয়া, ভ্যাকুয়াম, ভেতরে ও বাইরে গ্লাস, টায়ার শাইন।"),
  s(SVC.INT_DEEP, "INT-DEEP", "Interior deep cleaning", "ইন্টেরিয়র ডিপ ক্লিনিং", "interior", "REV_INTERIOR", [4500, 5500, 6500, 8000, 9000], 240, "detailing",
    "Seats, carpets, roof lining and panels shampooed and extracted.", "সিট, কার্পেট, ছাদ ও প্যানেল শ্যাম্পু ও পরিষ্কার।"),
  s(SVC.INT_LTH, "INT-LTH", "Leather clean and conditioning", "লেদার ক্লিন ও কন্ডিশনিং", "interior", "REV_INTERIOR", [2500, 3000, 3500, 4000, 4500], 90, "detailing",
    "Leather seats cleaned and conditioned.", "চামড়ার সিট পরিষ্কার ও কন্ডিশনিং।"),
  s(SVC.INT_ODR, "INT-ODR", "Odour removal (ozone)", "দুর্গন্ধ দূরীকরণ", "interior", "REV_INTERIOR", [2000, 2000, 2000, 2000, 2000], 60, "detailing",
    "Ozone treatment and odour neutraliser.", "ওজোন ট্রিটমেন্ট ও দুর্গন্ধ নিরোধক।"),
  s(SVC.PNT_DCN, "PNT-DCN", "Paint decontamination (clay and iron remover)", "পেইন্ট ডিকন্টামিনেশন", "paint", "REV_PAINT", [2500, 3000, 3500, 4500, 4500], 90, "detailing",
    "Iron remover, tar remover and clay bar.", "আয়রন রিমুভার, টার রিমুভার ও ক্লে বার।"),
  s(SVC.PNT_C1, "PNT-C1", "Paint correction, 1-step", "পেইন্ট কারেকশন, ১-ধাপ", "paint", "REV_PAINT", [12000, 14000, 17000, 20000, 20000], 420, "coating",
    "One-step machine polish for gloss and light swirl removal.", "চকচকে ভাব ও হালকা দাগ দূর করতে এক ধাপের মেশিন পলিশ।"),
  s(SVC.PNT_C2, "PNT-C2", "Paint correction, 2-step", "পেইন্ট কারেকশন, ২-ধাপ", "paint", "REV_PAINT", [20000, 24000, 28000, 34000, 34000], 840, "coating",
    "Cut and polish for deeper defects.", "গভীর দাগের জন্য কাট ও পলিশ।"),
  s(SVC.PRT_WAX, "PRT-WAX", "Carnauba wax", "কার্নাউবা ওয়াক্স", "protection", "REV_PROTECTION", [2500, 3000, 3500, 4000, 4000], 60, "detailing",
    "Hand-applied carnauba paste wax.", "হাতে লাগানো কার্নাউবা ওয়াক্স।"),
  s(SVC.PRT_SLN, "PRT-SLN", "Paint sealant (6 months)", "পেইন্ট সিল্যান্ট (৬ মাস)", "protection", "REV_PROTECTION", [5000, 6000, 7000, 8500, 8500], 120, "detailing",
    "Synthetic paint sealant, about six months of protection.", "সিনথেটিক পেইন্ট সিল্যান্ট, প্রায় ছয় মাসের সুরক্ষা।", 6),
  s(SVC.PRT_CC2, "PRT-CC2", "Ceramic coating, 2-year", "সিরামিক কোটিং, ২ বছর", "protection", "REV_PROTECTION", [25000, 30000, 36000, 42000, 42000], 960, "coating",
    "Decontamination, polish and a two-year ceramic coating.", "ডিকন্টামিনেশন, পলিশ ও দুই বছরের সিরামিক কোটিং।", 24),
  s(SVC.PRT_CC5, "PRT-CC5", "Ceramic coating, 5-year", "সিরামিক কোটিং, ৫ বছর", "protection", "REV_PROTECTION", [45000, 55000, 65000, 80000, 80000], 1440, "coating",
    "Paint correction and a five-year ceramic coating.", "পেইন্ট কারেকশন ও পাঁচ বছরের সিরামিক কোটিং।", 60),
  s(SVC.GLS_CLN, "GLS-CLN", "Glass care (water spots and repellent)", "গ্লাস কেয়ার", "glass", "REV_GLASS_WHEEL", [2500, 3000, 3500, 4000, 4000], 60, "detailing",
    "Water spot removal and a glass repellent coat.", "পানির দাগ দূর ও গ্লাস রিপেল্যান্ট।"),
  s(SVC.WHL_CLN, "WHL-CLN", "Wheel and tyre care", "হুইল ও টায়ার কেয়ার", "wheel", "REV_GLASS_WHEEL", [1500, 1800, 2200, 2500, 2500], 60, "wash",
    "Wheel faces and barrels cleaned, iron removed, tyres dressed.", "চাকা পরিষ্কার, আয়রন দূর ও টায়ার ড্রেসিং।"),
  s(SVC.WHL_CC, "WHL-CC", "Wheel ceramic coating", "হুইল সিরামিক কোটিং", "wheel", "REV_GLASS_WHEEL", [6000, 6000, 7500, 8500, 8500], 120, "detailing",
    "Ceramic coating on all four wheels.", "চারটি চাকায় সিরামিক কোটিং।", 12),
  s(SVC.ENG_BAY, "ENG-BAY", "Engine bay cleaning and dressing", "ইঞ্জিন বে ক্লিনিং", "engine", "REV_RESTORATION", [1500, 1800, 2200, 2500, 2500], 60, "wash",
    "Engine bay degreased, rinsed and dressed.", "ইঞ্জিন বে পরিষ্কার ও ড্রেসিং।"),
  s(SVC.RST_HL, "RST-HL", "Headlight restoration (pair)", "হেডলাইট রেস্টোরেশন (জোড়া)", "restoration", "REV_RESTORATION", [2500, 2500, 2500, 3000, 3000], 90, "detailing",
    "Sanding, polish and a UV sealant on both headlights.", "দুটি হেডলাইটে স্যান্ডিং, পলিশ ও ইউভি সিল্যান্ট।"),
  s(SVC.RST_TRM, "RST-TRM", "Trim restoration", "ট্রিম রেস্টোরেশন", "restoration", "REV_RESTORATION", [2000, 2500, 3000, 3500, 3500], 60, "detailing",
    "Faded plastic trim restored.", "বিবর্ণ প্লাস্টিক ট্রিম পুনরুদ্ধার।"),
]

export const SERVICE_BY_ID = new Map(SERVICES.map((sv) => [sv.id, sv]))
export const SERVICE_BY_CODE = new Map(SERVICES.map((sv) => [sv.code, sv]))

export const CLASS_INDEX: Record<VehicleClass, number> = { HB: 0, SD: 1, SUV: 2, LSUV: 3, MPV: 4 }

/** Retail list price in poisha. */
export function listPriceP(serviceId: string, cls: VehicleClass): number {
  const def = SERVICE_BY_ID.get(serviceId)
  if (!def) throw new Error(`seed: unknown service ${serviceId}`)
  return def.prices[CLASS_INDEX[cls]] * 100
}

/** Duration by class, rounded to 5 minutes. */
export function durationMin(serviceId: string, cls: VehicleClass): number {
  const def = SERVICE_BY_ID.get(serviceId)
  if (!def) throw new Error(`seed: unknown service ${serviceId}`)
  return Math.max(5, Math.round((def.durationSd * DURATION_FACTORS[cls]) / 5) * 5)
}

/** Sedan recipes (seed_data.md §3.1), base units; other classes scale by the class factors. */
export const RECIPES: Record<string, [string, number][]> = {
  [SVC.WSH_EXP]: [[ITM.snowFoam, 60], [ITM.shampoo, 40], [ITM.microfiber, 0.1], [ITM.tyreShine, 15]],
  [SVC.WSH_PRM]: [[ITM.snowFoam, 80], [ITM.shampoo, 50], [ITM.apc, 40], [ITM.glassCleaner, 30], [ITM.tyreShine, 25], [ITM.interiorDetailer, 20], [ITM.microfiber, 0.2]],
  [SVC.INT_DEEP]: [[ITM.apc, 250], [ITM.fabricShampoo, 200], [ITM.leatherCleaner, 50], [ITM.interiorDetailer, 60], [ITM.odour, 20], [ITM.microfiber, 1], [ITM.brush, 0.05]],
  [SVC.INT_LTH]: [[ITM.leatherCleaner, 120], [ITM.leatherConditioner, 100], [ITM.applicator, 1], [ITM.microfiber, 0.5]],
  [SVC.INT_ODR]: [[ITM.odour, 80]],
  [SVC.PNT_DCN]: [[ITM.ironRemover, 150], [ITM.tarRemover, 50], [ITM.clayLube, 150], [ITM.clayBar, 0.25]],
  [SVC.PNT_C1]: [[ITM.polish, 120], [ITM.ipa, 150], [ITM.polishingPad, 0.5], [ITM.maskingTape, 0.3], [ITM.microfiber, 1]],
  [SVC.PNT_C2]: [[ITM.compound, 150], [ITM.polish, 120], [ITM.ipa, 200], [ITM.cuttingPad, 0.5], [ITM.polishingPad, 0.5], [ITM.maskingTape, 0.5], [ITM.microfiber, 1.5]],
  [SVC.PRT_WAX]: [[ITM.wax, 30], [ITM.applicator, 1], [ITM.microfiber, 0.5]],
  [SVC.PRT_SLN]: [[ITM.sealant, 50], [ITM.applicator, 1], [ITM.microfiber, 0.5]],
  [SVC.PRT_CC2]: [[ITM.ironRemover, 150], [ITM.clayLube, 150], [ITM.polish, 120], [ITM.ipa, 250], [ITM.clayBar, 0.25], [ITM.polishingPad, 0.5], [ITM.applicator, 2], [ITM.microfiber, 2], [ITM.cc2Kit, 30]],
  [SVC.PRT_CC5]: [[ITM.ironRemover, 150], [ITM.clayLube, 150], [ITM.polish, 120], [ITM.ipa, 250], [ITM.clayBar, 0.25], [ITM.polishingPad, 0.5], [ITM.applicator, 2], [ITM.microfiber, 2], [ITM.compound, 150], [ITM.cuttingPad, 0.5], [ITM.cc5Kit, 40]],
  [SVC.GLS_CLN]: [[ITM.glassPolish, 40], [ITM.glassCoating, 10], [ITM.microfiber, 0.5]],
  [SVC.WHL_CLN]: [[ITM.wheelCleaner, 200], [ITM.ironRemover, 80], [ITM.tyreShine, 40], [ITM.brush, 0.05]],
  [SVC.WHL_CC]: [[ITM.wheelCleaner, 200], [ITM.ipa, 100], [ITM.wheelCoating, 15]],
  [SVC.ENG_BAY]: [[ITM.apc, 200], [ITM.engineDressing, 60], [ITM.maskingTape, 0.2]],
  [SVC.RST_HL]: [[ITM.sandingDisc, 4], [ITM.polish, 30], [ITM.uvSealant, 10]],
  [SVC.RST_TRM]: [[ITM.trimRestorer, 40], [ITM.applicator, 1]],
}

/** Service mix weights for retail jobs (seed_data.md §7.1). */
export const SERVICE_WEIGHTS: [string, number][] = [
  [SVC.WSH_EXP, 38],
  [SVC.WSH_PRM, 24],
  [SVC.INT_DEEP, 9],
  [SVC.PNT_DCN, 4],
  [SVC.PRT_WAX, 3],
  [SVC.GLS_CLN, 3],
  [SVC.PRT_SLN, 2.5],
  [SVC.WHL_CLN, 2.5],
  [SVC.INT_LTH, 3],
  [SVC.INT_ODR, 2],
  [SVC.PNT_C1, 3],
  [SVC.PNT_C2, 1.2],
  [SVC.PRT_CC2, 1.6],
  [SVC.PRT_CC5, 0.6],
  [SVC.WHL_CC, 0.5],
  [SVC.ENG_BAY, 2],
  [SVC.RST_HL, 1.5],
  [SVC.RST_TRM, 1.5],
]

/** Class shares of retail vehicles (seed_data.md §5.1). */
export const CLASS_SHARES: [VehicleClass, number][] = [
  ["HB", 18],
  ["SD", 37],
  ["SUV", 30],
  ["LSUV", 10],
  ["MPV", 5],
]

/** Multi-day services (seed scheduling avoids them in the last days of the history). */
export const LONG_SERVICES = new Set<string>([SVC.PNT_C2, SVC.PRT_CC2, SVC.PRT_CC5, SVC.PNT_C1])

export type PackageDef = {
  id: string
  code: string
  nameEn: string
  nameBn: string
  serviceIds: string[]
  pricing: { kind: "bundle-pct"; pct: number } | { kind: "fixed"; prices: Record<VehicleClass, number> }
}

export const PACKAGES: PackageDef[] = [
  {
    id: PKG.SHOW,
    code: "PKG-SHOW",
    nameEn: "Showroom Shine",
    nameBn: "শোরুম শাইন",
    serviceIds: [SVC.WSH_PRM, SVC.PNT_DCN, SVC.PNT_C1, SVC.PRT_SLN],
    pricing: { kind: "bundle-pct", pct: 10 },
  },
  {
    id: PKG.NEW,
    code: "PKG-NEW",
    nameEn: "New Car Protection",
    nameBn: "নতুন গাড়ির সুরক্ষা",
    serviceIds: [SVC.PNT_DCN, SVC.PRT_CC2, SVC.GLS_CLN, SVC.WHL_CLN],
    pricing: { kind: "fixed", prices: { HB: 30000_00, SD: 34000_00, SUV: 40000_00, LSUV: 46000_00, MPV: 46000_00 } },
  },
  {
    id: PKG.FRESH,
    code: "PKG-FRESH",
    nameEn: "Fresh Interior",
    nameBn: "ফ্রেশ ইন্টেরিয়র",
    serviceIds: [SVC.INT_DEEP, SVC.INT_ODR, SVC.INT_LTH],
    pricing: { kind: "bundle-pct", pct: 12 },
  },
]

export const PACKAGE_BY_ID = new Map(PACKAGES.map((p) => [p.id, p]))

export type AddOnDef = {
  id: string
  code: string
  nameEn: string
  nameBn: string
  priceP: number
  durationMin: number
  revenueTag: RevenueTag
  appliesTo: ServiceCategory[]
}

export const ADD_ONS: AddOnDef[] = [
  { id: ADDON.PET, code: "ADD-PET", nameEn: "Pet hair removal", nameBn: "পোষা প্রাণীর লোম অপসারণ", priceP: 800_00, durationMin: 30, revenueTag: "REV_INTERIOR", appliesTo: ["interior"] },
  { id: ADDON.MUD, code: "ADD-MUD", nameEn: "Heavy mud surcharge", nameBn: "অতিরিক্ত কাদা সারচার্জ", priceP: 500_00, durationMin: 15, revenueTag: "REV_WASH", appliesTo: ["wash"] },
  { id: ADDON.ENG, code: "ADD-ENG", nameEn: "Engine bay with any wash", nameBn: "যেকোনো ওয়াশের সাথে ইঞ্জিন বে", priceP: 1000_00, durationMin: 45, revenueTag: "REV_RESTORATION", appliesTo: ["wash"] },
  { id: ADDON.PICKUP, code: "ADD-PKD", nameEn: "Pick-up and drop within 10 km", nameBn: "১০ কিমির মধ্যে পিক-আপ ও ড্রপ", priceP: 1500_00, durationMin: 20, revenueTag: "REV_WASH", appliesTo: ["wash", "interior", "paint", "protection", "glass", "wheel", "engine", "restoration"] },
]

export const ADDON_BY_ID = new Map(ADD_ONS.map((a) => [a.id, a]))

/* ================================================================== *
 * Items (seed_data.md §4)
 * ================================================================== */

export type ItemDef = {
  id: string
  sku: string
  nameEn: string
  nameBn: string
  kind: "chemical" | "consumable" | "retail"
  brand: string
  baseUom: "ml" | "g" | "pc" | "roll"
  purchaseUom: string
  purchaseFactor: number
  /** Taka per purchase unit, VAT exclusive */
  cost: number
  /** Taka per piece (retail goods) */
  retail?: number
  /** Coatings keep 18 months, other chemicals 24 */
  shelfLifeDays?: number
  /** A size variant (stocked at the Central Store only) */
  variant?: boolean
}

const ch = (id: string, sku: string, nameEn: string, nameBn: string, brand: string, baseUom: "ml" | "g", purchaseUom: string, factor: number, cost: number, opts: Partial<ItemDef> = {}): ItemDef => ({
  id, sku, nameEn, nameBn, kind: "chemical", brand, baseUom, purchaseUom, purchaseFactor: factor, cost, shelfLifeDays: 730, ...opts,
})
const cn = (id: string, sku: string, nameEn: string, nameBn: string, brand: string, baseUom: "pc" | "roll", purchaseUom: string, factor: number, cost: number): ItemDef => ({
  id, sku, nameEn, nameBn, kind: "consumable", brand, baseUom, purchaseUom, purchaseFactor: factor, cost,
})
const rt = (id: string, sku: string, nameEn: string, nameBn: string, brand: string, factor: number, cost: number, retail: number): ItemDef => ({
  id, sku, nameEn, nameBn, kind: "retail", brand, baseUom: "pc", purchaseUom: "carton", purchaseFactor: factor, cost, retail,
})

const COATING = { shelfLifeDays: 540 }

export const ITEMS: ItemDef[] = [
  ch(ITM.snowFoam, "CH-SNF-5L", "Snow foam concentrate", "স্নো ফোম কনসেনট্রেট", "AquaVex", "ml", "can", 5000, 4200),
  ch(ITM.shampoo, "CH-SHP-5L", "pH-neutral car shampoo", "পিএইচ-নিউট্রাল কার শ্যাম্পু", "AquaVex", "ml", "can", 5000, 3600),
  ch(ITM.apc, "CH-APC-5L", "All-purpose cleaner", "অল-পারপাস ক্লিনার", "DetailMate", "ml", "can", 5000, 3000),
  ch(ITM.glassCleaner, "CH-GLC-5L", "Glass cleaner", "গ্লাস ক্লিনার", "DetailMate", "ml", "can", 5000, 2400),
  ch(ITM.tyreShine, "CH-TYS-5L", "Tyre shine (pro)", "টায়ার শাইন (প্রো)", "ProShine", "ml", "can", 5000, 4800),
  ch(ITM.interiorDetailer, "CH-IND-5L", "Interior detailer", "ইন্টেরিয়র ডিটেইলার", "DetailMate", "ml", "can", 5000, 4500),
  ch(ITM.fabricShampoo, "CH-FAB-5L", "Fabric and carpet shampoo", "ফেব্রিক ও কার্পেট শ্যাম্পু", "DetailMate", "ml", "can", 5000, 3800),
  ch(ITM.leatherCleaner, "CH-LCL-1L", "Leather cleaner", "লেদার ক্লিনার", "Lumora", "ml", "bottle", 1000, 2200),
  ch(ITM.leatherConditioner, "CH-LCD-1L", "Leather conditioner", "লেদার কন্ডিশনার", "Lumora", "ml", "bottle", 1000, 2600),
  ch(ITM.odour, "CH-ODR-1L", "Odour neutraliser", "দুর্গন্ধ নিরোধক", "DetailMate", "ml", "bottle", 1000, 1800),
  ch(ITM.ironRemover, "CH-IRN-5L", "Iron remover", "আয়রন রিমুভার", "ProShine", "ml", "can", 5000, 7500),
  ch(ITM.tarRemover, "CH-TAR-1L", "Tar and glue remover", "টার ও আঠা রিমুভার", "ProShine", "ml", "bottle", 1000, 1900),
  ch(ITM.clayLube, "CH-CLL-5L", "Clay lubricant", "ক্লে লুব্রিক্যান্ট", "ProShine", "ml", "can", 5000, 3200),
  ch(ITM.compound, "CH-CMP-1L", "Heavy cut compound", "হেভি কাট কম্পাউন্ড", "Lumora", "ml", "bottle", 1000, 3800),
  ch(ITM.polish, "CH-POL-1L", "Finishing polish", "ফিনিশিং পলিশ", "Lumora", "ml", "bottle", 1000, 3400),
  ch(ITM.ipa, "CH-IPA-5L", "Panel wipe (IPA 99%)", "প্যানেল ওয়াইপ (আইপিএ ৯৯%)", "ProShine", "ml", "can", 5000, 2800),
  ch(ITM.wax, "CH-WAX-200", "Carnauba paste wax", "কার্নাউবা পেস্ট ওয়াক্স", "Lumora", "g", "tin", 200, 3500),
  ch(ITM.sealant, "CH-SLN-500", "Paint sealant", "পেইন্ট সিল্যান্ট", "CeraNova", "ml", "bottle", 500, 4200, COATING),
  ch(ITM.cc2Kit, "CH-CC2-50", "Ceramic coating, 2-year", "সিরামিক কোটিং, ২ বছর", "CeraNova", "ml", "kit", 50, 6500, COATING),
  ch(ITM.cc5Kit, "CH-CC5-50", "Ceramic coating, 5-year", "সিরামিক কোটিং, ৫ বছর", "CeraNova", "ml", "kit", 50, 11500, COATING),
  ch(ITM.glassPolish, "CH-GLP-500", "Glass polish", "গ্লাস পলিশ", "Lumora", "ml", "bottle", 500, 1800),
  ch(ITM.glassCoating, "CH-GCT-30", "Glass coating", "গ্লাস কোটিং", "CeraNova", "ml", "kit", 30, 2400, COATING),
  ch(ITM.wheelCleaner, "CH-WHC-5L", "Wheel cleaner", "হুইল ক্লিনার", "ProShine", "ml", "can", 5000, 4600),
  ch(ITM.wheelCoating, "CH-WCT-30", "Wheel ceramic coating", "হুইল সিরামিক কোটিং", "CeraNova", "ml", "kit", 30, 2900, COATING),
  ch(ITM.engineDressing, "CH-ENG-1L", "Engine bay dressing", "ইঞ্জিন বে ড্রেসিং", "ProShine", "ml", "bottle", 1000, 1700),
  ch(ITM.uvSealant, "CH-UVS-50", "Headlight UV sealant", "হেডলাইট ইউভি সিল্যান্ট", "CeraNova", "ml", "bottle", 50, 1600, COATING),
  ch(ITM.trimRestorer, "CH-TRM-500", "Trim restorer", "ট্রিম রেস্টোরার", "ProShine", "ml", "bottle", 500, 1900),
  cn(ITM.microfiber, "CN-MFT-10", "Microfiber towel 40x40", "মাইক্রোফাইবার তোয়ালে ৪০x৪০", "DetailMate", "pc", "pack", 10, 2200),
  cn(ITM.applicator, "CN-APP-10", "Foam applicator pad", "ফোম অ্যাপ্লিকেটর প্যাড", "DetailMate", "pc", "pack", 10, 900),
  cn(ITM.clayBar, "CN-CLY-1", "Clay bar 200 g", "ক্লে বার ২০০ গ্রাম", "ProShine", "pc", "pc", 1, 1600),
  cn(ITM.cuttingPad, "CN-CUT-1", "Cutting pad 6 inch", "কাটিং প্যাড ৬ ইঞ্চি", "Lumora", "pc", "pc", 1, 950),
  cn(ITM.polishingPad, "CN-PPD-1", "Polishing pad 6 inch", "পলিশিং প্যাড ৬ ইঞ্চি", "Lumora", "pc", "pc", 1, 850),
  cn(ITM.maskingTape, "CN-MSK-1", "Masking tape 24 mm roll", "মাস্কিং টেপ ২৪ মিমি রোল", "DetailMate", "roll", "roll", 1, 180),
  cn(ITM.sandingDisc, "CN-SND-50", "Sanding disc P3000", "স্যান্ডিং ডিস্ক পি৩০০০", "Lumora", "pc", "pack", 50, 1500),
  cn(ITM.brush, "CN-BRS-4", "Detailing brush", "ডিটেইলিং ব্রাশ", "DetailMate", "pc", "set", 4, 1200),
  cn(ITM.gloves, "CN-GLV-100", "Nitrile gloves", "নাইট্রাইল গ্লাভস", "DetailMate", "pc", "box", 100, 850),
  rt(ITM.rtAfrOcean, "RT-AFR-01", "Car air freshener, ocean", "গাড়ির এয়ার ফ্রেশনার, ওশান", "AquaVex", 24, 4320, 350),
  rt(ITM.rtAfrCitrus, "RT-AFR-02", "Car air freshener, citrus", "গাড়ির এয়ার ফ্রেশনার, সাইট্রাস", "AquaVex", 24, 4320, 350),
  rt(ITM.rtAfrVanilla, "RT-AFR-03", "Car air freshener, vanilla", "গাড়ির এয়ার ফ্রেশনার, ভ্যানিলা", "AquaVex", 24, 4320, 350),
  rt(ITM.rtShampoo, "RT-SHP-500", "Car shampoo 500 ml (retail)", "কার শ্যাম্পু ৫০০ মিলি (খুচরা)", "AquaVex", 12, 5040, 750),
  rt(ITM.rtTyreShine, "RT-TYS-500", "Tyre shine 500 ml (retail)", "টায়ার শাইন ৫০০ মিলি (খুচরা)", "ProShine", 12, 5760, 850),
  rt(ITM.rtGlassCleaner, "RT-GLC-500", "Glass cleaner 500 ml (retail)", "গ্লাস ক্লিনার ৫০০ মিলি (খুচরা)", "DetailMate", 12, 3600, 550),
  rt(ITM.rtMicrofiber, "RT-MFP-3", "Microfiber pack of 3 (retail)", "মাইক্রোফাইবার ৩টির প্যাক (খুচরা)", "DetailMate", 20, 9000, 850),
  rt(ITM.rtDashPolish, "RT-DSH-300", "Dashboard polish 300 ml", "ড্যাশবোর্ড পলিশ ৩০০ মিলি", "Lumora", 12, 4560, 690),
  rt(ITM.rtQuickDetailer, "RT-QDT-500", "Quick detailer 500 ml", "কুইক ডিটেইলার ৫০০ মিলি", "Lumora", 12, 6240, 950),
  rt(ITM.rtGiftKit, "RT-KIT-01", "Car care gift kit", "কার কেয়ার গিফট কিট", "Lumora", 6, 11400, 3500),
  rt(ITM.rtWashMitt, "RT-MIT-01", "Microfiber wash mitt", "মাইক্রোফাইবার ওয়াশ মিট", "DetailMate", 20, 5200, 480),
  rt(ITM.rtWipes, "RT-WIP-25", "Interior wipes (25)", "ইন্টেরিয়র ওয়াইপস (২৫টি)", "DetailMate", 24, 4560, 350),
  /* Size variants (Central Store only) */
  ch(ITM.snowFoam20l, "CH-SNF-20L", "Snow foam concentrate, 20 L", "স্নো ফোম কনসেনট্রেট, ২০ লিটার", "AquaVex", "ml", "can", 20000, 15800, { variant: true }),
  ch(ITM.shampoo20l, "CH-SHP-20L", "pH-neutral car shampoo, 20 L", "পিএইচ-নিউট্রাল কার শ্যাম্পু, ২০ লিটার", "AquaVex", "ml", "can", 20000, 13600, { variant: true }),
  ch(ITM.apc20l, "CH-APC-20L", "All-purpose cleaner, 20 L", "অল-পারপাস ক্লিনার, ২০ লিটার", "DetailMate", "ml", "can", 20000, 11200, { variant: true }),
  ch(ITM.apc1l, "CH-APC-1L", "All-purpose cleaner, 1 L", "অল-পারপাস ক্লিনার, ১ লিটার", "DetailMate", "ml", "bottle", 1000, 700, { variant: true }),
  ch(ITM.glassCleaner1l, "CH-GLC-1L", "Glass cleaner, 1 L", "গ্লাস ক্লিনার, ১ লিটার", "DetailMate", "ml", "bottle", 1000, 560, { variant: true }),
  ch(ITM.tyreShine1l, "CH-TYS-1L", "Tyre shine (pro), 1 L", "টায়ার শাইন (প্রো), ১ লিটার", "ProShine", "ml", "bottle", 1000, 1100, { variant: true }),
  ch(ITM.interiorDetailer1l, "CH-IND-1L", "Interior detailer, 1 L", "ইন্টেরিয়র ডিটেইলার, ১ লিটার", "DetailMate", "ml", "bottle", 1000, 1050, { variant: true }),
  ch(ITM.ironRemover1l, "CH-IRN-1L", "Iron remover, 1 L", "আয়রন রিমুভার, ১ লিটার", "ProShine", "ml", "bottle", 1000, 1700, { variant: true }),
  ch(ITM.ipa20l, "CH-IPA-20L", "Panel wipe (IPA 99%), 20 L", "প্যানেল ওয়াইপ (আইপিএ ৯৯%), ২০ লিটার", "ProShine", "ml", "can", 20000, 10400, { variant: true }),
  ch(ITM.wheelCleaner1l, "CH-WHC-1L", "Wheel cleaner, 1 L", "হুইল ক্লিনার, ১ লিটার", "ProShine", "ml", "bottle", 1000, 1050, { variant: true }),
  ch(ITM.cc2Kit30, "CH-CC2-30", "Ceramic coating, 2-year, 30 ml kit", "সিরামিক কোটিং, ২ বছর, ৩০ মিলি কিট", "CeraNova", "ml", "kit", 30, 4100, { variant: true, ...COATING }),
  ch(ITM.cc5Kit30, "CH-CC5-30", "Ceramic coating, 5-year, 30 ml kit", "সিরামিক কোটিং, ৫ বছর, ৩০ মিলি কিট", "CeraNova", "ml", "kit", 30, 7300, { variant: true, ...COATING }),
]

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]))

/** Item category by kind. */
export const CATEGORY_OF_KIND = { chemical: "cat_chem", consumable: "cat_cons", retail: "cat_retail" } as const
export const TAG_OF_KIND = { chemical: "INV_CHEMICAL", consumable: "INV_CONSUMABLE", retail: "INV_RETAIL" } as const

/** Retail goods sold at the counters. */
export const RETAIL_ITEMS = ITEMS.filter((i) => i.kind === "retail")
/** Weights for retail goods sold (cheaper goods sell more often). */
export const RETAIL_WEIGHTS: [string, number][] = RETAIL_ITEMS.map((i) => [i.id, i.retail! >= 3000 ? 1 : i.retail! >= 800 ? 4 : 7])

/** Units of measure (plan §5.4). */
export const UOMS: { code: string; nameEn: string; nameBn: string; dimension: "volume" | "mass" | "count" }[] = [
  { code: "ml", nameEn: "Millilitre", nameBn: "মিলিলিটার", dimension: "volume" },
  { code: "l", nameEn: "Litre", nameBn: "লিটার", dimension: "volume" },
  { code: "g", nameEn: "Gram", nameBn: "গ্রাম", dimension: "mass" },
  { code: "kg", nameEn: "Kilogram", nameBn: "কিলোগ্রাম", dimension: "mass" },
  { code: "pc", nameEn: "Piece", nameBn: "পিস", dimension: "count" },
  { code: "roll", nameEn: "Roll", nameBn: "রোল", dimension: "count" },
  { code: "pair", nameEn: "Pair", nameBn: "জোড়া", dimension: "count" },
  { code: "set", nameEn: "Set", nameBn: "সেট", dimension: "count" },
  { code: "can", nameEn: "Can", nameBn: "ক্যান", dimension: "count" },
  { code: "bottle", nameEn: "Bottle", nameBn: "বোতল", dimension: "count" },
  { code: "tin", nameEn: "Tin", nameBn: "টিন", dimension: "count" },
  { code: "kit", nameEn: "Kit", nameBn: "কিট", dimension: "count" },
  { code: "pack", nameEn: "Pack", nameBn: "প্যাক", dimension: "count" },
  { code: "box", nameEn: "Box", nameBn: "বাক্স", dimension: "count" },
  { code: "carton", nameEn: "Carton", nameBn: "কার্টন", dimension: "count" },
]
