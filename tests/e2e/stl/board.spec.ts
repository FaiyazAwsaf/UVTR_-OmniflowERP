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

test("dragging a booked card onto a bay lane schedules it there", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 })
  await signIn(page, "nayeem")
  const handle = page.locator('[data-testid="board-column"][data-status="booked"] [data-testid="job-drag"]').first()
  await handle.scrollIntoViewIfNeeded()
  const from = (await handle.boundingBox())!
  const lane = page.locator('[data-testid="bay-lane"][data-bay="C1"]')
  await lane.scrollIntoViewIfNeeded()
  const to = (await lane.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 })
  // About 17:00 on the 09:00 to 21:00 lane (the track starts after the bay label).
  await page.mouse.move(to.x + 72 + (to.width - 72) * 0.68, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
  const dialog = page.getByTestId("schedule-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId("schedule-bay")).toContainText("C1")
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
