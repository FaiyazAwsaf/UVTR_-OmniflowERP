import { expect, test, type Page } from "@playwright/test"

import { windowAs } from "./helpers"

/**
 * Screenshots of the WS-Dash screens for review (plan §13.1 rule 8): the
 * executive dashboard, every role home and the studio home, EN and BN, at
 * 960x600 and 1920x1200 (plus a tall shot of the whole page), dark, and the
 * dashboard in light. Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/claude-1000/WS-Dash-shots E2E_PORT=3408 bunx playwright test tests/e2e/dashboard/screenshots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600, tall: 2600 },
  { name: "1920", width: 1920, height: 1200, tall: 2200 },
] as const
const LANGS = ["en", "bn"] as const
const ROLES = ["rashed", "farzana", "mahbub", "shahriar", "nayeem", "tania", "rakib", "habib", "nusrat", "tahmid", "shamima"]

test.skip(!SHOTS, "SHOTS_DIR not set")

async function shot(page: Page, name: string, size: (typeof SIZES)[number], tag: string, tall = true) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/${name}-${tag}.png` })
  if (!tall) return
  await page.setViewportSize({ width: size.width, height: size.tall })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${name}-${tag}-tall.png` })
  await page.setViewportSize({ width: size.width, height: size.height })
}

for (const lang of LANGS) {
  for (const size of SIZES) {
    const tag = `${lang}-${size.name}`
    test(`dashboard and studio home ${tag}`, async ({ context }) => {
      test.setTimeout(240_000)
      const rashed = await windowAs(context, "rashed", lang)
      await rashed.setViewportSize({ width: size.width, height: size.height })
      await expect(rashed.getByTestId("dashboard")).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
      await expect(rashed.getByTestId("top-service").first()).toBeVisible()
      await shot(rashed, "dashboard", size, tag)
      await rashed.getByTestId("dashboard-location").click()
      await rashed.locator('[data-testid="dashboard-location-option"][data-value="loc_utt"]').click()
      await rashed.getByTestId("dashboard-period-today").click()
      await shot(rashed, "dashboard-utt-today", size, tag, false)
      if ((lang === "en" && size.name === "1920") || (lang === "bn" && size.name === "960")) {
        await rashed.locator('[data-slot="theme-toggle"]').first().click()
        await rashed.getByTestId("dashboard-period-mtd").click()
        await shot(rashed, "dashboard-light", size, tag)
        await rashed.locator('[data-slot="theme-toggle"]').first().click()
      }
      await rashed.goto("/stl")
      await expect(rashed.getByTestId("studio-home")).toBeVisible()
      await shot(rashed, "stl-rashed", size, tag, false)
      for (const user of ["shahriar", "arif"]) {
        const page = await windowAs(context, user, lang)
        await page.setViewportSize({ width: size.width, height: size.height })
        await expect(page.getByTestId("studio-order").first()).toBeVisible({ timeout: 20_000 })
        await shot(page, `stl-${user}`, size, tag)
        await page.close()
      }
    })

    test(`role homes ${tag}`, async ({ context }) => {
      test.setTimeout(300_000)
      for (const user of ROLES) {
        const page = await windowAs(context, user, lang)
        await page.setViewportSize({ width: size.width, height: size.height })
        if (!page.url().endsWith("/home")) await page.goto("/home")
        await expect(page.getByTestId("home-kpi")).toHaveCount(4, { timeout: 20_000 })
        await shot(page, `home-${user}`, size, tag, size.name === "1920" || ["rashed", "tania", "habib"].includes(user))
        await page.close()
      }
    })
  }
}
