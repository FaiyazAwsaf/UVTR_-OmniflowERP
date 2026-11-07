import { expect, test } from "@playwright/test"

import { signIn } from "./helpers"

/**
 * The stock check on the order page (plan §10 E3): Uttara's booked ceramic
 * job needs 38 ml of the 2-year coating and the studio has 20 ml, so the row
 * is short and Arif (who may request transfers into Uttara) gets a link to
 * ST prefilled from the Central Store with whole kits. An advisor sees the
 * check but no request button.
 */
test("E3 hook: the booked ceramic job shows the coating short and links a prefilled transfer", async ({ page }) => {
  await signIn(page, "arif")
  await page.goto("/stl/orders/so_e3_uttara")
  const check = page.getByTestId("order-stock-check")
  await expect(check).toBeVisible()
  await expect(check).toHaveAttribute("data-short", "true")
  const row = page.locator('[data-testid="order-stock-row"][data-short="true"]').filter({ hasText: "CH-CC2" })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText("38 ml")
  await expect(row).toContainText("20 ml")
  const link = row.getByTestId("order-request-transfer")
  const href = (await link.getAttribute("href")) ?? ""
  const url = new URL(href, "http://x")
  expect(url.pathname).toBe("/st/transfers")
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ new: "1", from: "loc_cst", to: "loc_utt" })
  expect(url.searchParams.get("item")).toMatch(/^itm_cc2_kit/)
  expect(Number(url.searchParams.get("qty")) % 10).toBe(0)
  expect(Number(url.searchParams.get("qty"))).toBeGreaterThanOrEqual(18)
  expect(url.searchParams.get("order")).toMatch(/^SO-UTT-/)
  await expect(page.locator('[data-testid="order-stock-row"][data-short="false"]').first()).toBeVisible()
})

test("E3 hook: an advisor sees the check without the request button", async ({ page }) => {
  await signIn(page, "nayeem")
  await page.goto("/stl/orders/so_e3_uttara")
  await expect(page.getByTestId("order-stock-check")).toBeVisible()
  await expect(page.getByTestId("order-request-transfer")).toHaveCount(0)
})

/* Review screenshots (SHOTS_DIR only): the stock check in EN and BN at both sizes, and in light mode. */
const SHOTS = process.env.SHOTS_DIR
for (const lang of ["en", "bn"] as const) {
  for (const size of [
    { name: "960", width: 960, height: 600 },
    { name: "1920", width: 1920, height: 1200 },
  ] as const) {
    test(`order stock check screens ${lang}-${size.name}`, async ({ page }) => {
      test.skip(!SHOTS, "SHOTS_DIR not set")
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, "arif", lang)
      await page.goto("/stl/orders/so_e3_uttara")
      await expect(page.getByTestId("order-stock-check")).toBeVisible()
      await page.getByTestId("order-stock-check").scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${SHOTS}/order-stock-${lang}-${size.name}.png` })
      if (lang === "en") {
        await page.locator('[data-slot="theme-toggle"]').click()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${SHOTS}/order-stock-light-${size.name}.png` })
      }
    })
  }
}
