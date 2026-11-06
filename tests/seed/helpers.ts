import { dhakaDate } from "@/core/clock/dates"
import type { AccountTag, Id, JournalLineRow } from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"
import { accountIdOf, CHART, defaultPostingMap } from "@/core/ledger/chart"
import type { AccountInfo } from "@/core/ledger/statements"
import { buildSeed } from "@/core/seed"
import type { SeedBag } from "@/core/seed/context"
import { dhakaAt } from "@/core/seed/time"

/**
 * Seed tests build the seed in memory for "today" on the test clock
 * (tests/setup.ts: TEST_DATE pins it, TEST_DAY_SHIFT shifts it), anchored at
 * 10:30 Dhaka like the demo reset, once per profile per test file.
 */

export function seedToday(): string {
  return dhakaDate(Date.now())
}

type Built = { bag: SeedBag; counters: { id: string; value: number }[]; today: string; ms: number }
const cache = new Map<string, Built>()

export function built(scale: "full" | "small" = "full"): Built {
  const today = seedToday()
  const key = `${scale}:${today}`
  let b = cache.get(key)
  if (!b) {
    const t0 = performance.now()
    const out = buildSeed({ now: dhakaAt(today, "10:30"), today, scale })
    b = { ...out, today, ms: performance.now() - t0 }
    cache.set(key, b)
  }
  return b
}

export const rows = <T extends TableName>(bag: SeedBag, table: T): Row<T>[] => bag.all(table)

export const MAP = defaultPostingMap()
export const acc = (tag: AccountTag): Id => MAP[tag]

export function accountsInfo(): AccountInfo[] {
  return CHART.map((c) => ({
    id: accountIdOf(c.code),
    code: c.code,
    nameEn: c.nameEn,
    nameBn: c.nameBn,
    type: c.type,
    parentId: c.parent ? accountIdOf(c.parent) : undefined,
    isGroup: !!c.group,
    normalSide: (c.type === "asset" || c.type === "expense") !== !!c.contra ? "debit" : "credit",
    tag: c.tag,
    isControl: !!c.control,
  }))
}

/** Signed GL balance (debit positive) of a tag, optionally by party or location, up to a day. */
export function gl(lines: JournalLineRow[], tag: AccountTag, opts: { partyId?: Id; locationId?: Id; upTo?: string; before?: string } = {}): number {
  const id = acc(tag)
  let sum = 0
  for (const l of lines) {
    if (l.accountId !== id) continue
    if (opts.partyId !== undefined && l.partyId !== opts.partyId) continue
    if (opts.locationId !== undefined && l.locationId !== opts.locationId) continue
    if (opts.upTo && l.date > opts.upTo) continue
    if (opts.before && l.date >= opts.before) continue
    sum += l.debitP - l.creditP
  }
  return sum
}

/** Every string inside a value (for text scans). */
export function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value
  else if (Array.isArray(value)) for (const v of value) yield* strings(v)
  else if (value && typeof value === "object") for (const v of Object.values(value)) yield* strings(v)
}
