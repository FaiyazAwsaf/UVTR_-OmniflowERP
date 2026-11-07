import type { z } from "zod"

import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { createDb, type OmniflowDb } from "@/core/db/database"
import type { AccountTag, Id, JournalLineRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import type { Actor, CommandDef } from "@/core/engine/types"
import { trialBalance, type AccountInfo } from "@/core/ledger/statements"
import { seedDatabase } from "@/core/seed"
import { dhakaAt } from "@/core/seed/time"

import { signedIn } from "../helpers/foundation"

/**
 * FA and FRS command tests run on the small seed profile (same fixed ids,
 * planted states and closed months as the demo), anchored at 10:30 Dhaka
 * today on the test clock (TEST_DATE / TEST_DAY_SHIFT apply).
 */

let counter = 0

export type Books = {
  db: OmniflowDb
  today: string
  /** YYYY-MM of the current month and of last month */
  thisMonth: string
  lastMonth: string
  /** A day in last month (its 10th, or its last day if that is earlier than today) */
  lastMonthDay: string
  as: (username: string) => Promise<Actor>
  run: <S extends z.ZodType, O>(def: CommandDef<S, O>, input: z.input<S>, username: string) => Promise<O>
  /** The posting map's account id for a tag */
  acc: (tag: AccountTag) => Promise<Id>
}

export async function seededBooks(prefix: string): Promise<Books> {
  const db = createDb(`${prefix}-${++counter}-${Math.random().toString(36).slice(2, 8)}`)
  await db.open()
  const today = dhakaDate(now())
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
  const actors = new Map<string, Actor>()
  const as = async (username: string) => {
    let actor = actors.get(username)
    if (!actor) {
      actor = await signedIn(db, username)
      actors.set(username, actor)
    }
    return actor
  }
  const thisMonth = today.slice(0, 7)
  const lastMonthStart = addDaysISO(`${thisMonth}-01`, -1).slice(0, 7)
  return {
    db,
    today,
    thisMonth,
    lastMonth: lastMonthStart,
    lastMonthDay: `${lastMonthStart}-10`,
    as,
    async run(def, input, username) {
      return (await commit(def, input, { db, actor: await as(username) })).result
    },
    async acc(tag) {
      const row = await db.settings.get("postingAccounts")
      return (row!.value as Record<AccountTag, Id>)[tag]
    },
  }
}

/** The chart as statement account info. */
export async function accountInfos(db: OmniflowDb): Promise<AccountInfo[]> {
  return db.accounts.toArray()
}

/** Every posted line, and whether the trial balance ties. */
export async function booksTie(db: OmniflowDb): Promise<{ balanced: boolean; lines: JournalLineRow[] }> {
  const lines = await db.journalLines.toArray()
  const tb = trialBalance(await accountInfos(db), lines, { from: "0000-01-01", to: "9999-12-31" })
  return { balanced: tb.balanced && tb.totalDebitP === tb.totalCreditP, lines }
}

/** Debit-positive balance of an account's lines in one journal. */
export function sumJournal(lines: JournalLineRow[], journalId: Id): { debitP: number; creditP: number } {
  let debitP = 0
  let creditP = 0
  for (const l of lines) {
    if (l.journalId !== journalId) continue
    debitP += l.debitP
    creditP += l.creditP
  }
  return { debitP, creditP }
}

/** The rule code an error carries (RuleViolation.code, or "PERMISSION_DENIED"). */
export async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const e = error as { code?: string; kind?: string }
    if (e.kind === "denied") return "PERMISSION_DENIED"
    if (e.kind === "conflict") return "CONFLICT"
    return e.code ?? String(error)
  }
  return "NO_ERROR"
}

let keySeq = 0
export const key = () => `k-${Date.now()}-${++keySeq}`
