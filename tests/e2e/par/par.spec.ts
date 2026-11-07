import { expect, test } from "@playwright/test"

import { signIn } from "../shell/helpers"

/** PAR screens (plan §9): list and search, new party with the duplicate warning, party 360, vehicles, E15 conflict. */
test.describe("PAR party management", () => {
  test("the list finds a customer by phone and opens the party 360 with his vehicle", async ({ page }) => {
    await signIn(page, "nayeem")
    await page.goto("/par")
    await expect(page.getByTestId("party-row").first()).toBeVisible()
    await page.getByTestId("party-search").fill("01819-447731")
    await expect(page.getByTestId("party-row")).toHaveCount(1)
    await page.getByTestId("party-row").first().click()
    await expect(page).toHaveURL(/\/par\/pty_shahed_kabir/)
    await expect(page.getByTestId("party-360")).toBeVisible()
    await expect(page.locator('[data-testid="vehicle-row"][data-reg="DHAKA METRO-GHA 15-7731"]')).toBeVisible()
  })

  test("a new customer shows the duplicate warning, then saves and gets a vehicle", async ({ page }) => {
    await signIn(page, "nayeem")
    await page.goto("/par")
    await page.getByTestId("party-new").click()
    await expect(page).toHaveURL(/\/par\/new/)
    await page.getByTestId("party-name").fill("Shahed Kabir")
    await page.getByTestId("party-phone").fill("01819-447731")
    await expect(page.getByTestId("party-duplicate-warning")).toBeVisible()
    await page.getByTestId("party-name").fill("Tahsin Rahman Test")
    await page.getByTestId("party-phone").fill("01700-123987")
    await expect(page.getByTestId("party-duplicate-warning")).toHaveCount(0)
    await page.getByTestId("party-save").click()
    await expect(page.getByTestId("party-360")).toBeVisible()
    await expect(page.getByTestId("party-name")).toHaveText("Tahsin Rahman Test")

    await page.getByTestId("vehicle-add").click()
    await page.getByTestId("vehicle-reg").fill("dhaka metro-ga 31-2468")
    await page.getByTestId("vehicle-model").fill("Axio")
    await page.getByTestId("vehicle-save").click()
    await expect(page.locator('[data-testid="vehicle-row"][data-reg="DHAKA METRO-GA 31-2468"]')).toBeVisible()

    // The registry finds it by Bangla digits.
    await page.goto("/par/vehicles")
    await page.getByTestId("vehicle-search").fill("৩১-২৪৬৮")
    await expect(page.getByTestId("vehicle-row")).toHaveCount(1)
  })

  test("an on-hold customer shows the credit-hold banner", async ({ page }) => {
    await signIn(page, "farzana")
    await page.goto("/par/pty_orbit")
    await expect(page.getByTestId("party-360")).toHaveAttribute("data-status", "on-hold")
    await expect(page.getByTestId("credit-hold-banner")).toBeVisible()
  })

  test("E15: two windows editing the same contact phone get the conflict dialog", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const one = await context.newPage()
    const two = await context.newPage()
    await signIn(one, "farzana")
    await signIn(two, "mahbub")
    for (const p of [one, two]) {
      await p.goto("/par/pty_greenway")
      await p.getByTestId("party-edit").click()
      await expect(p.getByTestId("party-form")).toBeVisible()
    }
    await one.getByTestId("party-phone").fill("01711-000001")
    await one.getByTestId("party-save").click()
    await expect(one.getByTestId("party-phone-text")).toHaveText("01711-000001")
    await two.getByTestId("party-phone").fill("01711-000002")
    await two.getByTestId("party-save").click()
    await expect(two.getByText("This record was changed")).toBeVisible()
    await context.close()
  })
})
