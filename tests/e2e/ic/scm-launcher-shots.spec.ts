import { expect, test, type Page } from "@playwright/test"

import { launchByUrl } from "../launchers/helpers"
import { signIn } from "./scm-helpers"

/**
 * Screenshots of the SCM launchers' landing screens with their cue cards
 * (E3, E4, E9) and of the transfer prefill, in EN and BN at 960x600 and
 * 1920x1200, plus a 2x2 montage per screen (EN 960 · BN 960 / EN 1920 ·
 * BN 1920). Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/shots E2E_PORT=3406 bunx playwright test tests/e2e/ic/scm-launcher-shots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
test.skip(!SHOTS, "SHOTS_DIR not set")

const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const

type Shot = { name: string; launch: string; user: string; ready: string; then?: (page: Page) => Promise<void> }

const SCREENS: Shot[] = [
  { name: "e3-order", launch: "E3", user: "arif", ready: '[data-testid="order-view"]' },
  {
    name: "e3-transfer-prefill",
    launch: "E3",
    user: "arif",
    ready: '[data-testid="order-view"]',
    then: async (page) => {
      const session = await page.evaluate(() => {
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i)
          if (key?.startsWith("of:session:")) return JSON.parse(window.sessionStorage.getItem(key) ?? "{}")
        }
        return {}
      })
      const orderNo = session?.cue?.params?.orderNo
      await page.goto(`/st/transfers?new=1&from=loc_cst&to=loc_utt&item=itm_cc2_kit&qty=50&order=${orderNo}`)
      await expect(page.getByTestId("transfer-dialog")).toBeVisible()
    },
  },
  { name: "e4-receive", launch: "E4", user: "habib", ready: '[data-testid="grn-receive-form"]' },
  { name: "e9-count", launch: "E9", user: "habib", ready: '[data-testid="count-detail"]' },
]

test("SCM launcher landing screens with their cue cards", async ({ page }) => {
  test.setTimeout(600_000)
  page.context().on("page", async (p) => {
    if (await p.opener()) await p.close().catch(() => undefined)
  })
  const shots = new Map<string, Record<string, string>>()
  for (const lang of ["en", "bn"] as const) {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page, "habib", lang)
    for (const screen of SCREENS) {
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height })
        await launchByUrl(page, screen.launch, "/ic")
        await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 30_000 })
        if (screen.then) await screen.then(page)
        await page.waitForTimeout(800)
        const buffer = await page.screenshot({ path: `${SHOTS}/${screen.name}-${lang}-${size.name}.png` })
        const entry = shots.get(screen.name) ?? {}
        entry[`${lang}-${size.name}`] = buffer.toString("base64")
        shots.set(screen.name, entry)
        if (screen.then) await page.keyboard.press("Escape")
      }
    }
  }
  for (const [name, entry] of shots) {
    await page.setViewportSize({ width: 1920, height: 1200 })
    const cell = (key: string) => `<img src="data:image/png;base64,${entry[key]}" style="width:960px;height:600px;object-fit:contain;background:#000;display:block"/>`
    await page.setContent(
      `<html><body style="margin:0;background:#000;display:grid;grid-template-columns:960px 960px">${cell("en-960")}${cell("bn-960")}${cell("en-1920")}${cell("bn-1920")}</body></html>`
    )
    await page.screenshot({ path: `${SHOTS}/montage-${name}.png` })
  }
})
