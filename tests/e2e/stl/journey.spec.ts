import { expect, test } from "@playwright/test"

import { pick, rows, sign, signIn, windowAs } from "./helpers"

/**
 * J1 to J4 by hand across four windows of one browser (one database, live
 * hand-offs): Nayeem quotes ceramic coating 2-year and interior deep clean
 * for Shahed Kabir's Corolla Cross, accepts it with a bKash deposit and
 * schedules it in bay C1 with Rakib; Rakib starts and finishes both tasks;
 * Shahriar passes QC and hands over with a signature and a gate pass; Tania
 * takes the balance by card and cash with the deposit applied.
 */
test("service to cash: quote, deposit, schedule, tasks, QC, handover, counter", async ({ page, context }) => {
  test.setTimeout(240_000)

  // J1: the quotation and booking with a bKash deposit.
  await signIn(page, "nayeem")
  await page.goto("/stl/quotations/new")
  await pick(page, "quote-party", "Shahed", "pty_shahed_kabir")
  await pick(page, "quote-vehicle", "7731", "veh_corolla_cross_7731")
  await pick(page, "quote-add-service", "PRT-CC2", "svc_prt_cc2")
  await pick(page, "quote-add-service", "INT-DEEP", "svc_int_deep")
  await expect(page.getByTestId("quote-line")).toHaveCount(2)
  await expect(page.getByTestId("quote-total")).toContainText("48,875")
  await page.getByTestId("quote-save").click()
  await expect(page.getByTestId("quote-view")).toBeVisible()
  await page.getByTestId("quote-accept").click()
  await page.getByTestId("deposit-toggle").click()
  await page.getByTestId("deposit-method").locator('[data-value="bkash"]').click()
  await page.getByTestId("deposit-amount").fill("10000")
  await page.getByTestId("accept-confirm").click()
  await page.getByTestId("mfs-approve").click()
  await expect(page.getByTestId("order-view")).toBeVisible()
  await expect(page.getByTestId("order-advance")).toContainText("10,000")
  const orderNo = (await page.getByTestId("doc-no").textContent())!.trim()
  const orderId = page.url().split("/").pop()!

  // J2 (setup): schedule into bay C1 at 11:00 with Rakib for both services.
  await page.getByTestId("order-schedule").click()
  const dialog = page.getByTestId("schedule-dialog")
  await dialog.getByTestId("schedule-bay").click()
  await page.getByRole("option", { name: /C1/ }).click()
  await dialog.getByTestId("schedule-time").click()
  await page.getByRole("option", { name: "11:00", exact: true }).click()
  for (const trigger of await dialog.getByTestId("schedule-technician").all()) {
    await trigger.click()
    await page.getByRole("option", { name: /Rakib/ }).click()
  }
  await dialog.getByTestId("schedule-submit").click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId("order-task")).toHaveCount(2)

  // The board shows the job in Booked, live.
  const board = await windowAs(context, "nayeem")
  await expect(board.getByTestId("board")).toBeVisible()
  await expect(board.locator(`[data-testid="board-column"][data-status="booked"] [data-testid="job-card"][data-order-no="${orderNo}"]`)).toBeVisible()
  await expect(board.locator('[data-testid="bay-lane"][data-bay="C1"] [data-testid="lane-task"]').first()).toBeVisible()

  // J2: Rakib starts and finishes both tasks; the recipe is issued.
  const rakib = await windowAs(context, "rakib")
  for (let i = 0; i < 2; i++) {
    const queued = rakib.locator(`[data-testid="job-task"][data-order-no="${orderNo}"][data-status="queued"]`).first()
    await queued.getByTestId("task-start").click()
    const running = rakib.locator(`[data-testid="job-task"][data-order-no="${orderNo}"][data-status="in-progress"]`).first()
    await running.getByTestId("task-finish").click()
    await expect(rakib.locator(`[data-testid="job-task"][data-order-no="${orderNo}"][data-status="done"]`)).toHaveCount(i + 1)
  }
  // Live on the board: the card moved to QC.
  await expect(board.locator(`[data-testid="board-column"][data-status="qc"] [data-testid="job-card"][data-order-no="${orderNo}"]`)).toBeVisible()
  const consumed = await rows<{ orderId: string; kind: string }>(page, "jobConsumptions")
  expect(consumed.filter((c) => c.orderId === orderId && c.kind === "recipe").length).toBeGreaterThan(5)

  // J3: Shahriar passes QC, then hands over with a signature and a gate pass.
  const shahriar = await windowAs(context, "shahriar")
  await shahriar.goto(`/sd/handover/${orderId}`)
  await shahriar.getByTestId("qc-pass").click()
  await expect(shahriar.getByTestId("handover-checklist")).toBeVisible()
  for (const key of ["exterior", "interior", "glass", "wheels", "belongings"]) await shahriar.getByTestId(`handover-item-${key}`).click()
  await sign(shahriar)
  await shahriar.getByTestId("handover-submit").click()
  await expect(shahriar.getByTestId("gate-pass")).toBeVisible()
  await expect(shahriar.getByTestId("gate-pass")).toContainText("GP-GUL-")
  await shahriar.keyboard.press("Escape")

  // J4: Tania takes the balance by card and cash; the deposit is applied.
  const tania = await windowAs(context, "tania")
  await tania.locator(`[data-testid="counter-order"][data-order-no="${orderNo}"]`).click()
  await expect(tania.getByTestId("counter-advance")).toContainText("10,000")
  await tania.getByTestId("tender-card").click()
  await tania.getByTestId("tender-amount").first().fill("20000")
  await tania.getByTestId("tender-cash").click()
  await tania.getByTestId("checkout-submit").click()
  await tania.getByTestId("card-approve").click()
  await expect(tania.getByTestId("counter-receipt")).toBeVisible()

  const invoices = await rows<{ orderIds: string[]; status: string; advanceAppliedP: number; invoiceNo: string }>(tania, "salesInvoices")
  const invoice = invoices.find((i) => i.orderIds.includes(orderId))
  expect(invoice?.status).toBe("paid")
  expect(invoice?.advanceAppliedP).toBe(10_000_00)
  const orders = await rows<{ id: string; status: string }>(tania, "salesOrders")
  expect(orders.find((o) => o.id === orderId)?.status).toBe("closed")

  // The books tie.
  const lines = await rows<{ debitP: number; creditP: number }>(tania, "journalLines")
  expect(lines.reduce((s, l) => s + l.debitP, 0)).toBe(lines.reduce((s, l) => s + l.creditP, 0))
})
