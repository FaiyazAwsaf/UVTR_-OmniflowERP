import type { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { createDb, type OmniflowDb } from "@/core/db/database"
import type { AccountTag, Id } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import type { Actor, CommandDef } from "@/core/engine/types"
import { defaultPostingMap } from "@/core/ledger/chart"
import { seedDatabase } from "@/core/seed"

import { signedIn } from "../helpers/foundation"

/**
 * WS-SDM test helpers: a small-profile seeded database with the demo clock
 * at 10:30 Dhaka today (like the demo reset), signed-in actors, and book
 * checks (every journal balances, tags by party or location).
 */

let n = 0

export async function seededDb(prefix: string): Promise<OmniflowDb> {
  const today = dhakaDate(Date.now())
  const anchor = atDhaka(today, "10:30")
  applyClockOffset(anchor - Date.now())
  const db = createDb(`${prefix}-${++n}-${Math.random().toString(36).slice(2, 8)}`)
  await db.open()
  await seedDatabase(db, { now: now(), today, scale: "small" })
  return db
}

export function actors(db: OmniflowDb) {
  const cache = new Map<string, Actor>()
  return async (username: string): Promise<Actor> => {
    let actor = cache.get(username)
    if (!actor) {
      actor = await signedIn(db, username)
      cache.set(username, actor)
    }
    return actor
  }
}

export async function run<S extends z.ZodType, O>(db: OmniflowDb, actor: Actor, def: CommandDef<S, O>, input: z.input<S>): Promise<O> {
  return (await commit(def, input, { db, actor })).result
}

/** The rule code a command refuses with (or "ok", or the error kind). */
export async function refusal<S extends z.ZodType, O>(db: OmniflowDb, actor: Actor, def: CommandDef<S, O>, input: z.input<S>): Promise<string> {
  try {
    await commit(def, input, { db, actor })
    return "ok"
  } catch (error) {
    if (error instanceof RuleViolation) return error.code
    return (error as { kind?: string }).kind ?? String(error)
  }
}

export const MAP = defaultPostingMap()
export const acc = (tag: AccountTag): Id => MAP[tag]

/** Signed balance (debit positive) of a tag, optionally for a party or location. */
export async function balance(db: OmniflowDb, tag: AccountTag, opts: { partyId?: Id; locationId?: Id } = {}): Promise<number> {
  const lines = await db.journalLines.where("accountId").equals(acc(tag)).toArray()
  return lines
    .filter((l) => (!opts.partyId || l.partyId === opts.partyId) && (!opts.locationId || l.locationId === opts.locationId))
    .reduce((s, l) => s + l.debitP - l.creditP, 0)
}

/** Every journal balances and the trial balance ties. */
export async function booksTie(db: OmniflowDb): Promise<{ debit: number; credit: number; unbalanced: string[] }> {
  const lines = await db.journalLines.toArray()
  const byJournal = new Map<string, number>()
  let debit = 0
  let credit = 0
  for (const l of lines) {
    debit += l.debitP
    credit += l.creditP
    byJournal.set(l.journalId, (byJournal.get(l.journalId) ?? 0) + l.debitP - l.creditP)
  }
  return { debit, credit, unbalanced: [...byJournal].filter(([, v]) => v !== 0).map(([k]) => k) }
}

/** The journal posted for a source document and rule. */
export async function journalsOf(db: OmniflowDb, docId: Id) {
  return db.journals.where("source.docId").equals(docId).toArray()
}

/** Inventory GL of a location equals its stock value (per tag, through stockValues). */
export async function inventoryTies(db: OmniflowDb, locationId: Id): Promise<{ gl: number; stock: number }> {
  let gl = 0
  for (const tag of ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"] as const) gl += await balance(db, tag, { locationId })
  const values = await db.stockValues.where("locationId").equals(locationId).toArray()
  return { gl, stock: values.reduce((s, v) => s + v.valueP, 0) }
}

export const key = (label: string) => `test:${label}:${Math.random().toString(36).slice(2, 10)}`

/** Today's moment at a Dhaka time. */
export const todayAt = (hhmm: string) => atDhaka(dhakaDate(now()), hhmm)
