import type { VendorTaxCategory } from "@/config/rules.config"
import type { PartySegment, VehicleClass } from "@/core/db/schema"

import { ITM, PL, PTY, SVC, VND } from "./seed-refs"

/**
 * Credit customers, vendors and vehicle models (seed_data.md §5). Company
 * names are invented; makes and models are real, owners and registrations
 * invented.
 */

export type Studio = "GUL" | "UTT"

export type CreditCustomerDef = {
  id: string
  nameEn: string
  nameBn: string
  segment: Extract<PartySegment, "fleet" | "dealer" | "corporate">
  creditLimit: number
  terms: number
  priceListId: string
  deductsVds: boolean
  deductsAit: boolean
  /** Studios it uses and their weights */
  studios: [Studio, number][]
  /** Jobs per day across its studios (history volume) */
  ratePerDay: number
  /** Fleet size (vehicles or dealer stock cars) */
  vehicles: number
  /** Vehicle classes it runs */
  classes: [VehicleClass, number][]
  /** Service menu: service id (or "PKG-NEW") with weights */
  services: [string, number][]
  /** Pays by bank transfer or cheque */
  pays: "bank" | "cheque" | "mixed"
  area: string
  contacts: [string, string, string][]
}

const T = (taka: number) => taka

export const CREDIT_CUSTOMERS: CreditCustomerDef[] = [
  {
    id: PTY.swiftRide, nameEn: "Swift Ride Rentals Ltd", nameBn: "সুইফট রাইড রেন্টালস লিমিটেড", segment: "fleet",
    creditLimit: T(3_50_000), terms: 30, priceListId: PL.fleet, deductsVds: true, deductsAit: true,
    studios: [["GUL", 1]], ratePerDay: 0.75, vehicles: 46, classes: [["SD", 60], ["MPV", 25], ["SUV", 15]],
    services: [[SVC.WSH_PRM, 50], [SVC.WSH_EXP, 18], [SVC.INT_DEEP, 18], [SVC.ENG_BAY, 7], [SVC.INT_ODR, 7]],
    pays: "bank", area: "Tejgaon",
    contacts: [["Rezaul Karim", "Fleet Manager", "Fleet Manager"], ["Nabila Sultana", "Accounts Executive", "Accounts Executive"]],
  },
  {
    id: PTY.greenway, nameEn: "Greenway Car Rental", nameBn: "গ্রিনওয়ে কার রেন্টাল", segment: "fleet",
    creditLimit: T(2_00_000), terms: 30, priceListId: PL.fleet, deductsVds: false, deductsAit: false,
    studios: [["UTT", 3], ["GUL", 1]], ratePerDay: 0.16, vehicles: 22, classes: [["SD", 55], ["SUV", 30], ["MPV", 15]],
    services: [[SVC.WSH_PRM, 50], [SVC.WSH_EXP, 25], [SVC.INT_DEEP, 20], [SVC.WHL_CLN, 5]],
    pays: "cheque", area: "Uttara Sector 11",
    contacts: [["Habibur Rahman", "Operations Head", "Operations Head"], ["Sadia Islam", "Accounts Officer", "Accounts Officer"]],
  },
  {
    id: PTY.metroFleet, nameEn: "Metro Corporate Fleet Services Ltd", nameBn: "মেট্রো কর্পোরেট ফ্লিট সার্ভিসেস লিমিটেড", segment: "corporate",
    creditLimit: T(5_00_000), terms: 45, priceListId: PL.fleet, deductsVds: true, deductsAit: true,
    studios: [["GUL", 1]], ratePerDay: 1.0, vehicles: 58, classes: [["SD", 45], ["SUV", 35], ["LSUV", 10], ["MPV", 10]],
    services: [[SVC.WSH_PRM, 35], [SVC.INT_DEEP, 25], [SVC.PRT_SLN, 15], [SVC.WSH_EXP, 10], [SVC.INT_LTH, 10], [SVC.GLS_CLN, 5]],
    pays: "cheque", area: "Motijheel",
    contacts: [["Anisur Rahman", "Transport Manager", "Transport Manager"], ["Farhana Akter", "Senior Accountant", "Senior Accountant"]],
  },
  {
    id: PTY.orbit, nameEn: "Orbit Tours and Travels", nameBn: "অরবিট ট্যুরস অ্যান্ড ট্রাভেলস", segment: "fleet",
    creditLimit: T(1_50_000), terms: 30, priceListId: PL.fleet, deductsVds: false, deductsAit: true,
    studios: [["UTT", 1]], ratePerDay: 0.14, vehicles: 14, classes: [["MPV", 60], ["SUV", 25], ["SD", 15]],
    services: [[SVC.WSH_PRM, 45], [SVC.INT_DEEP, 30], [SVC.WSH_EXP, 15], [SVC.INT_ODR, 10]],
    pays: "bank", area: "Uttara Sector 4",
    contacts: [["Monirul Islam", "Proprietor", "Proprietor"], ["Rupa Akter", "Office Manager", "Office Manager"]],
  },
  {
    id: PTY.bluebird, nameEn: "Bluebird Executive Cars", nameBn: "ব্লুবার্ড এক্সিকিউটিভ কারস", segment: "fleet",
    creditLimit: T(1_00_000), terms: 30, priceListId: PL.fleet, deductsVds: false, deductsAit: false,
    studios: [["GUL", 1]], ratePerDay: 0.1, vehicles: 12, classes: [["SD", 50], ["LSUV", 30], ["SUV", 20]],
    services: [[SVC.WSH_PRM, 50], [SVC.INT_LTH, 20], [SVC.PRT_WAX, 15], [SVC.WSH_EXP, 15]],
    pays: "bank", area: "Banani",
    contacts: [["Tariqul Hasan", "Managing Partner", "Managing Partner"], ["Mitu Rahman", "Accounts", "Accounts"]],
  },
  {
    id: PTY.skyline, nameEn: "Skyline Logistics Ltd", nameBn: "স্কাইলাইন লজিস্টিকস লিমিটেড", segment: "corporate",
    creditLimit: T(2_50_000), terms: 30, priceListId: PL.fleet, deductsVds: false, deductsAit: true,
    studios: [["UTT", 2], ["GUL", 1]], ratePerDay: 0.12, vehicles: 18, classes: [["LSUV", 40], ["MPV", 35], ["SUV", 25]],
    services: [[SVC.WSH_PRM, 45], [SVC.ENG_BAY, 15], [SVC.INT_DEEP, 25], [SVC.WHL_CLN, 15]],
    pays: "bank", area: "Tejgaon",
    contacts: [["Shamsul Alam", "Admin Manager", "Admin Manager"], ["Ishrat Jahan", "Finance Officer", "Finance Officer"]],
  },
  {
    id: PTY.primeAuto, nameEn: "Prime Auto Gallery", nameBn: "প্রাইম অটো গ্যালারি", segment: "dealer",
    creditLimit: T(4_00_000), terms: 30, priceListId: PL.dealer, deductsVds: false, deductsAit: false,
    studios: [["GUL", 1]], ratePerDay: 0.17, vehicles: 40, classes: [["SUV", 45], ["SD", 35], ["LSUV", 20]],
    services: [["PKG-NEW", 70], [SVC.WSH_PRM, 30]],
    pays: "bank", area: "Tejgaon",
    contacts: [["Mostafizur Rahman", "Showroom Manager", "Showroom Manager"], ["Lamia Haque", "Accounts Officer", "Accounts Officer"]],
  },
  {
    id: PTY.wheelsHub, nameEn: "Wheels Hub Bangladesh", nameBn: "হুইলস হাব বাংলাদেশ", segment: "dealer",
    creditLimit: T(3_00_000), terms: 30, priceListId: PL.dealer, deductsVds: false, deductsAit: false,
    studios: [["UTT", 1]], ratePerDay: 0.08, vehicles: 26, classes: [["SUV", 40], ["SD", 40], ["HB", 20]],
    services: [["PKG-NEW", 50], [SVC.WSH_PRM, 30], [SVC.PNT_DCN, 20]],
    pays: "bank", area: "Uttara Sector 7",
    contacts: [["Imtiaz Ahmed", "General Manager", "General Manager"], ["Tasnim Akter", "Accounts", "Accounts"]],
  },
  {
    id: PTY.gearbox, nameEn: "Gearbox Motors Ltd", nameBn: "গিয়ারবক্স মোটরস লিমিটেড", segment: "dealer",
    creditLimit: T(2_50_000), terms: 30, priceListId: PL.dealer, deductsVds: false, deductsAit: false,
    studios: [["GUL", 1]], ratePerDay: 0.08, vehicles: 24, classes: [["SD", 50], ["SUV", 35], ["HB", 15]],
    services: [["PKG-NEW", 45], [SVC.WSH_PRM, 35], [SVC.PNT_C1, 20]],
    pays: "cheque", area: "Mohakhali",
    contacts: [["Golam Mostafa", "Director", "Director"], ["Samia Haque", "Accounts Executive", "Accounts Executive"]],
  },
  {
    id: PTY.autoNest, nameEn: "Auto Nest Reconditioned Cars", nameBn: "অটো নেস্ট রিকন্ডিশন্ড কারস", segment: "dealer",
    creditLimit: T(2_00_000), terms: 30, priceListId: PL.dealer, deductsVds: false, deductsAit: false,
    studios: [["UTT", 1]], ratePerDay: 0.06, vehicles: 16, classes: [["SD", 45], ["HB", 30], ["SUV", 25]],
    services: [["PKG-NEW", 40], [SVC.WSH_PRM, 35], [SVC.INT_DEEP, 25]],
    pays: "bank", area: "Uttara Sector 13",
    contacts: [["Belal Hossain", "Proprietor", "Proprietor"], ["Mim Sultana", "Accounts", "Accounts"]],
  },
]

export const CREDIT_BY_ID = new Map(CREDIT_CUSTOMERS.map((c) => [c.id, c]))

export type VendorDef = {
  id: string
  nameEn: string
  nameBn: string
  category: VendorTaxCategory
  segment: Extract<PartySegment, "supplier" | "service-provider" | "landlord" | "utility" | "professional">
  terms: number
  area: string
  /** Items it supplies (goods vendors) */
  items?: string[]
  notesEn: string
}

export const VENDORS: VendorDef[] = [
  {
    id: VND.dhakaAutochem, nameEn: "Dhaka Auto Chem Distributors", nameBn: "ঢাকা অটো কেম ডিস্ট্রিবিউটরস", category: "goods", segment: "supplier", terms: 30, area: "Tejgaon",
    items: [ITM.snowFoam, ITM.shampoo, ITM.apc, ITM.glassCleaner, ITM.tyreShine, ITM.interiorDetailer, ITM.fabricShampoo, ITM.leatherCleaner, ITM.leatherConditioner, ITM.odour, ITM.wheelCleaner, ITM.engineDressing, ITM.trimRestorer,
      ITM.snowFoam20l, ITM.shampoo20l, ITM.apc20l, ITM.apc1l, ITM.glassCleaner1l, ITM.tyreShine1l, ITM.interiorDetailer1l, ITM.wheelCleaner1l],
    notesEn: "Wash and interior chemicals",
  },
  {
    id: VND.glossGuard, nameEn: "Gloss & Guard Trading", nameBn: "গ্লস অ্যান্ড গার্ড ট্রেডিং", category: "goods", segment: "supplier", terms: 30, area: "Banani",
    items: [ITM.compound, ITM.polish, ITM.wax, ITM.sealant, ITM.cc2Kit, ITM.cc5Kit, ITM.glassPolish, ITM.glassCoating, ITM.wheelCoating, ITM.uvSealant, ITM.cc2Kit30, ITM.cc5Kit30],
    notesEn: "Compounds, polishes and coatings",
  },
  {
    id: VND.bengalDetail, nameEn: "Bengal Detail Supplies", nameBn: "বেঙ্গল ডিটেইল সাপ্লাইজ", category: "goods", segment: "supplier", terms: 15, area: "Farmgate",
    items: [ITM.microfiber, ITM.applicator, ITM.clayBar, ITM.cuttingPad, ITM.polishingPad, ITM.maskingTape, ITM.sandingDisc, ITM.brush, ITM.gloves],
    notesEn: "Pads, towels, applicators, brushes and tape",
  },
  {
    id: VND.northline, nameEn: "Northline Car Care Imports", nameBn: "নর্থলাইন কার কেয়ার ইমপোর্টস", category: "goods", segment: "supplier", terms: 30, area: "Motijheel",
    items: [ITM.rtAfrOcean, ITM.rtAfrCitrus, ITM.rtAfrVanilla, ITM.rtShampoo, ITM.rtTyreShine, ITM.rtGlassCleaner, ITM.rtMicrofiber, ITM.rtDashPolish, ITM.rtQuickDetailer, ITM.rtGiftKit, ITM.rtWashMitt, ITM.rtWipes],
    notesEn: "Retail products",
  },
  {
    id: VND.metroChem, nameEn: "Metro Industrial Chemicals", nameBn: "মেট্রো ইন্ডাস্ট্রিয়াল কেমিক্যালস", category: "goods", segment: "supplier", terms: 15, area: "Tejgaon",
    items: [ITM.ipa, ITM.ironRemover, ITM.tarRemover, ITM.clayLube, ITM.ipa20l, ITM.ironRemover1l],
    notesEn: "IPA and solvents",
  },
  { id: VND.shaplaPack, nameEn: "Shapla Packaging House", nameBn: "শাপলা প্যাকেজিং হাউস", category: "goods", segment: "supplier", terms: 15, area: "Kafrul", notesEn: "Packaging and printed bags" },
  { id: VND.gulshanProps, nameEn: "Gulshan Properties Ltd", nameBn: "গুলশান প্রপার্টিজ লিমিটেড", category: "rent", segment: "landlord", terms: 5, area: "Gulshan-2", notesEn: "Gulshan Studio and Head Office rent" },
  { id: VND.uttaraEstate, nameEn: "Uttara Estate Holdings", nameBn: "উত্তরা এস্টেট হোল্ডিংস", category: "rent", segment: "landlord", terms: 5, area: "Uttara Sector 7", notesEn: "Uttara Studio rent" },
  { id: VND.tejgaonWh, nameEn: "Tejgaon Warehousing Ltd", nameBn: "তেজগাঁও ওয়্যারহাউজিং লিমিটেড", category: "rent", segment: "landlord", terms: 5, area: "Tejgaon", notesEn: "Central Store rent" },
  { id: VND.primeGuard, nameEn: "Prime Guard Security Services", nameBn: "প্রাইম গার্ড সিকিউরিটি সার্ভিসেস", category: "services", segment: "service-provider", terms: 15, area: "Mohakhali", notesEn: "Guards at all sites" },
  { id: VND.protech, nameEn: "ProTech Equipment Service", nameBn: "প্রোটেক ইকুইপমেন্ট সার্ভিস", category: "services", segment: "service-provider", terms: 15, area: "Tejgaon", notesEn: "Pressure washer and polisher repairs" },
  { id: VND.swiftlink, nameEn: "Swiftlink Internet", nameBn: "সুইফটলিংক ইন্টারনেট", category: "utility", segment: "utility", terms: 10, area: "Banani", notesEn: "Internet at all sites" },
  { id: VND.cityUtilities, nameEn: "City Utilities (electricity and water)", nameBn: "সিটি ইউটিলিটিজ (বিদ্যুৎ ও পানি)", category: "utility", segment: "utility", terms: 7, area: "Motijheel", notesEn: "Electricity and water" },
  { id: VND.rahmanAssoc, nameEn: "Rahman & Associates, Chartered Accountants", nameBn: "রহমান অ্যান্ড অ্যাসোসিয়েটস, চার্টার্ড অ্যাকাউন্ট্যান্টস", category: "professional", segment: "professional", terms: 30, area: "Paltan", notesEn: "Audit and tax advice" },
]

export const VENDOR_BY_ID = new Map(VENDORS.map((v) => [v.id, v]))
/** The goods vendors whose items stock the store. */
export const GOODS_VENDORS = VENDORS.filter((v) => v.items?.length)
/** Vendor of each item. */
export const VENDOR_OF_ITEM = new Map<string, string>(GOODS_VENDORS.flatMap((v) => v.items!.map((i) => [i, v.id] as [string, string])))
/** Main vendor per inventory tag: the balancing purchase at the cutover (seed_data.md §7.1). */
export const MAIN_VENDOR_OF_TAG = {
  INV_CHEMICAL: VND.dhakaAutochem,
  INV_CONSUMABLE: VND.bengalDetail,
  INV_RETAIL: VND.northline,
} as const

/* ---------------- Vehicle models (real makes and models) ---------------- */

export const MODELS: Record<VehicleClass, [string, string][]> = {
  HB: [["Toyota", "Vitz"], ["Toyota", "Aqua"], ["Suzuki", "Swift"], ["Honda", "Fit"], ["Nissan", "Note"]],
  SD: [["Toyota", "Axio"], ["Toyota", "Allion"], ["Toyota", "Premio"], ["Toyota", "Corolla"], ["Honda", "Civic"], ["Honda", "Grace"], ["Nissan", "Sylphy"]],
  SUV: [["Toyota", "C-HR"], ["Toyota", "Corolla Cross"], ["Honda", "Vezel"], ["Honda", "CR-V"], ["Nissan", "X-Trail"], ["Mitsubishi", "Outlander"], ["Hyundai", "Tucson"], ["Toyota", "RAV4"]],
  LSUV: [["Toyota", "Land Cruiser Prado"], ["Toyota", "Land Cruiser"], ["Mitsubishi", "Pajero"], ["Toyota", "Hilux"], ["Toyota", "Harrier"]],
  MPV: [["Toyota", "Noah"], ["Toyota", "Esquire"], ["Toyota", "Hiace"], ["Nissan", "Serena"]],
}

export const COLOURS = ["White", "Pearl white", "Black", "Silver", "Grey", "Wine red", "Blue"]

/** Registration series by class: cars KA/KHA/GA, SUVs and jeeps GHA, microbuses CHA. */
export const SERIES: Record<VehicleClass, string[]> = {
  HB: ["KA", "KHA", "GA"],
  SD: ["KA", "KHA", "GA"],
  SUV: ["GHA"],
  LSUV: ["GHA"],
  MPV: ["CHA"],
}

export const SERIES_BN: Record<string, string> = { KA: "ক", KHA: "খ", GA: "গ", GHA: "ঘ", CHA: "চ" }
