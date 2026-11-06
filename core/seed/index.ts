import type { OmniflowDb } from "@/core/db/database"
import type { CounterRow } from "@/core/db/schema"

import { createSeedCtx, type SeedBag, type SeedCtx } from "./context"
import { seedCashBankAccounts, seedChartOfAccounts } from "./generators/accounts"
import { seedFiscalCalendar, seedOrganisation, seedSecurity } from "./generators/org"
import type { SeedOptions, SeedSummary } from "./types"

/**
 * Seeds the central database with Automania's demo data (seed_data.md).
 * Deterministic for a given `opts` (every random stream derives from
 * "omniflow-seed-v1") and anchored to `opts.now` / `opts.today`.
 *
 * Contract (./types.ts): rows are built with `seedRow()` (version 1, origin
 * central, created by "system" unless a history actor is recorded), counters
 * continue after the seeded history, and no events or audit rows are written.
 */
export async function seedDatabase(db: OmniflowDb, opts: SeedOptions): Promise<SeedSummary> {
  const started = performance.now()
  const { bag, counters } = buildSeed(opts)
  await writeBag(db, bag, counters)

  const counts: Record<string, number> = {}
  for (const name of bag.tableNames()) counts[name] = bag.count(name)
  counts.counters = counters.length
  return { counts, durationMs: Math.round(performance.now() - started) }
}

/** Builds every seed row in memory (no IndexedDB access). */
export function buildSeed(opts: SeedOptions): { bag: SeedBag; counters: CounterRow[] } {
  const ctx = createSeedCtx(opts)

  // Foundation (main agent): organisation, calendar, security, chart, cash and bank.
  seedFoundationInto(ctx)

  const counters = ctx.numbers.finalize(() => 0)
  return { bag: ctx.bag, counters }
}

/**
 * Only the foundation (organisation, fiscal calendar, security): what core
 * engine and security tests need without the business history. Kept by
 * WS-Seed as a stable entry point.
 */
export async function seedFoundation(db: OmniflowDb, opts: SeedOptions): Promise<void> {
  const ctx = createSeedCtx(opts)
  seedFoundationInto(ctx)
  await writeBag(db, ctx.bag, ctx.numbers.finalize(() => 0))
}

/** The foundation generators, in order (organisation, calendar, security, chart, cash and bank). */
export function seedFoundationInto(ctx: SeedCtx): void {
  seedOrganisation(ctx)
  seedFiscalCalendar(ctx)
  seedSecurity(ctx)
  seedChartOfAccounts(ctx)
  seedCashBankAccounts(ctx)
}

async function writeBag(db: OmniflowDb, bag: SeedBag, counters: CounterRow[]): Promise<void> {
  const names = bag.tableNames()
  await db.transaction("rw", [...names.map((n) => db.table(n)), db.counters], async () => {
    await Promise.all(names.map((n) => db.table(n).bulkPut(bag.all(n))))
    await db.counters.bulkPut(counters)
  })
}
