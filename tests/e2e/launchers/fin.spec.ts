import { expect, test, type Browser, type Page } from "@playwright/test"

import { readRows, signIn } from "../shell/helpers"

import { launchByUrl, launchFromPanel } from "./helpers"

/**
 * WS-FIN launchers (plan §10): E5 three-way mismatch, E6 pay with
 * withholding, E7 bank reconciliation, E8 post-dated cheque bounce. Each is
 * launched twice in one browser context (from the Demo panel, then by
 * `?launch=`); each time the window's user, route and cue card are checked
 * and the key action is performed through the UI.
 */

test.describe.configure({ timeout: 120_000 })

type Run = { scenarioId: string; at: number; refs: Record<string, string> }

/** The user this window is signed in as (its session in sessionStorage). */
async function windowUser(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!
      if (key.startsWith("of:session:")) return (JSON.parse(sessionStorage.getItem(key) ?? "{}") as { userId?: string }).userId ?? null
    }
    return null
  })
}

/** The latest run of a launcher (its refs name what the setup created). */
async function lastRun(page: Page, scenarioId: string): Promise<Run> {
  const runs = (await readRows<Run>(page, "scenarioRuns")).filter((r) => r.scenarioId === scenarioId).sort((a, b) => b.at - a.at)
  return runs[0]
}

/** After a launch: the window's user, its route and the cue card on step one; returns the cue's text and closes it. */
async function checkLanding(page: Page, scenarioId: string, user: string, route: RegExp): Promise<string> {
  await expect(page).toHaveURL(route, { timeout: 30_000 })
  await expect.poll(() => windowUser(page)).toBe(`usr_${user}`)
  const cue = page.locator(`[data-testid="cue-card"][data-scenario-id="${scenarioId}"]`)
  await expect(cue).toHaveAttribute("data-step", "0")
  const text = (await cue.innerText()).replace(/\s+/g, " ")
  // The card is fixed bottom-left; close it so it never covers the page's buttons.
  await page.getByRole("button", { name: "Close the cue card" }).click()
  await expect(cue).toBeHidden()
  return text
}

async function newWindow(browser: Browser, user: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await signIn(page, user)
  return { context, page }
}

async function approveInInbox(page: Page, docNo: string) {
  await page.goto("/approvals")
  const row = page.getByTestId("approval-row").filter({ hasText: docNo })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.getByTestId("approval-approve").click()
  await page.getByTestId("approval-confirm").click()
  await expect(page.getByTestId("approval-dialog")).toBeHidden()
}

test("E5: Mahbub's bill on the vendor's GRN, 6% over the PO, goes on hold and Farzana releases it (twice)", async ({ browser }) => {
  const { context, page } = await newWindow(browser, "mahbub")
  const farzana = await context.newPage()
  await signIn(farzana, "farzana")
  for (const how of ["panel", "url"] as const) {
    if (how === "panel") await launchFromPanel(page, "E5")
    else await launchByUrl(page, "E5", "/fa")
    const cue = await checkLanding(page, "E5", "mahbub", /\/ap\/bills\/new\?vendor=pty_gloss_guard&grn=/)
    expect(cue).toContain("৳6,890")
    expect(cue).toContain("+6%")
    const run = await lastRun(page, "E5")
    const kit = (await readRows<{ id: string; itemId: string; qtyAccepted: number; unitCostP: number }>(page, "grnLines", { field: "grnId", equals: run.refs.grnId })).find(
      (l) => l.itemId === "itm_cc2_kit" && l.qtyAccepted > 0
    )!
    const panel = page.getByTestId("match-panel")
    const line = panel.locator(`[data-testid="match-line"][data-grn-line="${kit.id}"]`)
    await expect(line).toHaveAttribute("data-matched", "true")
    await expect(page.getByTestId("bill-vendor-ref")).not.toHaveValue("")
    const price = line.getByTestId("bill-price")
    await price.click()
    await price.fill(String(Math.round(kit.unitCostP * 1.06) / 100))
    await price.blur()
    await expect(line.getByTestId("match-diff")).toHaveAttribute("data-field", "price")
    await expect(line.getByTestId("match-diff")).toContainText("+6")
    await page.getByTestId("bill-save").click()
    await expect(page.getByTestId("bill-status")).toHaveAttribute("data-status", "on-hold")
    const billNo = (await page.getByTestId("bill-view").getAttribute("data-bill-no"))!
    await approveInInbox(farzana, billNo)
    await expect(page.getByTestId("bill-status")).toHaveAttribute("data-status", "posted")
  }
  await context.close()
})

test("E6: Prime Guard's fresh bill paid by cheque with AIT ৳6,000 and VDS ৳9,000; Farzana approves; Mushak 6.6 (twice)", async ({ browser }) => {
  const { context, page } = await newWindow(browser, "mahbub")
  const farzana = await context.newPage()
  await signIn(farzana, "farzana")
  for (const how of ["panel", "url"] as const) {
    if (how === "panel") await launchFromPanel(page, "E6")
    else await launchByUrl(page, "E6", "/fa")
    const cue = await checkLanding(page, "E6", "mahbub", /\/ap\/payments\/new\?party=pty_prime_guard&bill=/)
    expect(cue).toContain("৳54,000")
    const chequeNo = /cheque number (\d+)/.exec(cue)![1]
    const run = await lastRun(page, "E6")
    const [bill] = await readRows<{ billNo: string }>(page, "vendorBills", { field: "id", equals: run.refs.billId })
    const row = page.locator(`[data-testid="pay-bill-row"][data-bill-no="${bill.billNo}"]`)
    await expect(row.getByTestId("pay-bill-check")).toHaveAttribute("data-state", "checked")
    await page.getByTestId("payment-method").locator('[data-value="cheque"]').click()
    await page.getByTestId("payment-cheque-no").fill(chequeNo)
    await expect(page.getByTestId("withholding-ait")).toHaveAttribute("data-amount", "600000")
    await expect(page.getByTestId("withholding-vds")).toHaveAttribute("data-amount", "900000")
    await expect(page.getByTestId("payment-net")).toHaveAttribute("data-amount", "5400000")
    await page.getByTestId("payment-save").click()
    await expect(page.getByTestId("payment-status")).toHaveAttribute("data-status", "pending-approval")
    const paymentNo = (await page.getByTestId("payment-view").getAttribute("data-payment-no"))!
    await approveInInbox(farzana, paymentNo)
    await expect(page.getByTestId("payment-status")).toHaveAttribute("data-status", "posted")
    await page.getByTestId("certificate-print").click()
    await expect(page.getByTestId("certificate-sheet")).toContainText("৳9,000")
    await page.keyboard.press("Escape")
  }
  await context.close()
})

test("E7: last month's BRAC statement: auto-match, post the ৳575 charge, match the Skyline deposit by hand, complete (twice)", async ({ browser }) => {
  const { context, page } = await newWindow(browser, "mahbub")
  for (const how of ["panel", "url"] as const) {
    if (how === "panel") await launchFromPanel(page, "E7")
    else await launchByUrl(page, "E7", "/fa")
    const cue = await checkLanding(page, "E7", "mahbub", /\/cab\/reconciliation\?id=/)
    expect(cue).toContain("৳575")
    const receiptNo = /receipt (MR-[A-Z0-9-]+)/.exec(cue)![1]
    const statement = page.getByTestId("recon-statement")
    await expect(statement).toHaveAttribute("data-status", "imported")
    await page.getByTestId("recon-auto").click()
    const open = page.locator('[data-testid="recon-line"][data-matched="false"]')
    await expect(open).toHaveCount(2)
    await page.getByTestId("recon-filter").locator('[data-value="open"]').click()
    await page.locator('[data-testid="recon-line"][data-matched="false"][data-amount="-57500"]').getByTestId("recon-post-charge").click()
    await expect(open).toHaveCount(1)
    await open.filter({ has: page.locator('[data-amount="1200000"]') }).or(page.locator('[data-testid="recon-line"][data-matched="false"][data-amount="1200000"]')).getByTestId("recon-match").click()
    const dialog = page.getByTestId("recon-match-dialog")
    await dialog.locator(`[data-testid="recon-candidate"][data-ref="${receiptNo}"]`).click()
    await dialog.getByTestId("recon-match-save").click()
    await expect(dialog).toBeHidden()
    await expect(open).toHaveCount(0)
    await page.getByTestId("recon-complete").click()
    await expect(statement).toHaveAttribute("data-status", "reconciled")
  }
  await context.close()
})

test("E8: Metro's fresh post-dated cheque is deposited and bounces; its invoice is free again; the customer gets a notice (twice)", async ({ browser }) => {
  const { context, page } = await newWindow(browser, "mahbub")
  for (const how of ["panel", "url"] as const) {
    if (how === "panel") await launchFromPanel(page, "E8")
    else await launchByUrl(page, "E8", "/fa")
    const cue = await checkLanding(page, "E8", "mahbub", /\/cab\/cheques\?id=/)
    expect(cue).toContain("৳85,000")
    const detail = page.getByTestId("cheque-detail")
    await expect(detail).toHaveAttribute("data-status", "in-hand")
    const chequeNo = (await detail.getAttribute("data-cheque-no"))!
    expect(cue).toContain(chequeNo)
    const invoice = detail.getByTestId("cheque-invoice").first()
    const before = Number(await invoice.getAttribute("data-available"))
    const row = page.locator(`[data-testid="cheque-row"][data-cheque-no="${chequeNo}"]`)
    await row.getByTestId("cheque-deposit").click()
    await expect(detail).toHaveAttribute("data-status", "deposited")
    await row.getByTestId("cheque-bounce").click()
    await page.getByTestId("bounce-dialog").getByTestId("reason-confirm").click()
    await expect(detail).toHaveAttribute("data-status", "bounced")
    await expect.poll(async () => Number(await invoice.getAttribute("data-available"))).toBeGreaterThan(before)
    const notice = page.getByTestId("cheque-notice")
    await expect(notice).toContainText(chequeNo)
    await expect(notice).toContainText("85,000")
  }
  await context.close()
})
