import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../shell/helpers"

/**
 * Screenshots of the WS-FIN launchers' landing screens with their cue cards
 * (E5 to E8), and the screens after their key steps, EN and BN at 960x600
 * and 1920x1200, for review. Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/claude-1000/WS-FIN-shots E2E_PORT=3404 bunx playwright test tests/e2e/cab/launcher-shots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const

test.skip(!SHOTS, "SHOTS_DIR not set")

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function launch(page: Page, id: string, ready: string) {
  await page.goto(`/fa?launch=${id}`)
  await expect(page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 30_000 })
}

for (const lang of LANGS) {
  for (const size of SIZES) {
    const tag = `${lang}-${size.name}`
    test(`WS-FIN launchers ${tag}`, async ({ browser }) => {
      test.setTimeout(300_000)
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
      const page = await context.newPage()
      await signIn(page, "mahbub", `&lang=${lang}`)

      await launch(page, "E5", "match-line")
      await shot(page, `E5-${tag}`)
      await launch(page, "E6", "pay-bill-row")
      await page.getByTestId("payment-method").locator('[data-value="cheque"]').click()
      await shot(page, `E6-${tag}`)

      await launch(page, "E7", "recon-line")
      await shot(page, `E7-${tag}`)
      await page.getByRole("button", { name: lang === "en" ? "Close the cue card" : "নির্দেশনা কার্ড বন্ধ করুন" }).click()
      await page.getByTestId("recon-auto").click()
      await expect(page.locator('[data-testid="recon-line"][data-matched="false"]')).toHaveCount(2, { timeout: 30_000 })
      await page.getByTestId("recon-filter").locator('[data-value="open"]').click()
      await shot(page, `E7-open-${tag}`)

      await launch(page, "E8", "cheque-detail")
      await shot(page, `E8-${tag}`)
      await page.getByRole("button", { name: lang === "en" ? "Close the cue card" : "নির্দেশনা কার্ড বন্ধ করুন" }).click()
      const no = (await page.getByTestId("cheque-detail").getAttribute("data-cheque-no"))!
      const row = page.locator(`[data-testid="cheque-row"][data-cheque-no="${no}"]`)
      await row.getByTestId("cheque-deposit").click()
      await expect(page.getByTestId("cheque-detail")).toHaveAttribute("data-status", "deposited")
      await row.getByTestId("cheque-bounce").click()
      await page.getByTestId("bounce-dialog").getByTestId("reason-confirm").click()
      await expect(page.getByTestId("cheque-notice")).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await shot(page, `E8-bounced-${tag}`)
      if (lang === "en") {
        await page.locator('[data-slot="theme-toggle"]').click()
        await shot(page, `E8-bounced-light-${tag}`)
      }

      // CAB scope: Tania (cashier, Gulshan) sees Gulshan's till and petty cash only.
      const tania = await context.newPage()
      await signIn(tania, "tania", `&lang=${lang}`)
      await tania.goto("/cab")
      await expect(tania.getByTestId("position-row").first()).toBeVisible()
      await shot(tania, `cab-tania-${tag}`)
      await context.close()
    })
  }
}
