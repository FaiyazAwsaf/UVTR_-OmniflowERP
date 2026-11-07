import type { OmniflowDb } from "@/core/db/database"
import { getSetting, readSetting } from "@/core/db/settings"
import type { Tx } from "@/core/engine/types"

import { buildCatalogue, type Catalogue } from "./pricing"

/** The pricing catalogue inside a commit (sees the commit's own writes). */
export async function loadCatalogue(tx: Tx): Promise<Catalogue> {
  const [services, variants, recipes, packages, addOns, items, priceLists, listLines, promotions, tax] = await Promise.all([
    tx.all("services"),
    tx.all("serviceVariants"),
    tx.all("serviceRecipes"),
    tx.all("packages"),
    tx.all("addOns"),
    tx.all("items"),
    tx.all("priceLists"),
    tx.all("priceListLines"),
    tx.all("promotions"),
    getSetting(tx, "tax"),
  ])
  return buildCatalogue({ services, variants, recipes, packages, addOns, items, priceLists, listLines, promotions, tax })
}

/** The pricing catalogue from committed data (live queries, dataset loaders). */
export async function readCatalogue(db: OmniflowDb): Promise<Catalogue> {
  const [services, variants, recipes, packages, addOns, items, priceLists, listLines, promotions, tax] = await Promise.all([
    db.services.toArray(),
    db.serviceVariants.toArray(),
    db.serviceRecipes.toArray(),
    db.packages.toArray(),
    db.addOns.toArray(),
    db.items.toArray(),
    db.priceLists.toArray(),
    db.priceListLines.toArray(),
    db.promotions.toArray(),
    readSetting(db, "tax"),
  ])
  return buildCatalogue({ services, variants, recipes, packages, addOns, items, priceLists, listLines, promotions, tax })
}
