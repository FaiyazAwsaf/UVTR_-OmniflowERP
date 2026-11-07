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
 * WS-Dash test helpers: a small-profile seeded database with the demo clock
 * at 10:30 Dhaka today (like a demo reset), signed-in actors, commands,
 * GL balances by tag and the trial balance check.
 */

let n = 0

export async function seededDb(prefix: string): Promise<OmniflowDb> {
  const today = dhakaDate(Date.now())
  applyClockOffset(atDhaka(today, "10:30") - Date.now())
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

/** Runs a command expected to be refused and returns the refusal (code and params). */
export async function refused<S extends z.ZodType, O>(db: OmniflowDb, actor: Actor, def: CommandDef<S, O>, input: z.input<S>): Promise<RuleViolation> {
  try {
    await commit(def, input, { db, actor })
  } catch (error) {
    if (error instanceof RuleViolation) return error
    throw error
  }
  throw new Error("expected a refusal")
}

const MAP = defaultPostingMap()

/** Signed GL balance (debit positive) of a tag up to a day, optionally at a location. */
export async function gl(db: OmniflowDb, tag: AccountTag, opts: { upTo?: string; locationId?: Id } = {}): Promise<number> {
  const lines = await db.journalLines.where("accountId").equals(MAP[tag]).toArray()
  return lines.filter((l) => (!opts.upTo || l.date <= opts.upTo) && (!opts.locationId || l.locationId === opts.locationId)).reduce((s, l) => s + l.debitP - l.creditP, 0)
}

/** Total debits equal total credits and every journal balances. */
export async function trialBalanceTies(db: OmniflowDb): Promise<boolean> {
  const lines = await db.journalLines.toArray()
  const byJournal = new Map<string, number>()
  let debit = 0
  let credit = 0
  for (const l of lines) {
    debit += l.debitP
    credit += l.creditP
    byJournal.set(l.journalId, (byJournal.get(l.journalId) ?? 0) + l.debitP - l.creditP)
  }
  return debit === credit && [...byJournal.values()].every((v) => v === 0)
}

export const key = (label: string) => `dash:${label}:${Math.random().toString(36).slice(2, 10)}`

export const today = () => dhakaDate(now())
