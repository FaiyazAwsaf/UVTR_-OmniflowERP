"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { Id, Poisha } from "@/core/db/schema"

import { readPartyAdvance, readPartyExposure } from "./balances"

/**
 * SI live queries: a party's open customer advance and its exposure on open
 * invoices (readers in balances.ts).
 */

export { readPartyAdvance, readPartyExposure }

/** Live: a party's open advance and exposure (undefined while loading). */
export function usePartyBalances(partyId: Id | null | undefined): { advanceP: Poisha; exposureP: Poisha } | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!partyId) return { advanceP: 0, exposureP: 0 }
    const [advanceP, exposureP] = await Promise.all([readPartyAdvance(db, partyId), readPartyExposure(db, partyId)])
    return { advanceP: Math.max(0, advanceP), exposureP }
  }, [db, partyId])
}
