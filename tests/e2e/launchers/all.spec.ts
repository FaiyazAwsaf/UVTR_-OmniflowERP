import { expect, test } from "@playwright/test"

import { rows } from "../stl/helpers"

/**
 * P3.3: every launcher (J1 to J6, E1 to E16) launched twice in a row in one
 * browser (one database), the way a presenter re-runs them, each time on its
 * user's screen with its cue card; afterwards the books tie: debits equal
 * credits and the trial balance screen says balanced. The key actions are in
 * the per-launcher specs beside this one.
 */

const ROUTES: [string, RegExp][] = [
  ["J1", /\/stl\/quotations\/new/],
  ["J2", /\/stl\/my-jobs/],
  ["J3", /\/sd\/handover\//],
  ["J4", /\/si\/counter/],
  ["J5", /\/fa\/journals/],
  ["J6", /\/dashboard/],
  ["E1", /\/stl\/quotations\//],
  ["E2", /\/si\/new/],
  ["E3", /\/stl\/orders\//],
  ["E4", /\/grn\/receive\//],
  ["E5", /\/ap\/bills\/new/],
  ["E6", /\/ap\/payments\/new/],
  ["E7", /\/cab\/reconciliation/],
  ["E8", /\/cab\/cheques/],
  ["E9", /\/ic\/counts\//],
  ["E10", /\/fa\/journals\//],
  ["E11", /\/fa\/periods/],
  ["E12", /\/si\//],
  ["E13", /\/rbac\/roles\//],
  ["E14", /\/sac/],
  ["E15", /\/par\//],
  ["E16", /\/irt\/builder/],
]

test("every launcher twice in a row; the books tie after all of them", async ({ page }) => {
  test.setTimeout(900_000)
  for (const [id, route] of ROUTES) {
    for (let run = 0; run < 2; run++) {
      // The very first launch seeds the browser: no database to read before it.
      const first = run === 0 && id === ROUTES[0][0]
      const before = first ? 0 : (await rows<{ scenarioId: string }>(page, "scenarioRuns")).filter((r) => r.scenarioId === id).length
      await page.goto(`/?launch=${id}`)
      if (first) await expect(page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)).toBeVisible({ timeout: 90_000 })
      // The setup has finished when its run is recorded (the cue card of an earlier run may still show).
      await expect
        .poll(async () => (await rows<{ scenarioId: string }>(page, "scenarioRuns")).filter((r) => r.scenarioId === id).length, {
          message: `${id} run ${run + 1} recorded`,
          timeout: 90_000,
        })
        .toBe(before + 1)
      await expect(page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`), `${id} run ${run + 1}`).toBeVisible({ timeout: 90_000 })
      // A refused setup stays on the current screen with the engine's dialog.
      await expect(page, `${id} run ${run + 1}`).toHaveURL(route)
    }
  }
  const lines = await rows<{ debitP: number; creditP: number }>(page, "journalLines")
  expect(lines.reduce((s, l) => s + l.debitP, 0)).toBe(lines.reduce((s, l) => s + l.creditP, 0))
  const runs = await rows<{ scenarioId: string }>(page, "scenarioRuns")
  for (const [id] of ROUTES) expect(runs.filter((r) => r.scenarioId === id).length, id).toBeGreaterThanOrEqual(2)
  await page.goto("/?user=mahbub")
  await expect(page).toHaveURL(/\/fa/, { timeout: 30_000 })
  await page.goto("/frs/trial-balance")
  await expect(page.getByTestId("tb-balanced")).toHaveAttribute("data-balanced", "true", { timeout: 30_000 })
})
