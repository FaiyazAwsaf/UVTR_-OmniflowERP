"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { invoiceOpen } from "@/core/ar/receipt"
import type { OmniflowDb } from "@/core/db/database"
import { useDb } from "@/core/db/DbProvider"
import { readSetting } from "@/core/db/settings"
import type { Id, Poisha } from "@/core/db/schema"

/**
 * SI live queries: a party's open customer advance (the CUSTOMER_ADVANCE
 * subledger, what R6 applies at invoicing) and its exposure on open
 * invoices (what the credit check INV-10 compares with the limit).
 */

export async function readPartyAdvance(db: OmniflowDb, partyId: Id): Promise<Poisha> {
  const map = await readSetting(db, "postingAccounts")
  const account = map.CUSTOMER_ADVANCE
  const lines = await db.journalLines.where("partyId").equals(partyId).toArray()
  return lines.filter((l) => l.accountId === account).reduce((s, l) => s + l.creditP - l.debitP, 0)
}

export async function readPartyExposure(db: OmniflowDb, partyId: Id): Promise<Poisha> {
  const invoices = await db.salesInvoices.where("partyId").equals(partyId).toArray()
  return invoices.reduce((s, i) => s + invoiceOpen(i), 0)
}

/** Live: a party's open advance and exposure (undefined while loading). */
export function usePartyBalances(partyId: Id | null | undefined): { advanceP: Poisha; exposureP: Poisha } | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!partyId) return { advanceP: 0, exposureP: 0 }
    const [advanceP, exposureP] = await Promise.all([readPartyAdvance(db, partyId), readPartyExposure(db, partyId)])
    return { advanceP: Math.max(0, advanceP), exposureP }
  }, [db, partyId])
}
