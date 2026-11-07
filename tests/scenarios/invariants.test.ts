import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { verifyChain } from "@/core/audit/verify"
import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { defaultPostingMap } from "@/core/ledger/chart"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { PTY } from "@/core/seed/content/seed-refs"
import { seedDatabase } from "@/core/seed"
import { dhakaAt } from "@/core/seed/time"

import { freshDb } from "../helpers/foundation"
import { tieProblems } from "../helpers/ties"

/**
 * P4.3 invariant audit: on one database, every launcher (J1 to J6, E1 to
 * E16) runs twice in a row, and after EVERY run the books tie: each journal
 * balances, the trial balance ties, and AR, AP, customer advances, GRNI,
 * inventory per tag and location and goods in transit equal their control
 * accounts. At the end the audit chain verifies. (Each launcher's own key
 * actions are tested beside its module; this is the cross-cutting check.)
 */
let db: OmniflowDb
const today = dhakaDate(now())
const ORDER = [..."123456"]
  .map((n) => `J${n}`)
  .concat(Array.from({ length: 16 }, (_, i) => `E${i + 1}`))

beforeAll(async () => {
  db = await freshDb("invariants")
  await seedDatabase(db, {
    now: dhakaAt(today, "10:30"),
    today,
    scale: "small",
  })
  applyClockOffset(atDhaka(today, "10:30") - Date.now())
}, 180_000)
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("the books tie after every launcher", () => {
  it("covers every registered launcher", () => {
    expect(new Set(SCENARIOS.map((s) => s.id))).toEqual(new Set(ORDER))
  })

  it("ties after the seed", async () => {
    expect(await tieProblems(db)).toEqual([])
  })

  for (const id of ORDER) {
    it(`ties after ${id}, run twice`, async () => {
      const def = SCENARIOS.find((s) => s.id === id)!
      for (let run = 1; run <= 2; run++) {
        await runScenario(def, db)
        expect(await tieProblems(db), `${id} run ${run}`).toEqual([])
      }
    }, 120_000)
  }

  it("keeps the audit chain intact", async () => {
    const chain = await verifyChain(db)
    expect(chain.ok).toBe(true)
    expect(chain.count).toBeGreaterThan(100)
  })

  it("would notice a broken tie (the check is not vacuous)", async () => {
    // A stray AR line written past the engine: unbalanced, and AR no longer equals the invoices.
    const line = (await db.journalLines
      .where("partyId")
      .equals(PTY.swiftRide)
      .first())!
    await db.journalLines.put({
      ...line,
      id: "jl_stray_check",
      debitP: 100,
      creditP: 0,
      accountId: defaultPostingMap().AR_CONTROL,
    })
    const problems = await tieProblems(db)
    expect(
      problems.some(
        (p) => p.startsWith("trial balance") || p.startsWith("journal")
      )
    ).toBe(true)
    expect(problems.some((p) => p.startsWith(`AR ${PTY.swiftRide}`))).toBe(true)
    await db.journalLines.delete("jl_stray_check")
    expect(await tieProblems(db)).toEqual([])
  })
})
