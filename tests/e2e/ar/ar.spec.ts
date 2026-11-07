import { expect, test } from "@playwright/test"

import { signIn } from "../shell/helpers"

/** AR screens (plan §9): home, aging tie, the E2 receipt with VDS and AIT, refunds, credit control, statement. */
test.describe("AR accounts receivable", () => {
  test("aging ties to the receivables account and the advances to 2130", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/ar")
    await expect(page.getByTestId("ar-home")).toBeVisible()
    await page.goto("/ar/aging")
    await expect(page.getByTestId("aging-total")).toBeVisible()
    await expect(page.getByTestId("aging-tie")).toHaveAttribute("data-tie", "true")
    await expect(page.getByTestId("advance-tie")).toContainText("2130")
  })

  test("E2 receipt side: Swift Ride pays with VDS and AIT deducted; the grid allocates oldest first", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/ar/receipts")
    await page.getByTestId("receipt-new").click()
    await expect(page).toHaveURL(/\/ar\/receipts\/new/)
    await page.getByTestId("receipt-party").click()
    await page.getByTestId("receipt-party-search").fill("Swift Ride")
    await page.getByTestId("receipt-party-option").first().click()
    await page.getByTestId("receipt-method").getByRole("radio", { name: "Bank transfer" }).click()
    await expect(page.getByTestId("receipt-allocation").getByTestId("alloc-row").first()).toBeVisible()
    await page.getByTestId("receipt-amount").fill("100000")
    await page.getByTestId("receipt-amount").blur()
    // The oldest invoice takes the money first, and the deductions are proposed.
    await expect(page.getByTestId("alloc-input").first()).not.toHaveValue("")
    await expect(page.getByTestId("receipt-vds")).not.toHaveValue("0.00")
    await expect(page.getByTestId("receipt-save")).toBeDisabled()
    await page.getByTestId("receipt-certificate").fill("6.6/SRR/0091")
    await page.getByTestId("receipt-save").click()
    await expect(page).toHaveURL(/\/ar\/receipts\?id=/)
    await expect(page.getByTestId("receipt-detail")).toBeVisible()
    await expect(page.getByTestId("receipt-detail")).toContainText("6.6/SRR/0091")
  })

  test("a cash advance is refunded from the till (R28)", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/ar/receipts/new?party=pty_shahed_kabir")
    await page.getByTestId("receipt-method").getByRole("radio", { name: "Cash" }).click()
    await page.getByTestId("receipt-amount").fill("2000")
    await page.getByTestId("receipt-amount").blur()
    // Clear any allocation so the whole amount is held as advance.
    await page.getByTestId("alloc-clear").click()
    await page.getByTestId("receipt-save").click()
    await expect(page.getByTestId("receipt-detail")).toBeVisible()

    await page.goto("/ar/refunds")
    await page.getByTestId("refund-new").click()
    await page.getByTestId("refund-party").selectOption("pty_shahed_kabir")
    await page.getByTestId("refund-amount").fill("1500")
    await page.getByTestId("refund-reason").fill("Booking cancelled by the customer")
    await page.getByTestId("refund-save").click()
    await expect(page.getByTestId("refund-row").first()).toContainText("RF-")
  })

  test("credit control lists Orbit on hold and sends a reminder; the statement prints", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/ar/credit-control")
    const orbit = page.locator('[data-testid="credit-row"][data-party-id="pty_orbit"]')
    await expect(orbit).toHaveAttribute("data-status", "on-hold")
    await orbit.getByTestId("reminder-send").click()
    await expect(page.getByTestId("reminder-list")).toBeVisible()
    await page.goto("/ar/statements/pty_swift_ride")
    await expect(page.getByTestId("statement-sheet")).toBeVisible()
    await expect(page.getByTestId("statement-line").first()).toBeVisible()
  })
})
