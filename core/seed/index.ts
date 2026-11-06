import type { OmniflowDb } from "@/core/db/database"
import type { CounterRow } from "@/core/db/schema"

import { createSeedCtx, type SeedBag, type SeedCtx } from "./context"
import { EventQueue } from "./engine/events"
import { World } from "./engine/world"
import { seedCashBankAccounts, seedChartOfAccounts } from "./generators/accounts"
import { seedBankStatements, seedYearEnd } from "./generators/bank"
import { seedCatalogue } from "./generators/catalogue"
import { resetChequeSerial, seedCreditDocs } from "./generators/credit-docs"
import { planCredit } from "./generators/credit-plan"
import { seedExpenses } from "./generators/expenses"
import { seedItemised } from "./generators/itemised"
import { seedOpening, seedSummaryStock } from "./generators/opening"
import { seedFiscalCalendar, seedOrganisation, seedSecurity } from "./generators/org"
import { seedParties } from "./generators/parties"
import { seedPayments } from "./generators/payments"
import { seedPlantedApprovals } from "./generators/planted"
import { seedPurchasing } from "./generators/purchasing"
import { seedReports } from "./generators/reports"
import { seedLoginHistory } from "./generators/security-history"
import { seedStock } from "./generators/stock"
import { seedSummary } from "./generators/summary"
import { seedBankCharges, seedTax } from "./generators/tax"
import { seedTodayBoard } from "./generators/today-board"
import { seedTreasury } from "./generators/treasury"
import type { SeedOptions, SeedSummary } from "./types"

/**
 * Seeds the central database with Automania's demo data (seed_data.md).
 * Deterministic for a given `opts` (every random stream derives from
 * "omniflow-seed-v1") and anchored to `opts.now` / `opts.today` (the demo
 * reset anchors it to 10:30 Dhaka today).
 *
 * Contract (./types.ts): rows are built with `seedRow()` (version 1, origin
 * central, created by "system" unless a history actor is recorded), counters
 * continue after the seeded history, and no events or audit rows are written.
 */
export async function seedDatabase(db: OmniflowDb, opts: SeedOptions): Promise<SeedSummary> {
  const started = performance.now()
  const { bag, counters } = buildSeed(opts)
  const built = performance.now()
  await writeBag(db, bag, counters)
  // Timing marks for the performance budget (seed_data.md §0: under 5 s in Chromium).
  performance.measure?.("seed:build", { start: started, end: built })
  performance.measure?.("seed:write", { start: built, end: performance.now() })

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

  const w = new World(ctx)
  resetChequeSerial()
  // Catalogue and parties.
  seedCatalogue(w)
  const parties = seedParties(w)
  // Sales: credit customers planned backwards from today; the itemised window and today's board.
  const credit = planCredit(w, parties.fleets)
  const q = new EventQueue()
  const itemised = seedItemised(w, q, parties, credit)
  seedTodayBoard(w, q, parties, itemised.d3Start)
  // History before the cutover; opening balances; stock plan and the summary that balances to it.
  const summary = seedSummary(w, credit)
  const opening = seedOpening(w, credit)
  const stock = seedStock(w, q, summary)
  const summaryStock = seedSummaryStock(w, summary, stock, opening)
  // Every stock move of the itemised window, in time order, with its journal.
  q.runAll()
  // Receivables, purchasing, expenses and payables.
  seedCreditDocs(w, credit, itemised.creditOrders, opening.invoices)
  const purchasing = seedPurchasing(w, stock)
  const expenses = seedExpenses(w)
  seedPayments(w, { opening: opening.bills, summary: summaryStock.bills, goods: purchasing.bills, hints: expenses.hints })
  seedPlantedApprovals(w)
  // Bank charges, tax, treasury, statements, the year-end close.
  seedBankCharges(w)
  seedTax(w)
  seedTreasury(w)
  seedBankStatements(w)
  seedYearEnd(w)
  // Security history and the IRT catalogue.
  seedLoginHistory(w)
  seedReports(w)

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
