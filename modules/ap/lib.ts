import type { MatchDiff, Poisha } from "@/core/db/schema"
import { percentOf } from "@/core/tax/vat"

/**
 * AP pure helpers: the three-way match of a bill line against its PO and
 * GRN (plan §6.2: quantity exact against accepted, not returned and not yet
 * billed; price within `rules.threeWayMatch.priceTolerancePct`), and the
 * R13 split of a goods line into GRNI at the PO price and the difference to
 * PPV.
 */

export type MatchInput = {
  poLineId?: string
  itemId?: string
  /** Accepted − returned − billed − held on other bills (purchase units) */
  availableQty: number
  /** PO price per purchase unit */
  poPriceP: Poisha
  billQty: number
  billPriceP: Poisha
}

/** Price difference in percent of the PO price (positive when the bill is dearer). */
export function priceDiffPct(poPriceP: Poisha, billPriceP: Poisha): number {
  if (poPriceP <= 0) return billPriceP > 0 ? 100 : 0
  return Math.round(((billPriceP - poPriceP) / poPriceP) * 10_000) / 100
}

const QTY_EPS = 1e-9

/** The diffs of one line (empty when it matches). */
export function matchLine(l: MatchInput, tolerancePct: number): MatchDiff[] {
  const diffs: MatchDiff[] = []
  if (Math.abs(l.billQty - l.availableQty) > QTY_EPS) {
    diffs.push({ poLineId: l.poLineId, itemId: l.itemId, field: "qty", expected: l.availableQty, actual: l.billQty })
  }
  const pct = priceDiffPct(l.poPriceP, l.billPriceP)
  if (Math.abs(pct) > tolerancePct + 1e-9) {
    diffs.push({ poLineId: l.poLineId, itemId: l.itemId, field: "price", expected: l.poPriceP, actual: l.billPriceP, diffPct: pct })
  }
  return diffs
}

export type GoodsLineValues = { netP: Poisha; vatP: Poisha; grniP: Poisha; ppvP: Poisha }

/** Values of a goods bill line: net at the bill price, VAT on net, GRNI at the PO price, PPV the rest. */
export function goodsLineValues(qty: number, billPriceP: Poisha, poPriceP: Poisha, vatRatePct: number): GoodsLineValues {
  const netP = Math.round(qty * billPriceP)
  const grniP = Math.round(qty * poPriceP)
  return { netP, vatP: percentOf(netP, vatRatePct), grniP, ppvP: netP - grniP }
}
