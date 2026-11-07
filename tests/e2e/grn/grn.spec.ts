import { expect, test } from "@playwright/test"

import { approveInInbox, asUser, choose, docNo, pick, signIn } from "../ic/scm-helpers"

/**
 * E4 by hand (plan §10): a fresh PO to Gloss & Guard for 24 ceramic 2-year
 * kits and 12 finishing polish, approved by Farzana above Nusrat's limit;
 * Habib receives 20 kits (2 rejected, short expiry, into quarantine) and 12
 * polish: "18 accepted · 6 pending"; the quarantined lot is accepted; one
 * polish goes back to the vendor with a Mushak 6.8 debit note.
 */
test("E4: PO, approval, partial GRN with a quarantined reject, quarantine accept, return with debit note", async ({ page, context }) => {
  test.setTimeout(240_000)
  await signIn(page, "nusrat")
  await page.goto("/ptl/po/new")
  await expect(page.getByTestId("po-editor")).toBeVisible()
  await pick(page, page.getByTestId("po-vendor"), "Gloss", "po-vendor")
  await pick(page, page.getByTestId("po-line-item").first(), "CH-CC2-50", "po-line-item")
  await page.getByTestId("po-qty").first().fill("24")
  await page.getByTestId("po-line-add").click()
  await pick(page, page.getByTestId("po-line-item").nth(1), "CH-POL-1L", "po-line-item")
  await page.getByTestId("po-qty").nth(1).fill("12")
  await page.getByTestId("po-issue").click()
  await expect(page.getByTestId("po-view")).toBeVisible()
  const poNo = await docNo(page)
  expect(poNo).toMatch(/^PO-\d{4}-\d{4}$/)
  await expect(page.getByTestId("po-view").locator('[data-status="pending-approval"]').first()).toBeVisible()

  // ৳2,26,320 is above Nusrat's ৳1,00,000: Farzana approves it from her inbox.
  const farzana = await asUser(context, "farzana")
  await approveInInbox(farzana, poNo)
  await expect(page.getByTestId("po-view").locator('[data-status="issued"]').first()).toBeVisible()
  await page.getByTestId("po-send").click()
  await expect(page.getByTestId("po-sent")).toBeVisible()
  await page.getByTestId("po-print").click()
  await expect(page.getByTestId("po-print-sheet")).toBeVisible()
  await page.keyboard.press("Escape")

  // Habib receives at the Central Store.
  const habib = await asUser(context, "habib")
  await habib.goto("/grn")
  const row = habib.locator("tr").filter({ has: habib.locator(`[data-po-no="${poNo}"]`) })
  await row.getByTestId("grn-receive").click()
  await expect(habib.getByTestId("grn-receive-form")).toBeVisible()
  const kits = habib.locator('[data-testid="grn-line"][data-sku="CH-CC2-50"]').first()
  await kits.getByTestId("grn-accept-qty").fill("18")
  await kits.getByTestId("grn-reject-qty").fill("2")
  await choose(habib, kits.getByTestId("grn-reject-reason"), "Short expiry")
  await kits.getByTestId("grn-batch").fill("E4-CC2-01")
  await kits.getByTestId("grn-expiry").fill("31-12-2028")
  await expect(habib.locator('[data-testid="grn-progress"][data-sku="CH-CC2-50"]')).toHaveText("18 accepted · 6 pending")
  const polish = habib.locator('[data-testid="grn-line"][data-sku="CH-POL-1L"]').first()
  await expect(polish.getByTestId("grn-accept-qty")).toHaveValue("12")
  await polish.getByTestId("grn-batch").fill("E4-POL-01")
  await polish.getByTestId("grn-expiry").fill("30-06-2029")
  await habib.getByTestId("grn-submit").click()
  await expect(habib.getByTestId("grn-view")).toBeVisible()
  const grnNo = await docNo(habib)
  expect(grnNo).toMatch(/^GRN-CST-\d{4}-\d{4}$/)
  await expect(habib.getByTestId("journal-link")).toBeVisible()

  // The PO shows partial live in Nusrat's window.
  await expect(page.getByTestId("po-view").locator('[data-status="partial"]').first()).toBeVisible()

  // The quarantined lot passes QC after all.
  await habib.goto("/grn/quarantine")
  const held = habib.locator('[data-testid="quarantine-row"][data-sku="CH-CC2-50"]').first()
  await held.getByTestId("quarantine-accept").click()
  await habib.getByTestId("quarantine-confirm").click()
  await expect(habib.locator('[data-testid="quarantine-row"][data-sku="CH-CC2-50"]').filter({ hasText: grnNo })).toHaveCount(0)

  // One polish goes back to the vendor: Mushak 6.8 debit note.
  await habib.goBack()
  await habib.goto("/grn")
  await habib.getByRole("link", { name: grnNo }).first().click()
  await habib.getByTestId("grn-return").click()
  await expect(habib.getByTestId("return-dialog")).toBeVisible()
  await habib.locator('[data-testid="return-line"][data-sku="CH-POL-1L"]').getByTestId("return-qty").fill("1")
  await habib.getByTestId("return-reason").fill("Leaking cap")
  await habib.getByTestId("return-submit").click()
  await expect(habib.getByTestId("debit-note")).toBeVisible()
  await expect(habib.getByTestId("tax-doc-header")).toContainText("DBN-")
})
