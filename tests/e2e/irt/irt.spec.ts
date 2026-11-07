import { expect, test } from "@playwright/test"

import { signIn } from "../shell/helpers"

/**
 * IRT screens (plan §9) and E16 by hand: the catalogue of the 33 standard
 * reports, a run with parameters recorded in the history, the report
 * builder saving revenue by service category × studio with a bar chart,
 * and a schedule "sent" by simulated email.
 */
test.describe("IRT", () => {
  test("the catalogue lists the 33 standard reports by suite; FRS statements open in FRS", async ({ page }) => {
    await signIn(page, "rashed")
    await page.goto("/irt")
    await expect(page.getByTestId("irt-catalogue")).toBeVisible()
    const system = page.locator('[data-testid^="catalogue-suite-"] [data-testid="report-card"]')
    await expect(system).toHaveCount(33)
    for (const suite of ["fms", "sdm", "scm", "csc"]) await expect(page.getByTestId(`catalogue-suite-${suite}`)).toBeVisible()
    await expect(page.locator('[data-testid="report-card"][data-code="IRT-02"] [data-testid="report-open"]')).toHaveAttribute(
      "href",
      "/frs/trial-balance"
    )
    await page.getByTestId("suite-filter-csc").click()
    await expect(system).toHaveCount(3)
  })

  test("an advisor sees reports outside their apps locked", async ({ page }) => {
    await signIn(page, "nayeem")
    await page.goto("/irt")
    await expect(page.locator('[data-testid="report-card"][data-code="IRT-01"]')).toHaveAttribute("data-locked", "true")
    await expect(page.locator('[data-testid="report-card"][data-code="IRT-16"]')).toHaveAttribute("data-locked", "false")
  })

  test("run the login history with parameters; the run is in the history; print preview on paper", async ({ page }) => {
    await signIn(page, "tahmid")
    await page.goto("/irt/run/IRT-31")
    await expect(page.getByTestId("report-params")).toBeVisible()
    await expect(page.getByTestId("report-result")).toBeVisible()
    await expect(page.getByTestId("report-row").first()).toBeVisible()
    await page.getByTestId("preset-last7").click()
    await page.getByTestId("report-filter-add").click()
    await page.getByTestId("report-run").click()
    await expect(page.getByTestId("report-result")).toBeVisible()
    // The administrator holds no irt.export: no CSV button.
    await expect(page.getByTestId("report-csv")).toHaveCount(0)
    await page.getByTestId("report-print-preview").click()
    await expect(page.getByTestId("report-print-sheet")).toBeVisible()
    await expect(page.locator('[data-slot="print-layout"]')).toBeVisible()
    await page.keyboard.press("Escape")

    await page.goto("/irt/history")
    await expect(page.locator('[data-testid="history-row"][data-code="IRT-31"]').first()).toBeVisible()
    expect(await page.locator('[data-testid="history-row"][data-code="IRT-31"]').count()).toBeGreaterThanOrEqual(2)
  })

  test("E16: build revenue by service category × studio, bar chart, save, run and schedule it", async ({ page }) => {
    test.setTimeout(90_000)
    await signIn(page, "rashed")
    await page.goto("/irt/builder")
    await page.getByTestId("builder-dataset").click()
    await page.getByRole("option", { name: "Invoice lines" }).click()
    // Columns: category, location, net only.
    for (const field of ["date", "invoiceNo", "party", "segment", "service", "vehicleClass", "qty", "grossP", "discountP", "vatP", "advisor"]) {
      await page.locator(`[data-testid="builder-column"][data-field="${field}"]`).click()
    }
    await page.getByTestId("builder-filter-add").click()
    await expect(page.getByTestId("builder-filter")).toHaveCount(1)
    await page.getByTestId("builder-group-1").click()
    await page.getByRole("option", { name: "Category" }).click()
    await page.getByTestId("builder-group-2").click()
    await page.getByRole("option", { name: "Location" }).click()
    await expect(page.locator('[data-testid="builder-total"][data-field="netP"]')).toHaveAttribute("aria-checked", "true")
    await page.getByTestId("builder-chart").click()
    await page.getByRole("option", { name: "Bar" }).click()
    await page.getByTestId("builder-chart-series").click()
    await page.getByRole("option", { name: "Location" }).click()
    await page.getByTestId("builder-range").click()
    await page.getByRole("option", { name: "Last 30 days" }).click()
    await expect(page.getByTestId("builder-preview")).toBeVisible()

    await page.getByTestId("builder-save").click()
    await page.getByTestId("builder-name-en").fill("Revenue by category and studio")
    await page.getByTestId("builder-save-confirm").click()
    await expect(page.getByText(/saved as RPT-\d{4}/)).toBeVisible()
    await expect(page).toHaveURL(/\/irt\/builder\?id=/)

    await page.goto("/irt")
    const card = page.locator('[data-testid="catalogue-saved"] [data-testid="report-card"]').first()
    await expect(card).toContainText("Revenue by category and studio")
    await card.getByTestId("report-open").click()
    await expect(page.getByTestId("report-runner")).toBeVisible()
    await expect(page.getByTestId("report-result")).toBeVisible()
    // The owner holds irt.export.
    await expect(page.getByTestId("report-csv")).toBeVisible()

    await page.goto("/irt/schedules")
    await page.getByTestId("schedule-new").click()
    await page.getByTestId("schedule-report").click()
    await page.getByTestId("schedule-report-search").fill("Revenue by category")
    await page.getByTestId("schedule-report-option").first().click()
    await page.getByTestId("schedule-recipients").fill("owner@example.com, accounts@example.com")
    await page.getByTestId("schedule-save").click()
    const row = page.getByTestId("schedule-row").first()
    await expect(row).toBeVisible()
    await row.getByTestId("schedule-send").click()
    await expect(page.getByTestId("report-email").first()).toBeVisible()
  })
})
