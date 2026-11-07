import { expect, test, type Page } from "@playwright/test"

import { signIn } from "./scm-helpers"

/**
 * Screenshots of every SCM screen (plan §13.1 rule 8) in EN and BN at
 * 960x600 and 1920x1200, plus one 2x2 montage per screen for review
 * (EN 960 · BN 960 / EN 1920 · BN 1920). Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/shots E2E_PORT=3406 bunx playwright test tests/e2e/ic/scm-screens.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
test.skip(!SHOTS, "SHOTS_DIR not set")

type Screen = { name: string; path: string; ready: string; then?: (page: Page) => Promise<void> }

const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const

async function shoot(page: Page, user: string, screens: Screen[]) {
  const shots = new Map<string, Record<string, string>>()
  for (const lang of ["en", "bn"] as const) {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page, user, lang)
    for (const screen of screens) {
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height })
        await page.goto(screen.path)
        await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 })
        if (screen.then) await screen.then(page)
        await page.waitForTimeout(600)
        const file = `${SHOTS}/${screen.name}-${lang}-${size.name}.png`
        const buffer = await page.screenshot({ path: file })
        const entry = shots.get(screen.name) ?? {}
        entry[`${lang}-${size.name}`] = buffer.toString("base64")
        shots.set(screen.name, entry)
        if (screen.then) await page.keyboard.press("Escape")
      }
    }
  }
  // One montage per screen: the four shots on a 1920x1200 sheet.
  for (const [name, entry] of shots) {
    await page.setViewportSize({ width: 1920, height: 1200 })
    const cell = (key: string) => `<img src="data:image/png;base64,${entry[key]}" style="width:960px;height:600px;object-fit:contain;background:#000;display:block"/>`
    await page.setContent(
      `<html><body style="margin:0;background:#000;display:grid;grid-template-columns:960px 960px">${cell("en-960")}${cell("bn-960")}${cell("en-1920")}${cell("bn-1920")}</body></html>`
    )
    await page.screenshot({ path: `${SHOTS}/montage-${name}.png` })
  }
}

test("PM and IC screens (store keeper)", async ({ page }) => {
  test.setTimeout(600_000)
  await shoot(page, "habib", [
    { name: "pm-items", path: "/pm", ready: '[data-testid="item-row"]' },
    { name: "pm-item", path: "/pm/items/itm_cc2_kit", ready: '[data-testid="item-detail"]' },
    { name: "pm-labels", path: "/pm/items/itm_cc2_kit", ready: '[data-testid="item-detail"]', then: async (p) => { await p.getByTestId("barcode-print").click(); await expect(p.getByTestId("barcode-labels")).toBeVisible() } },
    { name: "pm-categories", path: "/pm/categories", ready: '[data-testid="category-row"]' },
    { name: "pm-uom", path: "/pm/uom", ready: '[data-testid="uom-row"]' },
    { name: "ic-stock", path: "/ic", ready: '[data-testid="stock-row"]' },
    { name: "ic-card", path: "/ic/items/itm_cc2_kit?location=loc_cst", ready: '[data-testid="stock-card-row"]' },
    { name: "ic-counts", path: "/ic/counts", ready: '[data-testid="count-open"]' },
    { name: "ic-reorder", path: "/ic/reorder", ready: '[data-testid="reorder-suggestion"]' },
    { name: "ic-expiry", path: "/ic/expiry", ready: '[data-testid="expiry-row"]' },
    { name: "ic-consumption", path: "/ic/consumption", ready: '[data-testid="consumption-row"]' },
  ])
})

test("IC count detail (store keeper)", async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, "habib")
  await page.goto("/ic/counts")
  await page.getByTestId("count-open").click()
  await page.getByTestId("count-open-submit").click()
  await expect(page.getByTestId("count-detail")).toBeVisible()
  const path = new URL(page.url()).pathname
  await page.getByTestId("count-fill").click()
  await page.getByTestId("count-qty").first().fill("1")
  await page.getByTestId("count-save").click()
  await shoot(page, "habib", [{ name: "ic-count", path, ready: '[data-testid="count-line"]' }])
})

test("ST and GRN screens (store keeper)", async ({ page }) => {
  test.setTimeout(600_000)
  await shoot(page, "habib", [
    { name: "st-home", path: "/st", ready: '[data-testid="st-to-dispatch"], [data-slot="kpi-grid"]' },
    { name: "st-transfers", path: "/st/transfers", ready: '[data-testid="transfer-row"]' },
    { name: "st-transfer", path: "/st/transfers/trf_in_transit", ready: '[data-testid="transfer-detail"]' },
    { name: "st-challan", path: "/st/transfers/trf_in_transit", ready: '[data-testid="transfer-detail"]', then: async (p) => { await p.getByTestId("challan-print").click(); await expect(p.getByTestId("challan")).toBeVisible() } },
    { name: "st-adjustments", path: "/st/adjustments", ready: '[data-testid="adjustment-row"]' },
    { name: "st-adjustment-new", path: "/st/adjustments", ready: '[data-testid="adjustment-row"]', then: async (p) => { await p.getByTestId("adjustment-new").click(); await expect(p.getByTestId("adjustment-dialog")).toBeVisible() } },
    { name: "st-issues", path: "/st/issues", ready: '[data-testid="issue-new"]' },
    { name: "grn-home", path: "/grn", ready: '[data-testid="grn-receive"]' },
    { name: "grn-receive", path: "/grn/receive/po_bengal_partial", ready: '[data-testid="grn-line"]' },
    { name: "grn-view", path: "/grn/grn_bengal_partial", ready: '[data-testid="grn-view"]' },
    { name: "grn-print", path: "/grn/grn_bengal_partial", ready: '[data-testid="grn-view"]', then: async (p) => { await p.getByTestId("grn-print").click(); await expect(p.getByTestId("grn-print-sheet")).toBeVisible() } },
    { name: "grn-quarantine", path: "/grn/quarantine", ready: '[data-slot="page-header"], h1' },
  ])
})

test("PTL screens (procurement officer)", async ({ page }) => {
  test.setTimeout(600_000)
  await shoot(page, "nusrat", [
    { name: "ptl-home", path: "/ptl", ready: '[data-testid="po-new"]' },
    { name: "ptl-requisitions", path: "/ptl/requisitions", ready: '[data-testid="pr-row"]' },
    { name: "ptl-requisition-new", path: "/ptl/requisitions/new", ready: '[data-testid="pr-editor"]' },
    { name: "ptl-pos", path: "/ptl/po", ready: '[data-testid="po-row"]' },
    { name: "ptl-po", path: "/ptl/po/po_bengal_partial", ready: '[data-testid="po-view"]' },
    { name: "ptl-po-print", path: "/ptl/po/po_bengal_partial", ready: '[data-testid="po-view"]', then: async (p) => { await p.getByTestId("po-print").click(); await expect(p.getByTestId("po-print-sheet")).toBeVisible() } },
    { name: "ptl-po-new", path: "/ptl/po/new", ready: '[data-testid="po-editor"]' },
    { name: "ptl-returns", path: "/ptl/returns", ready: '[data-testid="return-new"]' },
  ])
})

test("PTL requisition view (approver's eye)", async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, "nusrat")
  await page.goto("/ptl/requisitions")
  await page.getByTestId("pr-row").first().click()
  await expect(page.getByTestId("pr-view")).toBeVisible()
  const path = new URL(page.url()).pathname
  await shoot(page, "nusrat", [{ name: "ptl-requisition", path, ready: '[data-testid="pr-view"]' }])
})
