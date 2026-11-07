import { expect, test } from "@playwright/test"

import { signIn } from "../shell/helpers"

/** CAB screens (plan §9): cash position and books, transfers, petty cash, settlements, E7 reconciliation, E8 bounce. */
test.describe("CAB cash and bank", () => {
  test("cash position lists every account and opens its book", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/cab")
    await expect(page.getByTestId("cash-position")).toBeVisible()
    await expect(page.getByTestId("position-row")).toHaveCount(10)
    await page.locator('[data-testid="position-row"][data-account="BANK-BRAC"] a').click()
    await expect(page.getByTestId("account-book")).toBeVisible()
    await expect(page.getByTestId("book-row").first()).toBeVisible()
  })

  test("a cashier deposits till cash to the bank and raises a petty cash voucher above her limit", async ({ page }) => {
    await signIn(page, "tania")
    await page.goto("/cab/transfers")
    await page.getByTestId("transfer-new").click()
    await page.getByTestId("transfer-amount").click()
    await page.getByTestId("transfer-amount").fill("1000")
    await page.getByTestId("transfer-save").click()
    await expect(page.getByTestId("transfer-row").first()).toContainText("CT-")

    await page.goto("/cab/petty-cash")
    await page.getByTestId("petty-new").click()
    await page.getByTestId("petty-amount").click()
    await page.getByTestId("petty-amount").fill("3500")
    await page.getByTestId("petty-payee").fill("Local hardware shop")
    await page.getByTestId("petty-description").fill("Hose fittings for W1")
    await page.getByTestId("petty-save").click()
    await expect(page.locator('[data-testid="petty-row"][data-status="pending-approval"]').first()).toBeVisible()
  })

  test("a bKash settlement posts to the bank with its fee", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/cab/settlements")
    await page.getByTestId("settlement-new").click()
    await page.getByTestId("settlement-kind").locator('[data-value="bkash"]').click()
    await page.getByTestId("settlement-gross").click()
    await page.getByTestId("settlement-gross").fill("1000")
    await page.getByTestId("settlement-ref").fill("BK-SET-E2E")
    await page.getByTestId("settlement-save").click()
    await expect(page.getByTestId("settlement-row").first()).toContainText("SET-")
  })

  test("E8: Metro's post-dated cheque is deposited, then bounces; the receipt is bounced", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/cab/cheques?id=chq_e8_metro")
    const row = page.locator('[data-testid="cheque-row"][data-status="in-hand"]').filter({ hasText: "Metro Corporate" }).first()
    await expect(row).toBeVisible()
    const no = (await row.getAttribute("data-cheque-no"))!
    await row.getByTestId("cheque-deposit").click()
    const deposited = page.locator(`[data-testid="cheque-row"][data-cheque-no="${no}"]`)
    await expect(deposited).toHaveAttribute("data-status", "deposited")
    await deposited.getByTestId("cheque-bounce").click()
    await page.getByTestId("reason-confirm").click()
    await expect(deposited).toHaveAttribute("data-status", "bounced")
    await page.goto("/ar/receipts?id=mr_e8_metro")
    await expect(page.getByTestId("receipt-detail")).toContainText("Bounced")
  })

  test("E7: last month's statement auto-matches, the ৳575 charge posts and the reconciliation completes", async ({ page }) => {
    test.setTimeout(90_000)
    await signIn(page, "mahbub")
    await page.goto("/cab/reconciliation")
    await page.getByTestId("recon-import").click()
    await expect(page.getByTestId("recon-line").first()).toBeVisible()
    await page.getByTestId("recon-auto").click()
    const open = page.locator('[data-testid="recon-line"][data-matched="false"]')
    await expect(open).toHaveCount(1)
    await expect(open).toHaveAttribute("data-amount", "-57500")
    await open.getByTestId("recon-post-charge").click()
    await expect(open).toHaveCount(0)
    await page.getByTestId("recon-complete").click()
    await expect(page.getByTestId("recon-statement")).toHaveAttribute("data-status", "reconciled")
  })
})
