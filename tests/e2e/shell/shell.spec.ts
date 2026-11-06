import { expect, test, type Page } from "@playwright/test"

import { readRows, signIn } from "./helpers"

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
  // The seed plants four approvals pending today (seed_data §8); the PO by
  // Nusrat (৳1,48,000, above her ৳1,00,000) waits for Farzana or Rashed.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const approver = await context.newPage()
  const requester = await context.newPage()
  await signIn(approver, "farzana")
  await approver.goto("/approvals")
  await expect(approver.getByTestId("approvals-inbox")).toBeVisible()
  for (const group of ["forMe", "requested", "decided"]) {
    await expect(approver.getByTestId(`approvals-group-${group}`)).toBeVisible()
  }
  const row = approver.locator('[data-testid="approval-row"][data-approval-id="apv_pending_po"]')
  await expect(approver.getByTestId("approvals-group-forMe").locator(row)).toBeVisible()
  await expect(row).toContainText("PO-")
  await expect(row).toContainText("Nusrat Jahan")
  await expect(row.getByTestId("approval-figure")).toHaveText("৳1,48,000")
  await expect(row.getByTestId("approval-doc")).toHaveAttribute("href", /\/ptl\/po\//)
  // The bell counts exactly the rows waiting for me.
  const forMe = await approver.getByTestId("approvals-group-forMe").getByTestId("approval-row").count()
  await expect(approver.getByTestId("approvals-count")).toHaveText(String(forMe))

  // The requester sees it as theirs, with no decision buttons.
  await signIn(requester, "nusrat")
  await requester.goto("/approvals")
  const mine = requester.locator('[data-testid="approval-row"][data-approval-id="apv_pending_po"]')
  await expect(requester.getByTestId("approvals-group-requested").locator(mine)).toBeVisible()
  await expect(mine.getByTestId("approval-you-requested")).toHaveText("You requested this")
  await expect(mine.getByTestId("approval-approve")).toHaveCount(0)

  // Rejecting needs a reason.
  await row.getByTestId("approval-reject").click()
  await expect(approver.getByTestId("approval-dialog")).toBeVisible()
  await expect(approver.getByTestId("approval-confirm")).toBeDisabled()
  await approver.getByTestId("approval-reason").fill("Wrong vendor")
  await expect(approver.getByTestId("approval-confirm")).toBeEnabled()
  await approver.keyboard.press("Escape")
  await expect(approver.getByTestId("approval-dialog")).toBeHidden()

  // Approving runs approvals.decide; until PTL registers its PO handler the
  // engine refuses with the handler rule; afterwards the row moves to Decided.
  await row.getByTestId("approval-approve").click()
  await approver.getByTestId("approval-confirm").click()
  await expect(approver.getByTestId("approval-dialog")).toBeHidden()
  await expect(
    approver
      .getByRole("dialog")
      .filter({ hasText: /No module handles approvals/ })
      .or(approver.getByTestId("approvals-group-decided").locator('[data-approval-id="apv_pending_po"]'))
  ).toBeVisible()
  await context.close()
})

test("the bell lists what waits and links to the inbox", async ({ page }) => {
  await signIn(page, "farzana")
  await expect(page.getByTestId("approvals-count")).toBeVisible()
  await page.getByTestId("approvals-bell").click()
  const item = page.getByTestId("bell-item").first()
  await expect(item).toBeVisible()
  await item.click()
  await expect(page).toHaveURL(/\/approvals\?focus=/)
  await expect(page.getByTestId("approval-row").first()).toBeVisible()
})

test("global search finds screens, parties, vehicles in Bangla digits and documents the user may open", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } })
  const page = await context.newPage()
  await signIn(page, "mahbub")
  const [e12] = await readRows<{ invoiceNo: string }>(page, "salesInvoices", { field: "id", equals: "inv_e12" })
  const utt = (await readRows<{ invoiceNo: string; kind: string }>(page, "salesInvoices", { field: "locationId", equals: "loc_utt" })).find(
    (i) => i.kind !== "opening"
  )!

  await page.getByTestId("global-search").click()
  const input = page.getByTestId("palette-input")
  await expect(input).toBeVisible()
  const results = page.getByTestId("search-result")

  await input.fill("ledger")
  await expect(results.filter({ hasText: "Ledger" }).first()).toBeVisible()

  // Shahed Kabir's Corolla Cross, typed in Bangla digits.
  await input.fill("১৫-৭৭৩১")
  await expect(results.filter({ hasText: "DHAKA METRO-GHA 15-7731" })).toBeVisible()

  await input.fill("01819-447731")
  await expect(results.filter({ hasText: "Shahed Kabir" }).first()).toBeVisible()

  await input.fill(e12.invoiceNo)
  await expect(results.filter({ hasText: e12.invoiceNo })).toBeVisible()
  await results.filter({ hasText: e12.invoiceNo }).click()
  await expect(page).toHaveURL(/\/si\/inv_e12/)

  // A Gulshan cashier finds Gulshan's invoice but not Uttara's (own-location scope).
  const cashier = await context.newPage()
  await signIn(cashier, "tania")
  await cashier.keyboard.press("Control+k")
  await cashier.getByTestId("palette-input").fill(e12.invoiceNo)
  await expect(cashier.getByTestId("search-result").filter({ hasText: e12.invoiceNo })).toBeVisible()
  await cashier.getByTestId("palette-input").fill(utt.invoiceNo)
  await expect(cashier.getByTestId("search-result").filter({ hasText: utt.invoiceNo })).toHaveCount(0)

  // A technician cannot open PAR, so parties and vehicles are not offered.
  const technician = await context.newPage()
  await signIn(technician, "rakib")
  await technician.keyboard.press("Control+k")
  await technician.getByTestId("palette-input").fill("Shahed Kabir")
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
