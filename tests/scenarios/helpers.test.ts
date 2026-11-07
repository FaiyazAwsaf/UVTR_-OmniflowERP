import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { trialBalance } from "@/core/ledger/statements"
import { lastMonth, lastRun, previousRuns, setStockLevel } from "@/core/scenarios/helpers"
import { createKit, runScenario } from "@/core/scenarios/runner"
import type { ScenarioDef } from "@/core/scenarios/types"
import { seedDatabase } from "@/core/seed"
import { dhakaAt } from "@/core/seed/time"

import { freshDb } from "../helpers/foundation"

/** The shared launcher helpers (plan §10 re-run rules) on the small seed. */
let db: OmniflowDb
const today = dhakaDate(now())
const CC2 = "itm_cc2_kit"

const probe: ScenarioDef = {
  id: "T1",
  kind: "scenario",
  module: "demo",
  titleKey: "demo.scenarios.title",
  user: "shahriar",
  route: () => "/stl",
  cueKeys: [],
  async setup(kit) {
    const level = await setStockLevel(kit, { itemId: CC2, locationId: "loc_gul", qtyBase: 100, mode: "at-least" })
    return { refs: { itemId: CC2 }, params: { after: level.after } }
  },
}

async function usable(): Promise<number> {
  const kit = createKit(probe, db)
  // A no-op top-up reports the current level.
  return (await setStockLevel(kit, { itemId: CC2, locationId: "loc_gul", qtyBase: 0, mode: "at-least" })).after
}

async function ties(): Promise<boolean> {
  return trialBalance(await db.accounts.toArray(), await db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" }).balanced
}

beforeAll(async () => {
  db = await freshDb("scenario-helpers")
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
}, 180_000)
afterAll(async () => {
  await db.delete()
})

describe("scenario helpers", () => {
  it("tops stock up to at least a level, twice in a row, posting R22 and keeping the books tied", async () => {
    const first = await runScenario(probe, db)
    expect(first.outcome.params?.after).toBeGreaterThanOrEqual(100)
    const second = await runScenario(probe, db)
    expect(second.outcome.params?.after).toBe(first.outcome.params?.after)
    expect(await ties()).toBe(true)
    const runs = await previousRuns(db, "T1")
    expect(runs).toHaveLength(2)
    expect((await lastRun(db, ["T1", "T2"]))?.id).toBe(runs[0].id)
  })

  it("sets stock to exactly a level, taking stock away FEFO", async () => {
    const kit = createKit(probe, db)
    const out = await setStockLevel(kit, { itemId: CC2, locationId: "loc_gul", qtyBase: 20, mode: "exactly" })
    expect(out.after).toBe(20)
    expect(await usable()).toBe(20)
    const lossVouchers = (await db.journals.toArray()).filter((j) => j.rule === "R22" && j.narration.includes("reduced"))
    expect(lossVouchers.length).toBeGreaterThan(0)
    expect(await ties()).toBe(true)
  })

  it("names last month's first and last day", () => {
    expect(lastMonth("2026-11-07")).toEqual({ month: "2026-10", firstDay: "2026-10-01", lastDay: "2026-10-31" })
    expect(lastMonth("2027-03-15")).toEqual({ month: "2027-02", firstDay: "2027-02-01", lastDay: "2027-02-28" })
    expect(lastMonth("2027-01-01").month).toBe("2026-12")
  })
})
