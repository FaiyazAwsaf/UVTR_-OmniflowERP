import { expect, test, type Page } from "@playwright/test"

import { fillVoucher, signIn } from "./helpers"

/**
 * Screenshots of every FA and FRS screen for review (plan §13.1 rule 8), EN
 * and BN at 960x600 and 1920x1200. Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/shots E2E_PORT=3403 bunx playwright test tests/e2e/fa/screenshots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const

test.skip(!SHOTS, "SHOTS_DIR not set")

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

const SCREENS: { path: string; name: string; ready: string }[] = [
  { path: "/fa", name: "fa-home", ready: "fa-home" },
  { path: "/fa/accounts", name: "fa-accounts", ready: "accounts-tree" },
  { path: "/fa/journals", name: "fa-journals", ready: "journal-row" },
  { path: "/fa/ledger?account=acc_1121", name: "fa-ledger", ready: "ledger-row" },
  { path: "/fa/ledger", name: "fa-general-ledger", ready: "general-ledger" },
  { path: "/fa/periods", name: "fa-periods", ready: "close-checklist" },
  { path: "/fa/recurring", name: "fa-recurring", ready: "recurring-status" },
  { path: "/fa/settings", name: "fa-settings", ready: "posting-map" },
  { path: "/frs", name: "frs-home", ready: "frs-home" },
  { path: "/frs/trial-balance", name: "frs-tb", ready: "tb-row" },
  { path: "/frs/profit-loss", name: "frs-pl", ready: "pl-total" },
  { path: "/frs/balance-sheet", name: "frs-bs", ready: "bs-row" },
  { path: "/frs/cash-flow", name: "frs-cf", ready: "cf-row" },
  { path: "/frs/vat", name: "frs-vat", ready: "vat-summary" },
  { path: "/frs/withholding", name: "frs-wht", ready: "tax-deposits" },
]

for (const lang of LANGS) {
  for (const size of SIZES) {
    const tag = `${lang}-${size.name}`
    test(`FA and FRS screens ${tag}`, async ({ page }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, "farzana", `&lang=${lang}`)
      for (const screen of SCREENS) {
        await page.goto(screen.path)
        await expect(page.getByTestId(screen.ready).first()).toBeVisible({ timeout: 30_000 })
        await shot(page, `${screen.name}-${tag}`)
      }
      // Tax settings tab, the P&L by month, the VAT sales register.
      await page.goto("/fa/settings")
      await page.getByTestId("settings-tab-tax").click()
      await expect(page.getByTestId("tax-settings")).toBeVisible()
      await shot(page, `fa-settings-tax-${tag}`)
      await page.goto("/frs/profit-loss")
      await page.getByTestId("pl-view-months").click()
      await expect(page.locator('[data-testid="frs-pl"] th[data-col="ytd"]')).toBeVisible()
      await shot(page, `frs-pl-months-${tag}`)
      await page.goto("/frs/vat")
      await page.getByTestId("vat-tab-sales").click()
      await expect(page.getByTestId("vat-sales-count")).toBeVisible()
      await shot(page, `frs-vat-sales-${tag}`)
      // A posted document voucher, its print preview, and a new voucher being entered.
      await page.goto("/fa/journals")
      await page.locator('[data-testid="journal-row"][data-journal-no^="SV-"]').first().click()
      await expect(page.getByTestId("voucher-view")).toBeVisible()
      await shot(page, `fa-voucher-${tag}`)
      await page.getByTestId("voucher-print").click()
      await expect(page.getByTestId("voucher-print-dialog")).toBeVisible()
      await shot(page, `fa-voucher-print-${tag}`)
      await page.keyboard.press("Escape")
      await page.goto("/fa/journals/new")
      // Above Farzana's ৳10,00,000 journal limit, so it waits for Rashed ("You prepared this").
      await fillVoucher(page, { narration: "Electricity accrual", debit: "6300", credit: "2175", amount: "1200000" })
      await shot(page, `fa-journal-new-${tag}`)
      await page.getByTestId("journal-save").click()
      await expect(page).toHaveURL(/\/fa\/journals\/jnl_/)
      await page.getByTestId("journal-submit").click()
      await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-status", "pending-approval")
      await shot(page, `fa-voucher-pending-${tag}`)
    })
  }
}
