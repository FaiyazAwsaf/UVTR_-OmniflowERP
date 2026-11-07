import { expect, test } from "@playwright/test"

import { asUser, choose, docNo, pick, signIn } from "../ic/scm-helpers"

/**
 * E3 by hand (plan §10): Uttara holds 20 ml of ceramic coating 2-year and a
 * booked SUV job needs 38 ml. Arif requests a transfer from the Central
 * Store, Habib dispatches it with the Mushak 6.5 challan, Arif receives it,
 * and Uttara's stock shows the new quantity, live.
 */
test("E3: request, dispatch with the 6.5 challan, receive; Uttara's stock rises", async ({ page, context }) => {
  test.setTimeout(180_000)
  await signIn(page, "arif")
  await page.goto("/ic")
  const uttaraKit = page.locator('[data-testid="stock-row"][data-sku="CH-CC2-50"][data-location="UTT"]')
  await expect(uttaraKit).toBeVisible()
  await expect(page.locator("tr").filter({ has: uttaraKit })).toContainText(/(^|\D)20\s?ml/)

  await page.goto("/st/transfers")
  await page.getByTestId("transfer-new").click()
  await expect(page.getByTestId("transfer-dialog")).toBeVisible()
  await pick(page, page.getByTestId("transfer-line-item").first(), "CH-CC2-50", "transfer-line-item")
  await page.getByTestId("transfer-qty").first().fill("100")
  await page.getByTestId("transfer-submit").click()
  await expect(page.getByTestId("transfer-detail")).toBeVisible()
  const trfNo = await docNo(page)
  expect(trfNo).toMatch(/^TRF-\d{4}-\d{4}$/)
  const url = page.url()

  const habib = await asUser(context, "habib")
  await habib.goto(url.replace(/^https?:\/\/[^/]+/, ""))
  await habib.getByTestId("transfer-dispatch").click()
  await habib.getByTestId("dispatch-submit").click()
  await expect(habib.getByTestId("transfer-detail").locator('[data-status="in-transit"]').first()).toBeVisible()
  await habib.getByTestId("challan-print").click()
  await expect(habib.getByTestId("challan")).toBeVisible()
  await expect(habib.getByTestId("tax-doc-header")).toContainText("Mushak 6.5")
  await expect(habib.getByTestId("challan")).toContainText(trfNo)
  await habib.keyboard.press("Escape")

  // Arif's window shows it in transit live and receives it in full.
  await expect(page.getByTestId("transfer-receive")).toBeVisible()
  await page.getByTestId("transfer-receive").click()
  await page.getByTestId("receive-submit").click()
  await expect(page.getByTestId("transfer-detail").locator('[data-status="received"]').first()).toBeVisible()
  await expect(page.getByTestId("journal-link")).toHaveCount(2)

  await page.goto("/ic")
  await expect(page.locator("tr").filter({ has: uttaraKit })).toContainText(/(^|\D)120\s?ml/)
})

test("adjustments: a small damage posts at once; internal use is logged", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, "habib")
  await page.goto("/st/adjustments")
  await page.getByTestId("adjustment-new").click()
  await expect(page.getByTestId("adjustment-dialog")).toBeVisible()
  await pick(page, page.getByTestId("adjustment-line-item").first(), "CN-MFT-10", "adjustment-line-item")
  await page.getByTestId("adjustment-qty").first().fill("1")
  await page.getByTestId("adjustment-note").fill("Torn towel")
  await expect(page.getByTestId("adjustment-estimate")).toContainText("it posts at once")
  await page.getByTestId("adjustment-submit").click()
  await expect(page.getByTestId("adjustment-view")).toBeVisible()
  await expect(page.getByTestId("adjustment-view").locator('[data-status="posted"]').first()).toBeVisible()
  await expect(page.getByTestId("adjustment-view").getByTestId("journal-link")).toBeVisible()
  await page.keyboard.press("Escape")

  await page.goto("/st/issues")
  await page.getByTestId("issue-new").click()
  await pick(page, page.getByTestId("adjustment-line-item").first(), "CH-APC-5L", "adjustment-line-item")
  await page.getByTestId("adjustment-qty").first().fill("100")
  await choose(page, page.getByTestId("issue-expense"), "Printing, stationery and office")
  await page.getByTestId("adjustment-note").fill("Cleaning the store office")
  await page.getByTestId("adjustment-submit").click()
  await expect(page.getByTestId("adjustment-view").locator('[data-status="posted"]').first()).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByTestId("tab-jobs").click()
  await expect(page.getByTestId("job-issue-row").first()).toBeVisible()
})
