/**
 * Business-rule thresholds (implementation_plan.md §3.16). Every value is a
 * demo starting point marked CONFIRM: CLIENT (or CONFIRM: TAX ADVISOR for tax),
 * not a constant: the seed copies them into `settings`, where FA and SAC edit
 * them. Money is integer poisha (৳1 = 100), hence the `P` suffix.
 */

export type VatCategory =
  | "standard"
  | "reduced-10"
  | "reduced-7.5"
  | "reduced-5"
  | "exempt"

export type VendorTaxCategory =
  | "goods"
  | "services"
  | "rent"
  | "professional"
  | "utility"
  | "exempt"

export type TaxSettings = {
  /** VAT rate per category, in percent (accounting_rules.md §4.1) */
  vatRates: Record<VatCategory, number>
  /** AIT (TDS) percent on the VAT-exclusive value paid, and whether VDS is withheld (§4.2) */
  withholding: Record<VendorTaxCategory, { aitPct: number; vds: boolean }>
  /** Deductions by corporate customers (§4.3) */
  customerDeductions: { vdsPctOfVat: number; aitPct: number }
  /** Withholding thresholds are off in the demo (CONFIRM) */
  thresholdsEnabled: boolean
}

/** CONFIRM: TAX ADVISOR. Demo values, labelled as such wherever they are edited. */
export const defaultTaxSettings: TaxSettings = {
  vatRates: {
    standard: 15,
    "reduced-10": 10,
    "reduced-7.5": 7.5,
    "reduced-5": 5,
    exempt: 0,
  },
  withholding: {
    goods: { aitPct: 3, vds: false },
    services: { aitPct: 10, vds: true },
    rent: { aitPct: 5, vds: true },
    professional: { aitPct: 10, vds: true },
    utility: { aitPct: 0, vds: false },
    exempt: { aitPct: 0, vds: false },
  },
  customerDeductions: { vdsPctOfVat: 100, aitPct: 5 },
  thresholdsEnabled: false,
}

export const rules = {
  /** Standard VAT rate in percent (CONFIRM: TAX ADVISOR) */
  vatStandardPct: 15,
  tax: defaultTaxSettings,

  /** Three-way match: quantity exact, price within 2% (objective AP) */
  threeWayMatch: { quantityTolerance: 0, priceTolerancePct: 2 },

  /** A party with an invoice this many days past due goes on hold once (ar.creditHold) */
  creditHoldOverdueDays: 60,
  /** A pending bKash or Nagad receipt times out after this many demo minutes (si.mfsTimeout) */
  mfsPendingTimeoutMin: 15,
  /** Batches expiring within this many days raise ExpiryAlert (ic.expiryWatch) */
  expiryWarnDays: 60,
  /** Post-dated cheques due within this many days raise a notice (cab.pdcDue) */
  pdcWarnDays: 3,
  /** Quotation validity in days */
  quoteValidityDays: 7,
  /** Bank reconciliation auto-match window in days */
  reconMatchDays: 3,

  /** Security policy defaults (seed_data.md §2.4); SAC edits them in `settings.security` */
  lockoutThreshold: 5,
  idleTimeoutMin: 480,
  passwordMinLength: 8,
  passwordExpiryDays: 90,

  /** Simulated secrets for the demo (never real) */
  supervisorPin: "1234",
  mfaCode: "123456",
  demoPassword: "demo1234",

  /** Reset starts the demo clock at this Dhaka time so the studios are mid-morning */
  openingTime: "10:30",
  /** Studio opening hours (seed scheduling) */
  studioHours: { open: "09:00", close: "21:00" },

  /** Card and MFS merchant fees in percent (seed treasury; CONFIRM: CLIENT) */
  merchantFeesPct: { card: 1.5, bkash: 1.0, nagad: 0.9 },
} as const

export type Rules = typeof rules
