import type { TaxSettings, VendorTaxCategory } from "@/config/rules.config"
import type { Poisha } from "@/core/db/schema"

import { percentOf } from "./vat"

/**
 * Withholding (plan §3.6, accounting_rules.md §4.2, §4.3). Demo values,
 * CONFIRM: TAX ADVISOR; thresholds are off.
 */

export type BillShare = {
  /** What this payment allocates to the bill (VAT inclusive) */
  allocatedP: Poisha
  /** The bill's VAT-exclusive value, VAT and total */
  billNetP: Poisha
  billVatP: Poisha
  billTotalP: Poisha
}

export type Withholding = {
  /** AIT (TDS) on the VAT-exclusive value paid */
  aitP: Poisha
  /** VDS: the VAT on the value paid, for VDS categories */
  vdsP: Poisha
  /** Cash that leaves: gross − AIT − VDS */
  netPaidP: Poisha
}

/** The VAT-exclusive and VAT parts of an allocation, pro rata to the bill. */
export function splitAllocation(share: BillShare): { exclusiveP: Poisha; vatP: Poisha } {
  if (share.billTotalP <= 0) return { exclusiveP: share.allocatedP, vatP: 0 }
  const vatP =
    share.allocatedP === share.billTotalP
      ? share.billVatP
      : Math.round((share.allocatedP * share.billVatP) / share.billTotalP)
  return { exclusiveP: share.allocatedP - vatP, vatP }
}

/**
 * AIT and VDS Automania deducts on a vendor payment (R15), summed over the
 * bills it pays. Example (E6): security bill ৳60,000 + VAT ৳9,000, paid in
 * full: AIT 10% ৳6,000, VDS ৳9,000, cash ৳54,000.
 */
export function withholdingFor(
  category: VendorTaxCategory | undefined,
  shares: BillShare[],
  tax: TaxSettings
): Withholding {
  const rule = tax.withholding[category ?? "exempt"]
  let aitP = 0
  let vdsP = 0
  let grossP = 0
  for (const share of shares) {
    const { exclusiveP, vatP } = splitAllocation(share)
    grossP += share.allocatedP
    aitP += percentOf(exclusiveP, rule.aitPct)
    if (rule.vds) vdsP += vatP
  }
  return { aitP, vdsP, netPaidP: grossP - aitP - vdsP }
}

export type InvoiceShare = {
  allocatedP: Poisha
  invoiceVatP: Poisha
  invoiceTotalP: Poisha
}

/**
 * VDS and AIT a corporate customer deducts on a receipt (R8, R10): VDS = the
 * VAT on the allocated value (100% of it), AIT = 5% of the VAT-exclusive
 * value; proposed on the receipt, editable.
 */
export function customerDeductions(
  party: { deductsVds: boolean; deductsAit: boolean },
  shares: InvoiceShare[],
  tax: TaxSettings
): { vdsP: Poisha; aitP: Poisha } {
  let vdsP = 0
  let aitP = 0
  for (const share of shares) {
    const vatP =
      share.invoiceTotalP <= 0
        ? 0
        : share.allocatedP === share.invoiceTotalP
          ? share.invoiceVatP
          : Math.round((share.allocatedP * share.invoiceVatP) / share.invoiceTotalP)
    if (party.deductsVds) vdsP += percentOf(vatP, tax.customerDeductions.vdsPctOfVat)
    if (party.deductsAit) aitP += percentOf(share.allocatedP - vatP, tax.customerDeductions.aitPct)
  }
  return { vdsP, aitP }
}
