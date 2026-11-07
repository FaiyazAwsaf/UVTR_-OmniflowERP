import type { PartyRow, PartySegment, VehicleClass } from "@/core/db/schema"

/**
 * PAR pure helpers: segments, registration numbers in Latin and Bangla, the
 * default price list per segment and the credit fields only `par.credit.edit`
 * may set (plan §3.9).
 */

export const CUSTOMER_SEGMENTS: PartySegment[] = ["retail", "fleet", "corporate", "dealer", "walk-in"]
export const VENDOR_SEGMENTS: PartySegment[] = ["supplier", "service-provider", "landlord", "utility", "professional"]
export const ALL_SEGMENTS: PartySegment[] = [...CUSTOMER_SEGMENTS, ...VENDOR_SEGMENTS]

export const VEHICLE_CLASS_LIST: VehicleClass[] = ["HB", "SD", "SUV", "LSUV", "MPV"]

/** The published price list code a new customer takes by segment (seed_data §5). */
export function defaultPriceListCode(segment: PartySegment): "RETAIL" | "FLEET" | "DEALER" {
  if (segment === "fleet" || segment === "corporate") return "FLEET"
  if (segment === "dealer") return "DEALER"
  return "RETAIL"
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯"
const SERIES_BN: Record<string, string> = {
  KA: "ক",
  KHA: "খ",
  GA: "গ",
  GHA: "ঘ",
  CHA: "চ",
  CHHA: "ছ",
  JA: "জ",
  JHA: "ঝ",
  TA: "ত",
  THA: "থ",
  DA: "ড",
  DHA: "ঢ",
  NA: "ন",
  PA: "প",
  BA: "ব",
  BHA: "ভ",
  MA: "ম",
  LA: "ল",
  SA: "স",
  HA: "হ",
}
const CITY_BN: Record<string, string> = {
  "DHAKA METRO": "ঢাকা মেট্রো",
  "CHATTA METRO": "চট্ট মেট্রো",
  DHAKA: "ঢাকা",
  CHATTOGRAM: "চট্টগ্রাম",
}

/** "dhaka metro-ga 27-4419" → "DHAKA METRO-GA 27-4419" (Latin, single spaces, Latin digits). */
export function normalizeRegNo(text: string): string {
  return text
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim()
}

/** Bangla rendering of a Latin registration ("DHAKA METRO-GHA 15-7731" → "ঢাকা মেট্রো-ঘ ১৫-৭৭৩১"). */
export function regNoToBangla(regNo: string): string {
  const digits = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[Number(d)])
  const m = /^([A-Z ]+?)-([A-Z]+) (.+)$/.exec(regNo)
  if (!m) return digits(regNo)
  const city = CITY_BN[m[1].trim()] ?? m[1]
  const series = SERIES_BN[m[2]] ?? m[2]
  return `${city}-${series} ${digits(m[3])}`
}

/** Lower-case, Latin digits, no spaces or dashes, for registry search in either script. */
export function regSearchKey(text: string): string {
  return text
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .toLowerCase()
    .replace(/[\s\-.,/]/g, "")
}

/** The fields only a holder of `par.credit.edit` may set or change. */
export type CreditFields = Pick<PartyRow, "creditLimitP" | "priceListId" | "deductsVds" | "deductsAit"> & {
  /** Customer payment terms (a vendor's terms are a vendor field) */
  customerTermsDays: number
}

export function creditFieldsOf(p: Pick<PartyRow, "creditLimitP" | "priceListId" | "deductsVds" | "deductsAit" | "paymentTermsDays" | "isCustomer">): CreditFields {
  return {
    creditLimitP: p.creditLimitP,
    priceListId: p.priceListId,
    deductsVds: p.deductsVds,
    deductsAit: p.deductsAit,
    customerTermsDays: p.isCustomer ? p.paymentTermsDays : 0,
  }
}

export function sameCreditFields(a: CreditFields, b: CreditFields): boolean {
  return (
    a.creditLimitP === b.creditLimitP &&
    (a.priceListId ?? "") === (b.priceListId ?? "") &&
    a.deductsVds === b.deductsVds &&
    a.deductsAit === b.deductsAit &&
    a.customerTermsDays === b.customerTermsDays
  )
}

/** "On hold" and "blocked" both stop credit sales (INV-10). */
export function isHeld(p: Pick<PartyRow, "status">): boolean {
  return p.status !== "active"
}
