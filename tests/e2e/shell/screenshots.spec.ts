import { expect, test, type Page } from "@playwright/test"

import { openDemoPanel, signIn } from "./helpers"

/**
 * Screenshots of the shell for review (plan §13.1 rule 8), EN and BN at
 * 960x600 and 1920x1200. Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/shots E2E_PORT=3401 bunx playwright test tests/e2e/shell/screenshots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const

test.skip(!SHOTS, "SHOTS_DIR not set")

async function shot(page: Page, name: string) {
  // Let page transitions and live counts settle.
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

for (const lang of LANGS) {
  for (const size of SIZES) {
    const tag = `${lang}-${size.name}`

    test(`launcher, login and wall ${tag}`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(`/?lang=${lang}`)
      await expect(page.getByTestId("launcher")).toBeVisible()
      await shot(page, `launcher-${tag}`)
      await page.goto("/login")
      await expect(page.getByTestId("login-form")).toBeVisible()
      await shot(page, `login-${tag}`)
      await page.getByTestId("login-username").fill("polash")
      await page.getByTestId("login-password").fill("demo1234")
      await page.getByTestId("login-submit").click()
      await expect(page.getByTestId("login-error")).toBeVisible()
      await shot(page, `login-locked-${tag}`)
      await page.goto("/wall")
      for (const n of [1, 2, 3, 4]) {
        await expect(
          page.frameLocator(`iframe[name="of-wall-${n}"]`).locator('[data-slot="erp-shell"]')
        ).toBeVisible({ timeout: 30_000 })
      }
      await shot(page, `wall-${tag}`)
    })

    test(`apps, approvals, bell, palette ${tag}`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, "farzana", `&lang=${lang}`)
      await page.goto("/apps")
      await expect(page.getByTestId("apps-grid")).toBeVisible()
      await shot(page, `apps-${tag}`)
      await page.goto("/approvals")
      await expect(page.getByTestId("approval-row").first()).toBeVisible()
      await shot(page, `approvals-${tag}`)
      if (size.name === "960") {
        await page.keyboard.press("Control+b")
        await shot(page, `approvals-sidebar-open-${tag}`)
        await page.keyboard.press("Control+b")
      }
      await page.getByTestId("approvals-bell").click()
      await expect(page.getByTestId("bell-item").first()).toBeVisible()
      await shot(page, `bell-${tag}`)
      await page.keyboard.press("Escape")
      await page.getByTestId("user-menu").click()
      await expect(page.getByTestId("sign-out")).toBeVisible()
      await shot(page, `user-menu-${tag}`)
      await page.keyboard.press("Escape")
      await page.keyboard.press("Control+k")
      await page.getByTestId("palette-input").fill("১৫-৭৭")
      await expect(page.getByTestId("search-result").first()).toBeVisible()
      await shot(page, `palette-vehicle-${tag}`)
      await page.getByTestId("palette-input").fill("INV-")
      await expect(page.getByTestId("search-result").first()).toBeVisible()
      await shot(page, `palette-docs-${tag}`)
      await page.getByTestId("palette-input").fill("")
      await shot(page, `palette-empty-${tag}`)
    })

    test(`demo panel and location switcher ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, "habib", `&lang=${lang}`)
      await page.getByTestId("location-switcher").click()
      await shot(page, `location-${tag}`)
      await page.keyboard.press("Escape")
      await signIn(page, "tahmid", `&lang=${lang}`)
      await openDemoPanel(page, lang === "bn" ? "ডেটা" : "Data")
      await expect(page.getByTestId("demo-dev")).toBeVisible()
      await shot(page, `demo-panel-data-${tag}`)
      await page.getByTestId("demo-dev").scrollIntoViewIfNeeded()
      await shot(page, `demo-panel-dev-${tag}`)
    })
  }
}

test("light theme", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 })
  await signIn(page, "farzana")
  await page.goto("/approvals")
  await page.locator('[data-slot="theme-toggle"]').first().click()
  await expect(page.getByTestId("approval-row").first()).toBeVisible()
  await shot(page, "approvals-light-en-1920")
  await page.goto("/apps")
  await shot(page, "apps-light-en-1920")
  await page.setViewportSize({ width: 960, height: 600 })
  await shot(page, "apps-light-en-960")
  await page.goto("/login")
  await shot(page, "login-light-en-960")
})
