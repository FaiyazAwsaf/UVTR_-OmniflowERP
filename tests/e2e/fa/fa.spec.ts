import { expect, test } from "@playwright/test"

import { fillVoucher, lastMonthDay, secondWindow, signIn } from "./helpers"

/**
 * FA Core Accounting by hand (plan §10 E10, E11; §9 FA screens). Each test
 * gets a freshly seeded browser; second windows share its database.
 */

test("accounting home, chart, ledger drill and the other FA screens load on seeded data", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, "mahbub")
  await expect(page.getByTestId("fa-home")).toBeVisible()
  await expect(page.getByTestId("tb-balanced")).toHaveAttribute("data-balanced", "true")
  await expect(page.getByTestId("fa-home-recent").locator('[data-testid="doc-link"]').first()).toBeVisible()

  await page.goto("/fa/accounts")
  await expect(page.getByTestId("account-row").first()).toBeVisible()
  await expect(page.locator('[data-testid="account-row"][data-code="1150"] [data-testid="account-control"]')).toBeVisible()
  // Mahbub may not edit the chart.
  await expect(page.getByTestId("account-new")).toHaveCount(0)

  // The bank ledger: opening, running balance, a line drills to its voucher and source.
  await page.goto("/fa/ledger?account=acc_1121")
  await expect(page.getByTestId("ledger-row").first()).toBeVisible()
  await expect(page.getByTestId("ledger-closing")).toBeVisible()
  const voucherNo = await page.getByTestId("ledger-row").first().getAttribute("data-journal-no")
  await page.getByTestId("ledger-row").first().locator("a").click()
  await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-journal-no", voucherNo!)
  await expect(page.getByTestId("voucher-view")).toBeVisible()

  await page.goto("/fa/journals")
  await expect(page.getByTestId("journal-row").first()).toBeVisible()
  await page.getByTestId("journal-filter-type").click()
  await page.getByRole("option", { name: /Sales voucher/ }).click()
  await expect(page.locator('[data-testid="journal-row"][data-journal-no^="SV-"]').first()).toBeVisible()

  await page.goto("/fa/recurring")
  await expect(page.getByTestId("recurring-template")).toHaveCount(3)
  await expect(page.getByTestId("recurring-post")).toBeVisible()

  await page.goto("/fa/settings")
  await expect(page.getByTestId("posting-map")).toBeVisible()
  await page.getByTestId("settings-tab-tax").click()
  await expect(page.getByTestId("demo-values").first()).toBeVisible()
})

test("E10: maker-checker on a journal voucher above the preparer's limit", async ({ page, context }) => {
  test.setTimeout(150_000)
  await signIn(page, "mahbub")
  await page.goto("/fa/journals/new")
  await fillVoucher(page, { narration: "Electricity accrual, Gulshan", debit: "6300", credit: "2175", amount: "120000" })
  await page.getByTestId("journal-save").click()
  await expect(page).toHaveURL(/\/fa\/journals\/jnl_/)
  await page.getByTestId("journal-submit").click()
  // Above Mahbub's ৳50,000: waiting for an approver; he prepared it, so no approve action.
  await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-status", "pending-approval")
  await expect(page.getByTestId("voucher-approve-hint")).toBeVisible()
  await expect(page.getByTestId("voucher-approve")).toHaveCount(0)
  await expect(page.getByTestId("approval-chip")).toHaveAttribute("data-status", "pending")
  const url = page.url()
  const voucherNo = await page.getByTestId("voucher-page").getAttribute("data-journal-no")

  // Farzana approves in her window; Mahbub's window shows it posted, live.
  const farzana = await secondWindow(context, "farzana")
  await farzana.goto(url)
  await farzana.getByTestId("voucher-approve").click()
  await farzana.getByTestId("voucher-decide-confirm").click()
  await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-status", "posted")
  await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-status", "posted")
  await expect(page.getByTestId("voucher-view")).toHaveAttribute("data-journal-no", voucherNo!)
  await expect(page.getByTestId("voucher-balanced")).toBeVisible()

  // Farzana's own ৳12,00,000 voucher: "You prepared this"; Rashed approves it.
  await farzana.goto("/fa/journals/new")
  await fillVoucher(farzana, { narration: "Salaries paid by bank", debit: "2170", credit: "1121", amount: "1200000" })
  await farzana.getByTestId("journal-submit").click()
  await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-status", "pending-approval")
  await expect(farzana.getByTestId("voucher-approve-hint")).toBeVisible()
  await expect(farzana.getByTestId("voucher-approve")).toHaveCount(0)
  const rashed = await secondWindow(context, "rashed")
  await rashed.goto(farzana.url())
  await rashed.getByTestId("voucher-approve").click()
  await rashed.getByTestId("voucher-decide-confirm").click()
  await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-status", "posted")

  // A posted manual voucher is reversed, never edited.
  await farzana.getByTestId("journal-reverse").click()
  await farzana.getByTestId("journal-reverse-reason").fill("Entered twice")
  await farzana.getByTestId("journal-reverse-confirm").click()
  await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-status", "reversed")
})

test("E11: last month's close is blocked by a draft, then closes; posting into it is refused", async ({ page, context }) => {
  test.setTimeout(150_000)
  const last = lastMonthDay()
  await signIn(page, "mahbub")
  await page.goto("/fa/journals/new")
  await fillVoucher(page, { narration: "Water bill accrual", debit: "6300", credit: "2175", amount: "8000", date: last.dmy })
  await page.getByTestId("journal-save").click()
  await expect(page).toHaveURL(/\/fa\/journals\/jnl_/)

  const farzana = await secondWindow(context, "farzana")
  await farzana.goto("/fa/periods")
  const checklist = farzana.getByTestId("close-checklist")
  await expect(checklist).toBeVisible()
  await expect(farzana.locator(`[data-testid="period-row"][data-month="${last.month}"]`)).toHaveAttribute("data-status", "open")
  await expect(checklist.locator('[data-testid="close-check"][data-key="journals"]')).toHaveAttribute("data-ok", "false")
  await expect(checklist).toHaveAttribute("data-allowed", "false")

  // Close is refused by the engine (INV-13) while the draft is there.
  await farzana.getByTestId("period-close").click()
  await farzana.getByTestId("period-close-confirm").click()
  await expect(farzana.getByRole("dialog").filter({ hasText: /can't close yet/ })).toBeVisible()
  await farzana.keyboard.press("Escape")

  // Discard the draft from the checklist link; the checklist clears live.
  await checklist.getByTestId("close-check-item").first().locator("a").click()
  await farzana.getByTestId("journal-discard").click()
  await farzana.getByTestId("journal-discard-confirm").click()
  await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-status", "discarded")
  await farzana.goto("/fa/periods")
  await expect(farzana.getByTestId("close-checklist")).toHaveAttribute("data-allowed", "true")
  await farzana.getByTestId("period-close").click()
  await farzana.getByTestId("period-close-confirm").click()
  await expect(farzana.locator(`[data-testid="period-row"][data-month="${last.month}"]`)).toHaveAttribute("data-status", "closed")

  // A posting dated in the closed month is refused (PERIOD_CLOSED).
  await page.goto("/fa/journals/new")
  await fillVoucher(page, { narration: "Late accrual", debit: "6300", credit: "2175", amount: "500", date: last.dmy })
  await page.getByTestId("journal-save").click()
  await expect(page.getByRole("dialog").filter({ hasText: /is closed/ })).toBeVisible()

  // Reopen with a reason.
  await farzana.locator(`[data-testid="period-row"][data-month="${last.month}"]`).getByTestId("period-reopen").click()
  await farzana.getByTestId("period-reopen-reason").fill("Late utility bill")
  await farzana.getByTestId("period-reopen-confirm").click()
  await expect(farzana.locator(`[data-testid="period-row"][data-month="${last.month}"]`)).toHaveAttribute("data-status", "open")
})

test("recurring journals post once for the current month", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, "mahbub")
  await page.goto("/fa/recurring")
  await expect(page.getByTestId("recurring-status")).toHaveCount(3)
  await page.getByTestId("recurring-post").click()
  await expect(page.getByTestId("recurring-status").first().locator('[data-testid="doc-link"]')).toBeVisible()
  await expect(page.getByTestId("recurring-post")).toBeDisabled()
})
