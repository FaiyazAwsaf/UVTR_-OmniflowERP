/**
 * Product and tenant identity (implementation_plan.md §3.16). The ONLY place
 * the tenant's identity appears: every print header, the login card, the top
 * bar and the Mushak forms read this file, so switching tenant is a change here.
 *
 * Automania's name is real; everything else below is a placeholder until the
 * owner confirms it (CONFIRM: CLIENT).
 */

export type Bilingual = { en: string; bn: string }

/** The four Automania locations (seed_data.md §1). */
export type LocationCode = "HQ" | "GUL" | "UTT" | "CST"

export type LocationKind = "hq" | "studio" | "store"

export type BayKind = "wash" | "detailing" | "coating"

export type BayDef = { code: string; name: Bilingual; kind: BayKind }

export type LocationDef = {
  /** Fixed row id in `locations` (seed-refs: loc_gul, ...) */
  id: string
  code: LocationCode
  name: Bilingual
  kind: LocationKind
  address: Bilingual
  phone: string
  isStockLocation: boolean
  bays: BayDef[]
}

/** The staff application (the product). */
export const app = {
  name: "UVTR_OmniflowERP",
  wordmark: { prefix: "UVTR_", name: "OmniflowERP" },
  /** Package label shown as the chip beside the wordmark */
  packageLabel: "SME",
  vendor: "UVTR Infotech",
  vendorUrl: "https://uvtrinfotech.com/",
} as const

/** The demo company (D2). Placeholders marked CONFIRM: CLIENT. */
export const tenant = {
  /** CONFIRM: CLIENT the registered name */
  legalName: { en: "Automania", bn: "অটোমেনিয়া" } satisfies Bilingual,
  shortName: { en: "Automania", bn: "অটোমেনিয়া" } satisfies Bilingual,
  tagline: {
    en: "Complete interior and exterior car detailing",
    bn: "গাড়ির ভেতর ও বাইরের সম্পূর্ণ ডিটেইলিং",
  } satisfies Bilingual,
  /** CONFIRM: CLIENT (placeholder) */
  bin: "000123456-0101",
  /** CONFIRM: CLIENT (placeholder) */
  tin: "123456789012",
  /** CONFIRM: CLIENT (placeholder) */
  tradeLicense: "TRAD/DNCC/045123/2024",
  /** CONFIRM: CLIENT (placeholder) */
  registeredAddress: {
    en: "House 12, Road 55, Gulshan-2, Dhaka 1212",
    bn: "বাড়ি ১২, রোড ৫৫, গুলশান-২, ঢাকা ১২১২",
  } satisfies Bilingual,
  /** CONFIRM: CLIENT (placeholder) */
  helpline: "09612-345678",
  email: "accounts@automania.example",
  website: "automania.example",
  /** Generated monogram; no Automania logo is copied (D2). */
  monogram: "AM",
  monogramColors: { foreground: "#06c8cf", background: "#2a282b" },
} as const

/** Locations (seed_data.md §1; addresses are placeholders, CONFIRM: CLIENT). */
export const locations: LocationDef[] = [
  {
    id: "loc_hq",
    code: "HQ",
    name: { en: "Head Office", bn: "প্রধান কার্যালয়" },
    kind: "hq",
    address: {
      en: "House 12, Road 55, Gulshan-2, Dhaka 1212",
      bn: "বাড়ি ১২, রোড ৫৫, গুলশান-২, ঢাকা ১২১২",
    },
    phone: "09612-345678",
    isStockLocation: false,
    bays: [],
  },
  {
    id: "loc_gul",
    code: "GUL",
    name: { en: "Gulshan Studio", bn: "গুলশান স্টুডিও" },
    kind: "studio",
    address: {
      en: "Plot 7, Road 103, Gulshan-2, Dhaka 1212",
      bn: "প্লট ৭, রোড ১০৩, গুলশান-২, ঢাকা ১২১২",
    },
    phone: "09612-345601",
    isStockLocation: true,
    bays: [
      { code: "W1", name: { en: "Wash bay 1", bn: "ওয়াশ বে ১" }, kind: "wash" },
      { code: "W2", name: { en: "Wash bay 2", bn: "ওয়াশ বে ২" }, kind: "wash" },
      { code: "D1", name: { en: "Detailing bay 1", bn: "ডিটেইলিং বে ১" }, kind: "detailing" },
      { code: "D2", name: { en: "Detailing bay 2", bn: "ডিটেইলিং বে ২" }, kind: "detailing" },
      { code: "D3", name: { en: "Detailing bay 3", bn: "ডিটেইলিং বে ৩" }, kind: "detailing" },
      { code: "C1", name: { en: "Coating booth", bn: "কোটিং বুথ" }, kind: "coating" },
    ],
  },
  {
    id: "loc_utt",
    code: "UTT",
    name: { en: "Uttara Studio", bn: "উত্তরা স্টুডিও" },
    kind: "studio",
    address: {
      en: "House 21, Road 14, Sector 7, Uttara, Dhaka 1230",
      bn: "বাড়ি ২১, রোড ১৪, সেক্টর ৭, উত্তরা, ঢাকা ১২৩০",
    },
    phone: "09612-345602",
    isStockLocation: true,
    bays: [
      { code: "W1", name: { en: "Wash bay 1", bn: "ওয়াশ বে ১" }, kind: "wash" },
      { code: "D1", name: { en: "Detailing bay 1", bn: "ডিটেইলিং বে ১" }, kind: "detailing" },
      { code: "D2", name: { en: "Detailing bay 2", bn: "ডিটেইলিং বে ২" }, kind: "detailing" },
      { code: "C1", name: { en: "Coating booth", bn: "কোটিং বুথ" }, kind: "coating" },
    ],
  },
  {
    id: "loc_cst",
    code: "CST",
    name: { en: "Central Store", bn: "কেন্দ্রীয় স্টোর" },
    kind: "store",
    address: {
      en: "Shed 4, Tejgaon Industrial Area, Dhaka 1208",
      bn: "শেড ৪, তেজগাঁও শিল্প এলাকা, ঢাকা ১২০৮",
    },
    phone: "09612-345603",
    isStockLocation: true,
    bays: [],
  },
]

export const LOCATION_CODES: LocationCode[] = ["HQ", "GUL", "UTT", "CST"]

export function getLocation(code: LocationCode): LocationDef {
  const location = locations.find((l) => l.code === code)
  if (!location) throw new Error(`Unknown location ${code}`)
  return location
}

export function locationById(id: string): LocationDef | undefined {
  return locations.find((l) => l.id === id)
}

/** Text printed under the tenant name on every document. */
export const printHeader = {
  line: {
    en: "VAT registered: BIN 000123456-0101",
    bn: "মূসক নিবন্ধিত: বিআইএন 000123456-0101",
  } satisfies Bilingual,
  /** Small print on Mushak forms (accounting_rules.md §4.4) */
  demoNote: {
    en: "Simplified layout for demonstration",
    bn: "প্রদর্শনের জন্য সরলীকৃত বিন্যাস",
  } satisfies Bilingual,
} as const

/**
 * Bangladesh fiscal year, July to June (D9). "2627" is FY 2026-27
 * (01-07-2026 to 30-06-2027). Takes a calendar day (YYYY-MM-DD).
 */
export function fiscalYearTag(isoDate: string): string {
  const start = fiscalYearStartYear(isoDate)
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`
}

/** Calendar year in which the fiscal year containing `isoDate` starts. */
export function fiscalYearStartYear(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  return month >= 7 ? year : year - 1
}

/** First and last day of the fiscal year containing `isoDate`. */
export function fiscalYearBounds(isoDate: string): {
  tag: string
  startsOn: string
  endsOn: string
} {
  const start = fiscalYearStartYear(isoDate)
  return {
    tag: fiscalYearTag(isoDate),
    startsOn: `${start}-07-01`,
    endsOn: `${start + 1}-06-30`,
  }
}
