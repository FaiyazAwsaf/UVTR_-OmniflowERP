import { expect, test } from "@playwright/test"

import { rows, signIn } from "../stl/helpers"

/**
 * PC on the seeded data: the price matrix by class, a service's recipe per
 * class (ceramic 2-year: 38 ml for an SUV), and publishing the draft
 * RETAIL revision from the 1st of next month.
 */

test("the catalogue shows the class price matrix and the recipe per class", async ({ page }) => {
  await signIn(page, "farzana")
  await page.goto("/pc")
  await expect(page.getByTestId("price-matrix")).toBeVisible()
  await expect(page.getByTestId("matrix-row")).toHaveCount(18)
  await expect(page.locator('[data-testid="matrix-row"][data-code="PRT-CC2"] [data-class="SUV"]')).toContainText("36,000")
  await page.getByTestId("matrix-list").click()
  await page.getByRole("option", { name: "FLEET" }).click()
  await expect(page.locator('[data-testid="matrix-row"][data-code="PRT-CC2"] [data-class="SUV"]')).toContainText("31,680")
  await page.goto("/pc/services/svc_prt_cc2")
  await page.locator('[data-testid="recipe-class"][data-class="SUV"]').click()
  await expect(page.locator('[data-testid="recipe-row"][data-sku="CH-CC2-50"]')).toContainText("38")
  await page.goto("/pc/packages")
  await expect(page.getByTestId("package-components").first()).toBeVisible()
  await page.goto("/pc/promotions")
  await expect(page.locator('[data-testid="promotion-card"][data-code="WINTER10"]')).toBeVisible()
})

test("publishing the draft RETAIL revision archives the old list from its date", async ({ page }) => {
  await signIn(page, "farzana")
  await page.goto("/pc/price-lists")
  await page.getByTestId("publish-price-list").first().click()
  await page.getByTestId("publish-confirm").click()
  await expect(page.getByTestId("publish-dialog")).toBeHidden()
  const lists = await rows<{ id: string; status: string; validTo?: string }>(page, "priceLists")
  expect(lists.find((l) => l.id === "pl_retail_draft")?.status).toBe("published")
  expect(lists.find((l) => l.id === "pl_retail")?.validTo).toBeTruthy()
})

test("an advisor sees the catalogue but cannot edit it", async ({ page }) => {
  await signIn(page, "nayeem")
  await page.goto("/pc/services/svc_wsh_exp")
  await expect(page.getByTestId("service-detail")).toBeVisible()
  await expect(page.getByTestId("service-edit")).toHaveCount(0)
  await page.goto("/pc/price-lists")
  await expect(page.getByTestId("publish-price-list")).toHaveCount(0)
})
