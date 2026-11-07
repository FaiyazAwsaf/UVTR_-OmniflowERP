import { expect, test } from "@playwright/test"

import { approveInInbox, asUser, choose, docNo, pick, signIn } from "../ic/scm-helpers"

/**
 * PTL screens and the requisition-to-PO flow: Habib's requisition waits for
 * an approver (his purchase limit is 0) and never shows him a decision;
 * Nusrat approves it, issues one PO per vendor from it without a second
 * approval, sends and prints the PO.
 */
test("requisition → approval → POs from it; home, lists and returns render", async ({ page, context }) => {
  test.setTimeout(180_000)
  await signIn(page, "habib")
  await page.goto("/ptl/requisitions")
  await page.getByTestId("pr-new").click()
  await expect(page.getByTestId("pr-editor")).toBeVisible()
  await pick(page, page.getByTestId("pr-line-item").first(), "CH-POL-1L", "pr-line-item")
  await page.getByTestId("pr-qty").first().fill("6")
  await choose(page, page.getByTestId("pr-vendor").first(), "Gloss & Guard Trading")
  await expect(page.getByTestId("pr-line")).toHaveCount(1)
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-view")).toBeVisible()
  const prNo = await docNo(page)
  expect(prNo).toMatch(/^PR-\d{4}-\d{4}$/)
  await expect(page.getByTestId("pr-view").locator('[data-status="pending-approval"]').first()).toBeVisible()
  await expect(page.getByTestId("approval-chip")).toBeVisible()

  const nusrat = await asUser(context, "nusrat")
  await approveInInbox(nusrat, prNo)
  // Habib's window updates live.
  await expect(page.getByTestId("pr-view").locator('[data-status="approved"]').first()).toBeVisible()

  await nusrat.goto("/ptl/requisitions")
  await nusrat.locator(`[data-pr-no="${prNo}"]`).click()
  await expect(nusrat.getByTestId("pr-create-pos")).toBeVisible()
  await nusrat.getByTestId("pr-issue-pos").click()
  await expect(nusrat.getByTestId("po-view")).toBeVisible()
  const poNo = await docNo(nusrat)
  await expect(nusrat.getByTestId("po-view").locator('[data-status="issued"]').first()).toBeVisible()
  await expect(nusrat.getByTestId("po-sent")).toBeVisible()
  await nusrat.getByTestId("po-print").click()
  await expect(nusrat.getByTestId("po-print-sheet")).toContainText("CH-POL-1L")
  await nusrat.keyboard.press("Escape")

  await nusrat.goto("/ptl/po")
  await expect(nusrat.locator(`[data-testid="po-row"][data-po-no="${poNo}"]`)).toBeVisible()
  await nusrat.goto("/ptl")
  await expect(nusrat.getByTestId("po-new")).toBeVisible()
  await nusrat.goto("/ptl/returns")
  await expect(nusrat.getByTestId("return-new")).toBeVisible()
  await expect(page.getByTestId("pr-view").locator('[data-status="ordered"]').first()).toBeVisible()
})

test("the planted pending PO waits for Farzana and the buyer sees no decision", async ({ page }) => {
  await signIn(page, "nusrat")
  await page.goto("/ptl/po/po_pending_nusrat")
  await expect(page.getByTestId("po-view")).toBeVisible()
  await expect(page.getByTestId("approval-chip")).toHaveAttribute("data-status", "pending")
  await expect(page.getByTestId("po-send")).toHaveCount(0)
  await expect(page.getByTestId("po-receive")).toHaveCount(0)
})
