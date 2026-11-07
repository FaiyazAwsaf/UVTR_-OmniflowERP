import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../shell/helpers"

async function approveInInbox(page: Page, docNo: string) {
  await page.goto("/approvals")
  const row = page.getByTestId("approval-row").filter({ hasText: docNo })
  await expect(row).toBeVisible()
  await row.getByTestId("approval-approve").click()
  await page.getByTestId("approval-confirm").click()
  await expect(page.getByTestId("approval-dialog")).toBeHidden()
}

/** AP screens (plan §9): aging, E5 three-way mismatch released, E6 payment with withholding and the Mushak 6.6 print. */
test.describe("AP accounts payable", () => {
  test("aging ties to the payables account; debit notes list opens", async ({ page }) => {
    await signIn(page, "mahbub")
    await page.goto("/ap")
    await expect(page.getByTestId("ap-home")).toBeVisible()
    await page.goto("/ap/aging")
    await expect(page.getByTestId("aging-tie")).toHaveAttribute("data-tie", "true")
    await page.goto("/ap/debit-notes")
    await expect(page.getByTestId("debit-notes")).toBeVisible()
  })

  test("E6: Prime Guard paid by cheque, AIT 6,000 and VDS 9,000 withheld, approved by Farzana, Mushak 6.6 printed", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const maker = await context.newPage()
    const checker = await context.newPage()
    await signIn(maker, "mahbub")
    await signIn(checker, "farzana")
    await maker.goto("/ap/payments/new?party=pty_prime_guard&bill=bl_e6_prime_guard")
    await maker.getByTestId("payment-method").locator('[data-value="cheque"]').click()
    await maker.getByTestId("payment-cheque-no").fill("7319001")
    await expect(maker.getByTestId("withholding-ait")).toHaveAttribute("data-amount", "600000")
    await expect(maker.getByTestId("withholding-vds")).toHaveAttribute("data-amount", "900000")
    await expect(maker.getByTestId("payment-net")).toHaveAttribute("data-amount", "5400000")
    await expect(maker.getByTestId("payment-limit")).toContainText("approver")
    await maker.getByTestId("payment-save").click()
    await expect(maker.getByTestId("payment-view")).toBeVisible()
    await expect(maker.getByTestId("payment-status")).toHaveAttribute("data-status", "pending-approval")
    const paymentNo = (await maker.getByTestId("payment-view").getAttribute("data-payment-no"))!

    await approveInInbox(checker, paymentNo)
    await expect(maker.getByTestId("payment-status")).toHaveAttribute("data-status", "posted")
    await maker.getByTestId("certificate-print").click()
    await expect(maker.getByTestId("certificate-sheet")).toBeVisible()
    await expect(maker.getByTestId("certificate-sheet")).toContainText("৳9,000")
    await context.close()
  })

  test("E5: a goods bill priced 6% over the PO goes on hold and Farzana releases it", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const maker = await context.newPage()
    const checker = await context.newPage()
    await signIn(maker, "mahbub")
    await signIn(checker, "farzana")
    await maker.goto("/ap/bills")
    await maker.getByTestId("bill-new").click()
    await maker.getByTestId("bill-vendor").click()
    await maker.getByTestId("bill-vendor-search").fill("Bengal Detail")
    await maker.getByTestId("bill-vendor-option").first().click()
    const panel = maker.getByTestId("match-panel")
    const matched = panel.locator('[data-testid="match-line"][data-matched="true"]').first()
    await expect(matched).toBeVisible()
    const grnLine = (await matched.getAttribute("data-grn-line"))!
    const price = panel.locator(`[data-testid="match-line"][data-grn-line="${grnLine}"]`).getByTestId("bill-price")
    const po = Number((await price.inputValue()).replace(/,/g, ""))
    await price.click()
    await price.fill((Math.round(po * 106) / 100).toFixed(2))
    await price.blur()
    await expect(panel.getByTestId("match-diff").first()).toHaveAttribute("data-field", "price")
    await expect(maker.getByTestId("bill-result")).toBeVisible()
    await maker.getByTestId("bill-vendor-ref").fill("BDS/E5/001")
    await maker.getByTestId("bill-save").click()
    await expect(maker.getByTestId("bill-status")).toHaveAttribute("data-status", "on-hold")
    const billNo = (await maker.getByTestId("bill-view").getAttribute("data-bill-no"))!

    await approveInInbox(checker, billNo)
    await expect(maker.getByTestId("bill-status")).toHaveAttribute("data-status", "posted")
    await context.close()
  })
})
