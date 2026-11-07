import { expect } from "vitest"
import type { z } from "zod"

import { applyClockOffset } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { decideApproval } from "@/core/approvals/decide"
import { createDb, type OmniflowDb } from "@/core/db/database"
import type { AccountTag, Id, InventoryTag, JournalRow } from "@/core/db/schema"
import { readSetting } from "@/core/db/settings"
import { commit } from "@/core/engine/commit"
import type { Actor, CommandDef } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { dhakaAt } from "@/core/seed/time"

import { signedIn } from "../helpers/foundation"

/**
 * Test kit for the SCM suites (PTL, PM, GRN, ST, IC): a small seeded
 * database with the demo clock at 10:31 Dhaka today (tests/setup.ts shifts
 * or pins today), signed-in actors, commits, approvals and the stock tie.
 */

export type ScmDb = { db: OmniflowDb; today: string; actors: Map<string, Actor> }

let n = 0

/** A fresh small seed for "today" on the test clock; the demo clock runs from 10:31. */
export async function scmDb(prefix = "scm"): Promise<ScmDb> {
  const today = dhakaDate(Date.now())
  applyClockOffset(dhakaAt(today, "10:31") - Date.now())
  const db = createDb(`${prefix}-${++n}-${Math.random().toString(36).slice(2, 8)}`)
  await db.open()
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
  return { db, today, actors: new Map() }
}

/** The actor for a seeded user (signed in once per database). */
export async function as(s: ScmDb, username: string, locationId?: Id): Promise<Actor> {
  const key = `${username}:${locationId ?? ""}`
  let actor = s.actors.get(key)
  if (!actor) {
    actor = await signedIn(s.db, username, locationId)
    s.actors.set(key, actor)
  }
  return actor
}

/** Commit a command as a user; returns its result. */
export async function run<S extends z.ZodType, O>(s: ScmDb, def: CommandDef<S, O>, input: z.input<S>, username: string, locationId?: Id): Promise<O> {
  const actor = await as(s, username, locationId)
  return (await commit(def, input, { db: s.db, actor })).result
}

/** Expect a command to be refused with a rule code. */
export async function refused<S extends z.ZodType, O>(
  s: ScmDb,
  def: CommandDef<S, O>,
  input: z.input<S>,
  username: string,
  code: string,
  locationId?: Id
): Promise<void> {
  let caught: unknown
  try {
    await run(s, def, input, username, locationId)
  } catch (error) {
    caught = error
  }
  expect(caught, `${def.name} should be refused with ${code}`).toBeDefined()
  // RuleViolation carries a code; PermissionDenied is "DENIED"; other engine errors their kind.
  const e = caught as { code?: string; kind?: string; message?: string }
  const got = e.code ?? (e.kind === "denied" ? "DENIED" : (e.kind ?? e.message))
  expect(got).toBe(code)
}

/** Decide a pending approval as a user. */
export async function decide(s: ScmDb, approvalId: Id, username: string, decision: "approve" | "reject" = "approve", reason = "ok") {
  const approval = await s.db.approvals.get(approvalId)
  if (!approval) throw new Error(`no approval ${approvalId}`)
  return run(s, decideApproval, { approvalId, decision, reason, expectedVersion: approval.version }, username)
}

/** A journal with its lines resolved to tags (signed: debit positive). */
export async function journalByTag(s: ScmDb, journalId: Id) {
  const journal = (await s.db.journals.get(journalId)) as JournalRow
  const map = await readSetting(s.db, "postingAccounts")
  const tagOf = new Map<Id, AccountTag>(Object.entries(map).map(([tag, id]) => [id, tag as AccountTag]))
  const lines = await s.db.journalLines.where("journalId").equals(journalId).toArray()
  const byTag = new Map<string, number>()
  let debit = 0
  let credit = 0
  for (const l of lines) {
    const tag = tagOf.get(l.accountId) ?? l.accountId
    byTag.set(tag, (byTag.get(tag) ?? 0) + l.debitP - l.creditP)
    debit += l.debitP
    credit += l.creditP
  }
  return { journal, lines, byTag, debit, credit, tagOf }
}

/**
 * The stock tie (plan §3.5): the inventory GL per tag and location equals
 * Σ stockValues of that tag's items at that location; INV_TRANSIT equals the
 * value of dispatched, not yet received transfer lines.
 */
export async function expectStockTies(s: ScmDb): Promise<void> {
  const map = await readSetting(s.db, "postingAccounts")
  const tags: InventoryTag[] = ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"]
  const accountTag = new Map<Id, string>()
  for (const tag of [...tags, "INV_TRANSIT"] as AccountTag[]) accountTag.set(map[tag], tag)
  const gl = new Map<string, number>()
  let transitGl = 0
  await s.db.journalLines.each((l) => {
    const tag = accountTag.get(l.accountId)
    if (!tag) return
    if (tag === "INV_TRANSIT") transitGl += l.debitP - l.creditP
    else gl.set(`${tag}:${l.locationId}`, (gl.get(`${tag}:${l.locationId}`) ?? 0) + l.debitP - l.creditP)
  })
  const items = new Map((await s.db.items.toArray()).map((i) => [i.id, i]))
  const categories = new Map((await s.db.itemCategories.toArray()).map((c) => [c.id, c]))
  const stock = new Map<string, number>()
  for (const v of await s.db.stockValues.toArray()) {
    const tag = categories.get(items.get(v.itemId)!.categoryId)!.inventoryTag
    stock.set(`${tag}:${v.locationId}`, (stock.get(`${tag}:${v.locationId}`) ?? 0) + v.valueP)
  }
  for (const key of new Set([...gl.keys(), ...stock.keys()])) {
    expect(gl.get(key) ?? 0, `inventory GL ${key}`).toBe(stock.get(key) ?? 0)
  }
  let transit = 0
  for (const t of await s.db.transfers.where("status").equals("dispatched").toArray()) {
    for (const l of await s.db.transferLines.where("transferId").equals(t.id).toArray()) transit += l.valueP
  }
  expect(transitGl, "INV_TRANSIT").toBe(transit)
  // Stock values never carry a value without a quantity, nor go negative.
  for (const v of await s.db.stockValues.toArray()) {
    expect(v.qtyBase).toBeGreaterThanOrEqual(0)
    expect(v.valueP).toBeGreaterThanOrEqual(0)
    if (v.qtyBase === 0) expect(v.valueP).toBe(0)
  }
}

/** Every journal posted after `since` balances. */
export async function expectBalanced(s: ScmDb, journalId: Id) {
  const j = await journalByTag(s, journalId)
  expect(j.debit).toBe(j.credit)
  expect(j.debit).toBeGreaterThan(0)
  expect(j.journal.status).toBe("posted")
  return j
}
