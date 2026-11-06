import { describe, expect, it } from "vitest"

import { createDb } from "@/core/db/database"
import { buildSeed, seedDatabase } from "@/core/seed"
import { dhakaAt } from "@/core/seed/time"

import { seedToday } from "./helpers"

/**
 * seedDatabase writes every table in one bulk transaction (fake-indexeddb in
 * tests; Chromium in the app). The in-memory build must stay well under the
 * 5 s budget; fake-indexeddb writes are much slower than Chromium's, so the
 * write is only timed and reported here (the Chromium figure comes from e2e).
 */
describe("seedDatabase", () => {
  for (const scale of ["small", "full"] as const) {
    it(`writes the ${scale} profile with every row and counter`, async () => {
      const today = seedToday()
      const opts = { now: dhakaAt(today, "10:30"), today, scale }
      const t0 = performance.now()
      buildSeed(opts)
      const buildMs = performance.now() - t0
      expect(buildMs).toBeLessThan(5_000)

      const db = createDb(`seed-write-${scale}-${Math.random().toString(36).slice(2, 8)}`)
      await db.open()
      const summary = await seedDatabase(db, opts)
      for (const [table, n] of Object.entries(summary.counts)) {
        if (table === "counters") expect(await db.counters.count()).toBe(n)
        else expect(await db.table(table).count(), table).toBe(n)
      }
      const posting = await db.settings.get("postingAccounts")
      expect(posting).toBeDefined()
      console.info(`seed ${scale}: build ${Math.round(buildMs)} ms, build and write ${summary.durationMs} ms (fake-indexeddb), ${Object.values(summary.counts).reduce((s, n) => s + n, 0)} rows`)
      db.close()
    }, 180_000)
  }
})
