import { expect, test } from "@playwright/test"

import { launchByUrl } from "../launchers/helpers"
import { signIn } from "./helpers"

/**
 * Screenshots of the FA launchers' landing screens with their cue cards
 * (E10, E11), EN and BN at 960x600 and 1920x1200, for review. Runs only
 * with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/shots E2E_PORT=3403 bunx playwright test tests/e2e/fa/launcher-shots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const
const LAUNCHERS = [
  { id: "E10", user: "mahbub", ready: "journal-editor" },
  { id: "E11", user: "farzana", ready: "close-checklist" },
] as const

test.skip(!SHOTS, "SHOTS_DIR not set")

for (const lang of LANGS) {
  for (const size of SIZES) {
    for (const launcher of LAUNCHERS) {
      const tag = `${launcher.id}-${lang}-${size.name}`
      test(`launcher ${tag}`, async ({ page }) => {
        test.setTimeout(120_000)
        await page.setViewportSize({ width: size.width, height: size.height })
        await signIn(page, launcher.user, `&lang=${lang}`)
        await launchByUrl(page, launcher.id, "/fa")
        await expect(page.getByTestId(launcher.ready)).toBeVisible()
        await page.waitForTimeout(800)
        await page.screenshot({ path: `${SHOTS}/${tag}.png` })
        // The same screen in the light theme.
        await page.locator('[data-slot="theme-toggle"]').click()
        await page.waitForTimeout(800)
        await page.screenshot({ path: `${SHOTS}/${tag}-light.png` })
      })
    }
  }
}
