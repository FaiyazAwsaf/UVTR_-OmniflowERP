"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"

import { readCatalogue } from "./catalogue"
import type { Catalogue } from "./pricing"

/**
 * PC live queries. The pricing catalogue re-reads whenever services,
 * variants, recipes, packages, add-ons, items, price lists or promotions
 * change in any window, so prices on screen follow a publish at once.
 */
export function useCatalogue(): Catalogue | undefined {
  const db = useDb()
  return useLiveQuery(() => readCatalogue(db), [db])
}
