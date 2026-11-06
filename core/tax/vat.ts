import type { TaxSettings, VatCategory } from "@/config/rules.config"
import type { Poisha } from "@/core/db/schema"

/**
 * VAT (plan §3.6, accounting_rules.md §4.1): per line, on the net, rounded
 * half up to the poisha; document totals are sums of the rounded lines
 * (INV-08). Prices are VAT exclusive. Rates are demo values from
 * `settings.tax` (CONFIRM: TAX ADVISOR).
 */

/** `amount × pct / 100`, rounded half up to the poisha, in exact integer math. */
export function percentOf(amountP: Poisha, pct: number): Poisha {
  const bp = Math.round(pct * 100) // basis points
  const sign = amountP < 0 ? -1 : 1
  return sign * Math.floor((Math.abs(amountP) * bp + 5_000) / 10_000)
}

export function vatRateOf(category: VatCategory, tax: TaxSettings): number {
  return tax.vatRates[category] ?? 0
}

export type VatLineIn = { netP: Poisha; vatCategory: VatCategory }
export type VatLineOut = { vatRatePct: number; vatP: Poisha }

/** VAT of each line, in order. */
export function vatForLines<T extends VatLineIn>(lines: T[], tax: TaxSettings): (T & VatLineOut)[] {
  return lines.map((line) => {
    const vatRatePct = vatRateOf(line.vatCategory, tax)
    return { ...line, vatRatePct, vatP: percentOf(line.netP, vatRatePct) }
  })
}

/**
 * Price one sales line: gross = qty × unit price (qty may be fractional for
 * goods sold by the unit, rounded to the poisha), net = gross − discount, VAT
 * on net, total = net + VAT.
 */
export function priceLine(input: {
  qty: number
  unitPriceP: Poisha
  discountP?: Poisha
  vatRatePct: number
}): { grossP: Poisha; discountP: Poisha; netP: Poisha; vatP: Poisha; totalP: Poisha } {
  const grossP = Math.round(input.qty * input.unitPriceP)
  const discountP = input.discountP ?? 0
  const netP = grossP - discountP
  const vatP = percentOf(netP, input.vatRatePct)
  return { grossP, discountP, netP, vatP, totalP: netP + vatP }
}

/**
 * Spread a discount percent over lines to the poisha, pro rata to their gross;
 * the last line takes the remainder so the sum is exact.
 */
export function spreadDiscount(grossPs: Poisha[], pct: number): Poisha[] {
  const total = grossPs.reduce((s, g) => s + g, 0)
  const discount = percentOf(total, pct)
  return spreadAmount(grossPs, discount)
}

/** Spread an amount pro rata over weights, last part takes the remainder (packages, discounts). */
export function spreadAmount(weights: Poisha[], amountP: Poisha): Poisha[] {
  const total = weights.reduce((s, w) => s + w, 0)
  if (!weights.length) return []
  if (total === 0) return weights.map((_, i) => (i === weights.length - 1 ? amountP : 0))
  let used = 0
  return weights.map((w, i) => {
    if (i === weights.length - 1) return amountP - used
    const part = Math.round((amountP * w) / total)
    used += part
    return part
  })
}
