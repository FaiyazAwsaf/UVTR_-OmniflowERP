import type { ItemRow, Poisha, VehicleClass } from "@/core/db/schema"

/**
 * Stock math (plan §3.5), pure. Quantities in the item's base unit; moving
 * average per item and location held as `valueP / qtyBase` (never rounded or
 * stored).
 */

/**
 * The value an issue of `qty` base units takes from a location holding
 * `onHandQty` worth `onHandValueP`: `round(q × value / qty)` half up, and the
 * issue that empties the location takes exactly the remaining value.
 */
export function issueValue(qty: number, onHandQty: number, onHandValueP: Poisha): Poisha {
  if (qty <= 0) return 0
  if (qty >= onHandQty) return onHandValueP
  return Math.round((qty * onHandValueP) / onHandQty)
}

/** Average cost per base unit (display only; never stored). */
export function averageCost(qty: number, valueP: Poisha): number {
  return qty > 0 ? valueP / qty : 0
}

/** Value of a receipt: accepted purchase-unit qty × unit cost, or base qty × cost per base unit. */
export function receiptValue(qtyPurchase: number, unitCostP: Poisha): Poisha {
  return Math.round(qtyPurchase * unitCostP)
}

/** Standard cost of `qtyBase` base units of an item (standard cost is per purchase unit). */
export function standardValue(item: Pick<ItemRow, "standardCostP" | "purchaseFactor">, qtyBase: number): Poisha {
  return Math.round((qtyBase * item.standardCostP) / item.purchaseFactor)
}

/** Recipe class factors on the sedan recipe (seed_data.md §3.1). */
export const CLASS_FACTORS: Record<VehicleClass, number> = {
  HB: 0.85,
  SD: 1,
  SUV: 1.25,
  LSUV: 1.5,
  MPV: 1.5,
}

/**
 * Recipe quantity scaled by vehicle class: whole ml or g, and 0.05 pc or
 * roll, rounded half up (plan §3.5). E3: ceramic 2-year 30 ml × 1.25 = 38 ml.
 */
export function scaleRecipeQty(sedanQty: number, vehicleClass: VehicleClass, baseUom: string): number {
  const raw = sedanQty * CLASS_FACTORS[vehicleClass]
  if (baseUom === "pc" || baseUom === "roll") {
    return Math.round(raw * 20 + 1e-9) / 20
  }
  return Math.round(raw + 1e-9)
}

/** Base units of a quantity in the item's purchase or sales unit. */
export function toBaseQty(
  item: Pick<ItemRow, "purchaseFactor" | "salesFactor">,
  qty: number,
  unit: "base" | "purchase" | "sales"
): number {
  if (unit === "purchase") return qty * item.purchaseFactor
  if (unit === "sales") return qty * (item.salesFactor ?? 1)
  return qty
}

/** Round a base quantity for display or storage (avoids 0.30000000000000004). */
export function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000
}
