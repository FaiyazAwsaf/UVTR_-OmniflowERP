import { expect, test } from "@playwright/test"

import { approveInInbox, asUser, choose, docNo, signIn } from "./scm-helpers"

/**
 * IC screens and E9 by hand: Habib opens a count at Gulshan, enters counts
 * with variances, posts; above his ৳1,000 it waits for Shahriar, who
 * approves it from his inbox, and the count posts its journal.
 */
test("E9: a Gulshan count with variances goes to Shahriar and posts", async ({ page, context }) => {
  test.setTimeout(180_000)
  await signIn(page, "habib")
  await page.goto("/ic/counts")
  await page.getByTestId("count-open").click()
  await choose(page, page.getByTestId("count-location"), /Gulshan/)
  await page.getByTestId("count-open-submit").click()
  await expect(page.getByTestId("count-detail")).toBeVisible()
  const countNo = await docNo(page)
  expect(countNo).toMatch(/^CNT-GUL-\d{4}-\d{3}$/)
  await page.getByTestId("count-fill").click()
  // Lines counted short (nothing on the shelf) until the variance is above
  // Habib's ৳1,000 and within Shahriar's ৳5,000, like E9's ৳4,200.
  const total = async () => Number(await page.getByTestId("count-variance-total").getAttribute("data-total-p"))
  const lines = page.getByTestId("count-line")
  const n = await lines.count()
  for (let i = 0; i < n && (await total()) < 1_500_00; i++) {
    const before = await total()
    const expected = (await lines.nth(i).getAttribute("data-expected")) ?? "0"
    await page.getByTestId("count-qty").nth(i).fill("0")
    await page.waitForTimeout(150)
    if ((await total()) > 4_900_00) {
      await page.getByTestId("count-qty").nth(i).fill(expected)
      await expect.poll(total).toBe(before)
    }
  }
  expect(await total()).toBeGreaterThan(1_000_00)
  await expect(page.getByTestId("count-limit-note")).toContainText("wait for approval")
  await page.getByTestId("count-post").click()
  await expect(page.getByTestId("count-detail").locator('[data-status="pending-approval"]').first()).toBeVisible()
  await expect(page.getByTestId("approval-chip")).toBeVisible()

  const shahriar = await asUser(context, "shahriar")
  await approveInInbox(shahriar, countNo)
  await expect(page.getByTestId("count-detail").locator('[data-status="posted"]').first()).toBeVisible()
  await expect(page.getByTestId("journal-link")).toBeVisible()
})

test("stock by location, stock card, reorder to a requisition, expiry watch, consumption variance", async ({ page }) => {
  test.setTimeout(150_000)
  await signIn(page, "shahriar")
  await page.goto("/ic")
  await expect(page.getByTestId("stock-row").first()).toBeVisible()
  await page.getByTestId("stock-row").first().click()
  await expect(page.getByTestId("stock-card")).toBeVisible()
  await expect(page.getByTestId("stock-card-row").first()).toBeVisible()
  // The cutover balance is brought forward (an item with few moves, so it is on the first page).
  await page.goto("/ic/items/itm_cc2_kit?location=loc_cst")
  await expect(page.locator('[data-testid="stock-card-row"][data-type="opening"]').first()).toBeAttached()

  await page.goto("/ic/expiry")
  await choose(page, page.getByTestId("expiry-window"), /All batches/)
  await expect(page.getByTestId("expiry-row").first()).toBeVisible()

  await page.goto("/ic/consumption")
  await expect(page.getByTestId("consumption-row").first()).toBeVisible()

  await page.goto("/ic/reorder")
  const suggestion = page.locator('[data-testid="reorder-suggestion"][data-location="GUL"]').first()
  await expect(suggestion).toBeVisible()
  await suggestion.getByTestId("reorder-select").click()
  await page.getByTestId("reorder-raise-pr").click()
  await expect(page.getByTestId("pr-editor")).toBeVisible()
  await expect(page.getByTestId("pr-line")).toHaveCount(1)
})
