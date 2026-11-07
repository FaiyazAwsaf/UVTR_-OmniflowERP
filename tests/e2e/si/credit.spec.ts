import { expect, test } from "@playwright/test"

import { approveInline, rows, signIn } from "../stl/helpers"

/**
 * SI on the seeded data: E2 (Swift Ride's consolidated invoice is over its
 * limit until Farzana overrides inline), E12 (a partial credit note above
 * Tania's limit approved inline by Shahriar, kept as advance), the invoice
 * view with the Mushak 6.3 print, the lists and walk-in goods at the
 * counter.
 */

test("E2: the consolidated fleet invoice needs a credit override", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, "shahriar")
  await page.goto("/si/new")
  await page.getByTestId("consolidated-new").click()
  await page.getByTestId("invoice-party-chip").filter({ hasText: "Swift Ride" }).click()
  await expect(page.getByTestId("credit-panel")).toHaveAttribute("data-needs-override", "true")
  await expect(page.getByTestId("invoice-order").first()).toBeVisible()
  await page.getByTestId("credit-override").click()
  await approveInline(page, "farzana", "Fleet contract renewal this week")
  await expect(page.getByTestId("credit-override-granted")).toBeVisible()
  await page.getByTestId("consolidated-issue").click()
  await expect(page.getByTestId("invoice-view")).toBeVisible()
  await expect(page.getByTestId("doc-no")).toContainText("INV-GUL-")
  await expect(page.getByTestId("invoice-line").first()).toBeVisible()
  const invoices = await rows<{ kind: string; partyId: string; creditOverrideApprovalId?: string }>(page, "salesInvoices")
  expect(invoices.some((i) => i.kind === "consolidated" && i.partyId === "pty_swift_ride" && i.creditOverrideApprovalId)).toBe(true)
})

test("E12: a partial credit note approved inline is kept as advance", async ({ page }) => {
  await signIn(page, "tania")
  await page.goto("/si/inv_e12")
  await expect(page.getByTestId("invoice-view")).toBeVisible()
  await page.getByTestId("mushak-print").click()
  await expect(page.getByTestId("mushak-63")).toBeVisible()
  await expect(page.getByTestId("tax-doc-header")).toContainText("Mushak 6.3")
  await page.keyboard.press("Escape")
  await page.getByTestId("credit-note-new").click()
  const dialog = page.getByTestId("credit-note-dialog")
  await dialog.getByTestId("credit-note-line").filter({ hasText: /Interior/ }).getByTestId("credit-note-line-check").click()
  await dialog.getByTestId("credit-note-reason").fill("Damp smell in the rear carpet after the interior clean")
  await dialog.getByTestId("credit-note-submit").click()
  await approveInline(page, "shahriar", "Complaint upheld")
  await expect(dialog).toBeHidden()
  const notes = await rows<{ invoiceId: string; status: string; toAdvanceP: number; totalP: number }>(page, "creditNotes")
  const note = notes.find((n) => n.invoiceId === "inv_e12")
  expect(note?.status).toBe("posted")
  expect(note?.toAdvanceP).toBe(note?.totalP)
  await page.goto("/si/credit-notes")
  await expect(page.getByTestId("credit-note-row").first()).toBeVisible()
  await page.getByTestId("credit-note-row").first().click()
  await expect(page.getByTestId("mushak-67")).toBeVisible()
})

test("the counter sells retail goods to the walk-in customer with cash and change", async ({ page }) => {
  await signIn(page, "tania")
  await expect(page.getByTestId("counter")).toBeVisible()
  await page.getByTestId("counter-item").click()
  await page.getByTestId("counter-item-search").fill("RT-AFR-01")
  await page.getByTestId("counter-item-option").first().click()
  await page.getByTestId("counter-item-qty").fill("2")
  await page.getByTestId("counter-item-add").click()
  await expect(page.getByTestId("counter-due")).toContainText("805")
  await page.getByTestId("tender-cash").click()
  await page.getByTestId("tender-received").fill("1000")
  await expect(page.getByTestId("tender-change")).toContainText("195")
  await page.getByTestId("checkout-submit").click()
  await expect(page.getByTestId("counter-receipt")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.goto("/si")
  await expect(page.getByTestId("invoice-row").first()).toBeVisible()
  await expect(page.getByTestId("invoice-new")).toHaveCount(1)
})
