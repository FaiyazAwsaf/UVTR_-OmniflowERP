import { expect, test } from "@playwright/test"

import { lastMonthDay, signIn } from "../fa/helpers"

/**
 * FRS by hand (plan §9 FRS screens): the statements tie on seeded data and
 * drill down to vouchers and source documents; the VAT return and tax
 * deposits for last month.
 */

test("statements tie on seeded data and drill down to the voucher and its source", async ({ page }) => {
  test.setTimeout(150_000)
  await signIn(page, "shamima")
  await expect(page.getByTestId("frs-home")).toBeVisible()
  await expect(page.getByTestId("frs-tile-tb").getByTestId("tb-balanced")).toHaveAttribute("data-balanced", "true")
  await expect(page.getByTestId("frs-tile-bs").getByTestId("bs-balanced")).toHaveAttribute("data-balanced", "true")
  await expect(page.getByTestId("frs-tile-cf").getByTestId("cf-balanced")).toHaveAttribute("data-balanced", "true")
  await expect(page.getByTestId("tax-calendar")).toBeVisible()

  await page.goto("/frs/trial-balance")
  await expect(page.getByTestId("frs-tb")).toBeVisible()
  await expect(page.getByTestId("tb-balanced")).toHaveAttribute("data-balanced", "true")
  await page.getByTestId("scope-ytd").click()
  await expect(page.getByTestId("tb-balanced")).toHaveAttribute("data-balanced", "true")
  // Drill: account → ledger → voucher → source document.
  await page.locator('[data-testid="tb-row"][data-code="1121"] [data-testid="drill-link"]').click()
  await expect(page).toHaveURL(/\/fa\/ledger\?account=acc_1121/)
  const row = page.getByTestId("ledger-row").first()
  await expect(row).toBeVisible()
  await row.locator("a").click()
  await expect(page.getByTestId("voucher-view")).toBeVisible()

  await page.goto("/frs/profit-loss")
  await expect(page.getByTestId("frs-pl")).toBeVisible()
  await expect(page.locator('[data-testid="frs-pl"] th[data-col="HQ"]')).toBeVisible()
  await expect(page.getByTestId("pl-total").last()).toBeVisible()
  await page.getByTestId("pl-view-months").click()
  await expect(page.locator('[data-testid="frs-pl"] th[data-col="ytd"]')).toBeVisible()
  await page.getByTestId("pl-view-compare").click()
  await expect(page.locator('[data-testid="frs-pl"] th[data-col="prior"]')).toBeVisible()

  await page.goto("/frs/balance-sheet")
  await expect(page.getByTestId("frs-bs")).toBeVisible()
  await expect(page.getByTestId("bs-balanced")).toHaveAttribute("data-balanced", "true")
  await expect(page.getByTestId("bs-current-year")).toBeVisible()

  await page.goto("/frs/cash-flow")
  await expect(page.getByTestId("frs-cf")).toBeVisible()
  await expect(page.getByTestId("cf-balanced")).toHaveAttribute("data-balanced", "true")
  await page.getByTestId("scope-ytd").click()
  await expect(page.getByTestId("cf-balanced")).toHaveAttribute("data-balanced", "true")

  await page.goto("/frs/withholding")
  await expect(page.getByTestId("frs-wht")).toBeVisible()
  await expect(page.getByTestId("tax-deposits")).toBeVisible()

  // The auditor reads, but cannot submit or pay.
  await page.goto("/frs/vat")
  await expect(page.getByTestId("vat-summary")).toBeVisible()
  await expect(page.getByTestId("vat-submit")).toBeDisabled()
})

test("last month's VAT return is submitted (simulated e-VAT) and its tax deposited", async ({ page }) => {
  test.setTimeout(150_000)
  const last = lastMonthDay()
  await signIn(page, "farzana")
  await page.goto(`/frs/vat?month=${last.month}`)
  const summary = page.getByTestId("vat-summary")
  await expect(summary).toHaveAttribute("data-month", last.month)
  await expect(summary).toHaveAttribute("data-submitted", "false")
  await page.getByTestId("vat-submit").click()
  await page.getByTestId("vat-submit-confirm").click()
  await expect(summary).toHaveAttribute("data-submitted", "true")
  await expect(page.getByTestId("vat-status")).toContainText("NBR-EVAT-")

  // Deposit each kind that is due, once.
  for (const kind of ["vat", "vds", "ait"]) {
    const pay = page.locator(`[data-testid="tax-pay"][data-kind="${kind}"]`)
    if ((await pay.count()) === 0) continue
    await pay.click()
    await page.getByTestId("tax-pay-confirm").click()
    await expect(pay).toHaveCount(0)
    await expect(page.locator(`[data-testid="tax-deposit-row"][data-kind="${kind}"] [data-testid="doc-link"]`).first()).toBeVisible()
  }

  // The registers list the documents behind the return.
  await page.getByTestId("vat-tab-sales").click()
  await expect(page.getByTestId("vat-sales-count")).toBeVisible()
  await page.getByTestId("vat-tab-purchases").click()
  await expect(page.getByTestId("vat-purchases-count")).toBeVisible()
})
