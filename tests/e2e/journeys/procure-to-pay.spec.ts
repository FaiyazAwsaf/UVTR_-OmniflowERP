import { expect, test, type Page } from "@playwright/test"

import { approveInInbox, asUser, choose, docNo, pick, signIn } from "../ic/scm-helpers"
import { rows } from "../stl/helpers"

/**
 * Procure to pay (plan P2.7, objective §4 story 4), one browser, a window per
 * person, live hand-offs:
 * Habib requisitions 6 finishing polish from Gloss & Guard; his purchase
 * limit is 0, so Nusrat approves it and issues the PO from it; Habib receives
 * 4 (partial GRN); Mahbub records the vendor bill for the 4, which matches
 * the PO and the GRN and posts; Mahbub pays it by cheque with 3% AIT withheld
 * (a goods supplier), Farzana approves the payment; last month's BRAC Bank
 * statement auto-matches, the bank charge posts and the reconciliation
 * completes. The books tie at the end.
 */

const VENDOR = "pty_gloss_guard"
const SKU = "CH-POL-1L"

async function setChecked(page: Page, row: ReturnType<Page["locator"]>, on: boolean): Promise<void> {
  const box = row.getByRole("checkbox")
  if (((await box.getAttribute("aria-checked")) === "true") !== on) await box.click()
  await expect(box).toHaveAttribute("aria-checked", on ? "true" : "false")
}

test("procure to pay: requisition, approval, PO, partial GRN, matched bill, payment with AIT, reconciliation", async ({ page, context }) => {
  test.setTimeout(300_000)

  // Habib's requisition waits for an approver.
  await signIn(page, "habib")
  await page.goto("/ptl/requisitions")
  await page.getByTestId("pr-new").click()
  await expect(page.getByTestId("pr-editor")).toBeVisible()
  await pick(page, page.getByTestId("pr-line-item").first(), SKU, "pr-line-item")
  await page.getByTestId("pr-qty").first().fill("6")
  await choose(page, page.getByTestId("pr-vendor").first(), "Gloss & Guard Trading")
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-view")).toBeVisible()
  const prNo = await docNo(page)
  await expect(page.getByTestId("pr-view").locator('[data-status="pending-approval"]').first()).toBeVisible()

  // Nusrat approves it and issues the PO from it (no second approval within its total).
  const nusrat = await asUser(context, "nusrat")
  await approveInInbox(nusrat, prNo)
  await expect(page.getByTestId("pr-view").locator('[data-status="approved"]').first()).toBeVisible()
  await nusrat.goto("/ptl/requisitions")
  await nusrat.locator(`[data-pr-no="${prNo}"]`).click()
  await nusrat.getByTestId("pr-issue-pos").click()
  await expect(nusrat.getByTestId("po-view")).toBeVisible()
  const poNo = await docNo(nusrat)
  await expect(nusrat.getByTestId("po-view").locator('[data-status="issued"]').first()).toBeVisible()

  // Habib receives 4 of the 6 at the Central Store: a partial GRN.
  await page.goto("/grn")
  await page.locator("tr").filter({ has: page.locator(`[data-po-no="${poNo}"]`) }).getByTestId("grn-receive").click()
  await expect(page.getByTestId("grn-receive-form")).toBeVisible()
  const polish = page.locator(`[data-testid="grn-line"][data-sku="${SKU}"]`).first()
  await polish.getByTestId("grn-accept-qty").fill("4")
  await polish.getByTestId("grn-batch").fill("P2P-POL-01")
  await polish.getByTestId("grn-expiry").fill("30-06-2029")
  await expect(page.locator(`[data-testid="grn-progress"][data-sku="${SKU}"]`)).toHaveText("4 accepted · 2 pending")
  await page.getByTestId("grn-submit").click()
  await expect(page.getByTestId("grn-view")).toBeVisible()
  const grnNo = await docNo(page)
  // The PO shows partial live in Nusrat's window.
  await expect(nusrat.getByTestId("po-view").locator('[data-status="partial"]').first()).toBeVisible()

  const grns = await rows<{ id: string; grnNo: string }>(page, "grns")
  const grnId = grns.find((g) => g.grnNo === grnNo)!.id
  const grnLines = await rows<{ id: string; grnId: string }>(page, "grnLines")
  const grnLineId = grnLines.find((l) => l.grnId === grnId)!.id

  // Mahbub records the vendor bill for exactly what arrived: it matches and posts.
  const mahbub = await asUser(context, "mahbub")
  await mahbub.goto("/ap/bills")
  await mahbub.getByTestId("bill-new").click()
  await mahbub.getByTestId("bill-vendor").click()
  await mahbub.getByTestId("bill-vendor-search").fill("Gloss")
  await mahbub.locator(`[data-testid="bill-vendor-option"][data-id="${VENDOR}"]`).or(mahbub.getByTestId("bill-vendor-option").first()).first().click()
  const panel = mahbub.getByTestId("match-panel")
  const ours = panel.locator(`[data-testid="match-line"][data-grn-line="${grnLineId}"]`)
  await expect(ours).toBeVisible()
  for (const other of await panel.getByTestId("match-line").all()) {
    if ((await other.getAttribute("data-grn-line")) !== grnLineId) await setChecked(mahbub, other, false)
  }
  await setChecked(mahbub, ours, true)
  await expect(ours).toHaveAttribute("data-matched", "true")
  await mahbub.getByTestId("bill-vendor-ref").fill(`GG/${grnNo}`)
  await mahbub.getByTestId("bill-save").click()
  await expect(mahbub.getByTestId("bill-status")).toHaveAttribute("data-status", "posted")
  const billId = new URL(mahbub.url()).pathname.split("/").pop()!

  // He pays it by cheque: 3% AIT withheld, no VDS on goods; the payment waits for Farzana.
  const farzana = await asUser(context, "farzana")
  await mahbub.goto(`/ap/payments/new?party=${VENDOR}&bill=${billId}`)
  await mahbub.getByTestId("payment-method").locator('[data-value="cheque"]').click()
  await mahbub.getByTestId("payment-cheque-no").fill("7319077")
  const ait = Number(await mahbub.getByTestId("withholding-ait").getAttribute("data-amount"))
  expect(ait).toBeGreaterThan(0)
  await expect(mahbub.getByTestId("withholding-vds")).toHaveAttribute("data-amount", "0")
  await mahbub.getByTestId("payment-save").click()
  await expect(mahbub.getByTestId("payment-view")).toBeVisible()
  const status = mahbub.getByTestId("payment-status")
  if ((await status.getAttribute("data-status")) === "pending-approval") {
    const paymentNo = (await mahbub.getByTestId("payment-view").getAttribute("data-payment-no"))!
    await approveInInbox(farzana, paymentNo)
  }
  await expect(status).toHaveAttribute("data-status", "posted")
  const bills = await rows<{ id: string; status: string }>(mahbub, "vendorBills")
  expect(bills.find((b) => b.id === billId)?.status).toBe("paid")

  // Last month's BRAC Bank statement: auto-match, post the charge, complete.
  await mahbub.goto("/cab/reconciliation")
  await mahbub.getByTestId("recon-import").click()
  await expect(mahbub.getByTestId("recon-line").first()).toBeVisible()
  await mahbub.getByTestId("recon-auto").click()
  const open = mahbub.locator('[data-testid="recon-line"][data-matched="false"]')
  await expect(open).toHaveCount(1)
  await expect(open).toHaveAttribute("data-amount", "-57500")
  await open.getByTestId("recon-post-charge").click()
  await expect(open).toHaveCount(0)
  await mahbub.getByTestId("recon-complete").click()
  await expect(mahbub.getByTestId("recon-statement")).toHaveAttribute("data-status", "reconciled")

  // The books tie.
  const lines = await rows<{ debitP: number; creditP: number }>(mahbub, "journalLines")
  expect(lines.reduce((s, l) => s + l.debitP, 0)).toBe(lines.reduce((s, l) => s + l.creditP, 0))
  await mahbub.goto("/frs/trial-balance")
  await expect(mahbub.getByTestId("tb-balanced")).toHaveAttribute("data-balanced", "true")
  // The balance sheet (with this year's profit from the P&L) and the cash flow tie too.
  await mahbub.goto("/frs/balance-sheet")
  await expect(mahbub.getByTestId("bs-balanced")).toHaveAttribute("data-balanced", "true")
  await mahbub.goto("/frs/cash-flow")
  await expect(mahbub.getByTestId("cf-balanced")).toHaveAttribute("data-balanced", "true")
})
