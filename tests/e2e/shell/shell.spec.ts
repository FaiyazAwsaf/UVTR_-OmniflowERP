import { expect, test, type Page } from "@playwright/test"

import { plantJournalApproval, plantSearchData, signIn } from "./helpers"

/**
 * The shell (plan §12 P1.11): the launcher's 4-window layout, the Demo Wall,
 * the approvals inbox and bell, the global search and the location switcher.
 */

test("the launcher opens the 4-window layout, each window as its own user", async ({ page, context }) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(page.getByTestId("launcher")).toBeVisible()
  const opened: Page[] = []
  context.on("page", (p) => opened.push(p))
  await page.getByTestId("open-layout").click()
  await expect.poll(() => opened.length, { timeout: 20_000 }).toBe(4)
  const expected: [RegExp, string][] = [
    [/\/stl\/board/, "Service Advisor"],
    [/\/stl\/my-jobs/, "Technician"],
    [/\/si\/counter/, "Cashier"],
    [/\/fa/, "Accountant"],
  ]
  for (const [route, role] of expected) {
    await expect.poll(() => opened.some((p) => route.test(p.url())), { timeout: 30_000 }).toBe(true)
    const win = opened.find((p) => route.test(p.url()))!
    await expect(win.getByTestId("greeting-context")).toContainText(role)
  }
})

test("the Demo Wall shows 4 panes, each signed in as its own user", async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1920, height: 1200 })
  await page.goto("/wall")
  await expect(page.getByTestId("demo-wall")).toBeVisible()
  const users = ["Nayeem Islam", "Rakib Hasan", "Tania Akter", "Mahbub Alam"]
  for (const [i, name] of users.entries()) {
    await expect(page.getByTestId(`wall-pane-${i + 1}`)).toBeVisible()
    await expect(page.getByTestId(`wall-user-${i + 1}`)).toContainText(name)
  }
  const roles = ["Service Advisor", "Technician", "Cashier", "Accountant"]
  for (const [i, role] of roles.entries()) {
    const frame = page.frameLocator(`iframe[name="of-wall-${i + 1}"]`)
    await expect(frame.locator('[data-slot="erp-shell"]')).toBeVisible({ timeout: 30_000 })
    await expect(frame.getByTestId("greeting-context")).toContainText(role)
  }
  await page.getByTestId("wall-expand-1").click()
  await expect(page.getByTestId("wall-pane-2")).toBeHidden()
  await page.getByTestId("wall-expand-1").click()
  await expect(page.getByTestId("wall-pane-2")).toBeVisible()
})

test("/approvals shows the three groups; a request reaches its approver and its requester", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const approver = await context.newPage()
  const requester = await context.newPage()
  await signIn(approver, "farzana")
  await signIn(requester, "mahbub")

  await approver.goto("/approvals")
  await expect(approver.getByTestId("approvals-inbox")).toBeVisible()
  for (const group of ["forMe", "requested", "decided"]) {
    await expect(approver.getByTestId(`approvals-group-${group}`)).toBeVisible()
  }
  await expect(approver.getByTestId("approvals-group-count-forMe")).toHaveText("0")
  await expect(approver.getByTestId("approvals-count")).toHaveCount(0)

  await plantJournalApproval(approver)
  await approver.reload()
  await requester.goto("/approvals")

  const row = approver.locator('[data-testid="approval-row"][data-approval-id="apr_e2e"]')
  await expect(approver.getByTestId("approvals-group-forMe").locator(row)).toBeVisible()
  await expect(row).toContainText("JV-2627-000999")
  await expect(row).toContainText("Requested by Mahbub Alam")
  await expect(row.getByTestId("approval-figure")).toHaveText("৳1,20,000")
  await expect(row.getByTestId("approval-doc")).toHaveAttribute("href", "/fa/journals/jv_e2e")
  await expect(approver.getByTestId("approvals-count")).toHaveText("1")
  await expect(approver.getByTestId("nav-count-approvals")).toHaveText("1")
  await expect(approver.getByTestId("nav-count-fa")).toHaveText("1")

  // The requester sees it as theirs, with no decision buttons.
  const mine = requester.locator('[data-testid="approval-row"][data-approval-id="apr_e2e"]')
  await expect(requester.getByTestId("approvals-group-requested").locator(mine)).toBeVisible()
  await expect(mine.getByTestId("approval-you-requested")).toHaveText("You requested this")
  await expect(mine.getByTestId("approval-approve")).toHaveCount(0)
  await expect(requester.getByTestId("approvals-count")).toHaveCount(0)

  // Rejecting needs a reason.
  await row.getByTestId("approval-reject").click()
  await expect(approver.getByTestId("approval-dialog")).toBeVisible()
  await expect(approver.getByTestId("approval-confirm")).toBeDisabled()
  await approver.getByTestId("approval-reason").fill("Wrong period")
  await expect(approver.getByTestId("approval-confirm")).toBeEnabled()
  await approver.keyboard.press("Escape")
  await expect(approver.getByTestId("approval-dialog")).toBeHidden()

  // Approving runs approvals.decide; until FA registers its journal handler
  // the engine refuses with the handler rule (or the planted voucher is missing).
  await row.getByTestId("approval-approve").click()
  await approver.getByTestId("approval-confirm").click()
  await expect(approver.getByTestId("approval-dialog")).toBeHidden()
  await expect(
    approver.getByRole("dialog").filter({ hasText: /No module handles approvals|no longer exists|Approved/ })
  ).toBeVisible()
  await context.close()
})

test("the bell lists what waits and links to the inbox", async ({ page }) => {
  await signIn(page, "farzana")
  await plantJournalApproval(page)
  await page.reload()
  await expect(page.getByTestId("approvals-count")).toHaveText("1")
  await page.getByTestId("approvals-bell").click()
  await expect(page.getByTestId("bell-item")).toContainText("JV-2627-000999")
  await page.getByTestId("bell-item").click()
  await expect(page).toHaveURL(/\/approvals\?focus=apr_e2e/)
  await expect(page.locator('[data-testid="approval-row"][data-approval-id="apr_e2e"]')).toBeVisible()
})

test("global search finds screens, parties, vehicles in Bangla digits and documents the user may open", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } })
  const page = await context.newPage()
  await signIn(page, "mahbub")
  await plantSearchData(page)

  await page.getByTestId("global-search").click()
  const input = page.getByTestId("palette-input")
  await expect(input).toBeVisible()
  const results = page.getByTestId("search-result")

  await input.fill("ledger")
  await expect(results.filter({ hasText: "Ledger" }).first()).toBeVisible()

  await input.fill("২৭-৪৪১৯")
  await expect(results.filter({ hasText: "DHAKA METRO-GA 27-4419" })).toBeVisible()

  await input.fill("01711-000999")
  await expect(results.filter({ hasText: "Test Customer" })).toBeVisible()

  await input.fill("inv gul 2627")
  await expect(results.filter({ hasText: "INV-GUL-2627-000123" })).toBeVisible()
  await input.fill("INV-")
  await expect(results.filter({ hasText: "INV-UTT-2627-000456" })).toBeVisible()
  await results.filter({ hasText: "INV-GUL-2627-000123" }).click()
  await expect(page).toHaveURL(/\/si\/inv_e2e_gul/)

  // A Gulshan cashier sees only Gulshan's invoices (own-location scope).
  const cashier = await context.newPage()
  await signIn(cashier, "tania")
  await cashier.keyboard.press("Control+k")
  await cashier.getByTestId("palette-input").fill("INV-")
  await expect(cashier.getByTestId("search-result").filter({ hasText: "INV-GUL-2627-000123" })).toBeVisible()
  await expect(cashier.getByTestId("search-result").filter({ hasText: "INV-UTT-2627-000456" })).toHaveCount(0)

  // A technician cannot open PAR, so parties and vehicles are not offered.
  const technician = await context.newPage()
  await signIn(technician, "rakib")
  await technician.keyboard.press("Control+k")
  await technician.getByTestId("palette-input").fill("Test Customer")
  await expect(technician.getByText("No results")).toBeVisible()
  await expect(technician.getByTestId("search-result")).toHaveCount(0)
  // The language switch stays in the palette.
  await technician.getByTestId("palette-input").fill("language")
  await technician.getByRole("option", { name: /বাংলা/ }).click()
  await expect(technician.locator("html")).toHaveAttribute("lang", "bn")
  await context.close()
})

test("a user with several locations switches the window's current location", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, "habib")
  const switcher = page.getByTestId("location-switcher")
  await expect(switcher).toHaveAttribute("data-location", "CST")
  await switcher.click()
  await page.getByTestId("location-option-GUL").click()
  await expect(switcher).toHaveAttribute("data-location", "GUL")
  await expect(page.getByTestId("greeting-context")).toContainText("Gulshan")
  // Single-location users have no switcher.
  await signIn(page, "tania")
  await expect(page.getByTestId("location-switcher")).toHaveCount(0)
})
