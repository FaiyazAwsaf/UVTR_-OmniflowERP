import { expect, test } from "@playwright/test"

import { signIn } from "../ic/scm-helpers"

/** PM screens: the item master, item detail with reorder rules per location and barcode labels, categories, units, a new item. */
test("item master, detail, reorder rule, labels, categories, units and a new item", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, "habib")
  await page.goto("/pm")
  await expect(page.getByTestId("item-row").first()).toBeVisible()
  await page.getByPlaceholder("Search SKU, name or barcode").fill("CH-CC2-50")
  await expect(page.getByTestId("item-row")).toHaveCount(1)
  await page.getByTestId("item-row").click()
  await expect(page.getByTestId("item-detail")).toBeVisible()
  await expect(page.getByTestId("reorder-rule")).toHaveCount(3)

  const uttara = page.locator('[data-testid="reorder-rule"][data-location="UTT"]')
  await uttara.getByTestId("reorder-rule-edit").click()
  await page.getByTestId("rule-min").fill("120")
  await page.getByTestId("rule-max").fill("400")
  await page.getByTestId("rule-save").click()
  await expect(uttara).toContainText("120")
  await expect(uttara).toContainText("400")

  await page.getByTestId("barcode-print").click()
  await expect(page.getByTestId("barcode-labels")).toBeVisible()
  await expect(page.getByTestId("barcode-labels").locator("svg").first()).toBeVisible()
  await page.keyboard.press("Escape")

  await page.goto("/pm/categories")
  await expect(page.getByTestId("category-row")).toHaveCount(3)
  await page.goto("/pm/uom")
  await expect(page.getByTestId("uom-row").first()).toBeVisible()

  await page.goto("/pm")
  await page.getByTestId("item-new").click()
  await page.getByTestId("item-sku").fill("CH-TEST-1L")
  await page.getByTestId("item-name-en").fill("Test coating 1 L")
  await page.getByTestId("item-factor").fill("1000")
  await page.getByTestId("item-cost").fill("2500")
  await page.getByTestId("item-save").click()
  await expect(page.getByTestId("item-detail")).toBeVisible()
  await expect(page.getByTestId("item-detail")).toContainText("CH-TEST-1L")
})
