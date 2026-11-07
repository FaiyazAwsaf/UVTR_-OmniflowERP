import { expect, test, type Page } from "@playwright/test"

import { readRows, signIn } from "../shell/helpers"

/**
 * Screenshots of every WS-FIN screen for review (plan §13.1 rule 8), EN and
 * BN at 960x600 and 1920x1200. Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/claude-1000/WS-FIN-shots E2E_PORT=3404 bunx playwright test tests/e2e/cab/screenshots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const

const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: "par-list", path: "/par", ready: "party-row" },
  { name: "par-new", path: "/par/new", ready: "party-form" },
  { name: "par-360", path: "/par/pty_swift_ride", ready: "party-360" },
  { name: "par-360-hold", path: "/par/pty_orbit", ready: "credit-hold-banner" },
  { name: "par-vehicles", path: "/par/vehicles", ready: "vehicle-row" },
  { name: "ar-home", path: "/ar", ready: "ar-home" },
  { name: "ar-receipts", path: "/ar/receipts", ready: "receipt-row" },
  { name: "ar-receipt-new", path: "/ar/receipts/new?party=pty_swift_ride", ready: "alloc-row" },
  { name: "ar-refunds", path: "/ar/refunds", ready: "refunds" },
  { name: "ar-aging", path: "/ar/aging", ready: "aging-total" },
  { name: "ar-credit", path: "/ar/credit-control", ready: "credit-row" },
  { name: "ar-statement", path: "/ar/statements/pty_swift_ride", ready: "statement-sheet" },
  { name: "ap-home", path: "/ap", ready: "ap-home" },
  { name: "ap-bills", path: "/ap/bills", ready: "bill-row" },
  { name: "ap-bill-held", path: "/ap/bills/bl_held_dhaka_autochem", ready: "bill-view" },
  { name: "ap-payments", path: "/ap/payments", ready: "payment-row" },
  { name: "ap-payment-new", path: "/ap/payments/new?party=pty_prime_guard&bill=bl_e6_prime_guard", ready: "pay-bill-row" },
  { name: "ap-aging", path: "/ap/aging", ready: "aging-total" },
  { name: "ap-debit-notes", path: "/ap/debit-notes", ready: "debit-notes" },
  { name: "cab-home", path: "/cab", ready: "position-row" },
  { name: "cab-book", path: "/cab/accounts/cba_brac", ready: "book-row" },
  { name: "cab-transfers", path: "/cab/transfers", ready: "transfer-row" },
  { name: "cab-cheques", path: "/cab/cheques", ready: "cheque-row" },
  { name: "cab-recon", path: "/cab/reconciliation", ready: "reconciliation" },
  { name: "cab-petty", path: "/cab/petty-cash", ready: "petty-box" },
  { name: "cab-settlements", path: "/cab/settlements", ready: "settlements" },
]

test.skip(!SHOTS, "SHOTS_DIR not set")

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

for (const lang of LANGS) {
  for (const size of SIZES) {
    const tag = `${lang}-${size.name}`
    test(`WS-FIN screens ${tag}`, async ({ page }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, "farzana", `&lang=${lang}`)
      for (const s of SCREENS) {
        await page.goto(s.path)
        await expect(page.getByTestId(s.ready).first()).toBeVisible({ timeout: 45_000 })
        await shot(page, `${s.name}-${tag}`)
      }
      // A goods bill with the match panel, a payment view with its certificate, the reconciliation after an import.
      await page.goto("/ap/bills/new")
      await page.getByTestId("bill-vendor").click()
      await page.getByTestId("bill-vendor-search").fill("Bengal")
      await page.getByTestId("bill-vendor-option").first().click()
      await expect(page.getByTestId("match-line").first()).toBeVisible()
      await shot(page, `ap-bill-new-${tag}`)
      const payments = await readRows<{ id: string; status: string; vdsCertificateNo?: string }>(page, "vendorPayments")
      const withVds = payments.find((p) => p.status === "posted" && p.vdsCertificateNo)!
      await page.goto(`/ap/payments/${withVds.id}`)
      await expect(page.getByTestId("payment-view")).toBeVisible()
      await shot(page, `ap-payment-view-${tag}`)
      await page.getByTestId("certificate-print").click()
      await expect(page.getByTestId("certificate-sheet")).toBeVisible()
      await shot(page, `ap-certificate-${tag}`)
      await page.keyboard.press("Escape")
      await page.goto("/cab/reconciliation")
      await page.getByTestId("recon-import").click()
      await expect(page.getByTestId("recon-line").first()).toBeVisible()
      await page.getByTestId("recon-auto").click()
      await expect(page.locator('[data-testid="recon-line"][data-matched="false"]')).toHaveCount(1)
      await shot(page, `cab-recon-imported-${tag}`)
      await page.goto("/ar/receipts/new?party=pty_swift_ride")
      await page.getByTestId("receipt-amount").click()
      await page.getByTestId("receipt-amount").fill("150000")
      await page.getByTestId("receipt-amount").blur()
      await shot(page, `ar-receipt-allocated-${tag}`)
    })
  }
}
