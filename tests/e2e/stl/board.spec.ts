import { expect, test } from "@playwright/test"

import { approveInline, pick, rows, signIn } from "./helpers"

/**
 * STL screens on the seeded data: the job board (columns, cards, bay lanes,
 * schedule dialog), the lists, an order view, my jobs, and E1 (a 12%
 * discount above Shuvo's 5% approved inline by Arif with his PIN).
 */

test("the job board shows the studio's columns, cards and bay lanes", async ({ page }) => {
  await signIn(page, "nayeem")
  await expect(page.getByTestId("board")).toBeVisible()
  await expect(page.getByTestId("board-column")).toHaveCount(5)
  for (const status of ["booked", "in-progress", "qc", "ready", "delivered"]) {
    await expect(page.locator(`[data-testid="board-column"][data-status="${status}"]`)).toBeVisible()
  }
  await expect(page.getByTestId("bay-lane")).toHaveCount(6)
  await expect(page.locator('[data-testid="bay-lane"][data-bay="C1"]')).toBeVisible()
  await expect(page.locator('[data-testid="board-column"][data-status="in-progress"] [data-testid="job-card"]').first()).toBeVisible()
  await expect(page.locator('[data-testid="board-column"][data-status="booked"] [data-testid="job-card"]').first()).toBeVisible()
  // A booked card opens the schedule dialog.
  await page.locator('[data-testid="board-column"][data-status="booked"] [data-testid="job-schedule"]').first().click()
  await expect(page.getByTestId("schedule-dialog")).toBeVisible()
  await expect(page.getByTestId("schedule-line").first()).toBeVisible()
  await page.keyboard.press("Escape")
  // A card opens its order.
  await page.locator('[data-testid="board-column"][data-status="in-progress"] [data-testid="job-card"]').first().click()
  await expect(page.getByTestId("order-view")).toBeVisible()
  await expect(page.getByTestId("consumption-row").first()).toBeVisible()
})

test("orders and quotations lists filter and open documents", async ({ page }) => {
  await signIn(page, "shahriar")
  await page.goto("/stl/orders")
  await expect(page.getByTestId("order-row").first()).toBeVisible()
  await page.getByTestId("status-pills").locator('[data-value="ready"]').click()
  await expect(page.getByTestId("order-row").first()).toBeVisible()
  await page.getByTestId("order-row").first().click()
  await expect(page.getByTestId("order-view")).toBeVisible()
  await page.goto("/stl/quotations")
  await expect(page.getByTestId("quote-new")).toBeVisible()
})

test("a technician sees and works only their own tasks", async ({ page }) => {
  await signIn(page, "rakib")
  await expect(page.getByTestId("my-jobs")).toBeVisible()
  // Rakib's seeded wash in bay W1 is in progress.
  await expect(page.locator('[data-testid="job-task"][data-status="in-progress"]').first()).toBeVisible()
  await expect(page.getByTestId("task-finish").first()).toBeVisible()
  await expect(page.getByTestId("extra-consumption").first()).toBeVisible()
})

test("E1: a 12% discount above the advisor's 5% needs the manager's PIN", async ({ page }) => {
  await signIn(page, "shuvo")
  await page.goto("/stl/quotations/new")
  await pick(page, "quote-vehicle", "Allion", "veh_e1_allion")
  await pick(page, "quote-add-service", "WSH-PRM", "svc_wsh_prm")
  await pick(page, "quote-add-service", "PRT-SLN", "svc_prt_sln")
  await page.getByTestId("quote-discount").fill("12")
  await page.getByTestId("quote-save").click()
  await approveInline(page, "arif", "Loyal customer, second car")
  await expect(page.getByTestId("quote-view")).toBeVisible()
  const quotes = await rows<{ quoteNo: string; discountPct: number; discountApprovalId?: string }>(page, "quotations")
  const saved = quotes.find((q) => q.discountPct === 12 && q.discountApprovalId)
  expect(saved).toBeTruthy()
  const approvals = await rows<{ id: string; decidedBy: string; inline: boolean }>(page, "approvals")
  expect(approvals.find((a) => a.id === saved!.discountApprovalId)).toMatchObject({ decidedBy: "usr_arif", inline: true })
})
