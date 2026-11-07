import { expect, test, type Page } from "@playwright/test"

import { pick, rows, sign, signIn, typeInto } from "../stl/helpers"
import { launchFromPanel } from "./helpers"

/**
 * The main-journey jump launchers J1 to J6 (plan §10, P3.3): each launched
 * twice in a row in one browser (one database), each time landing as the
 * right user on the right screen with its cue card, and its key action done
 * through the UI.
 */

const VEHICLE = "veh_corolla_cross_7731"

/** `?launch=<id>`: the window signs in as the scenario's user and opens its cue card. */
async function launch(page: Page, id: string, route: RegExp): Promise<void> {
  await page.goto(`/?launch=${id}`)
  await expect(page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)).toBeVisible({ timeout: 60_000 })
  await expect(page).toHaveURL(route)
  await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible()
}

/** The journey's current order (today's latest, not cancelled). */
async function journeyOrder(page: Page): Promise<{ id: string; orderNo: string; status: string }> {
  const orders = await rows<{ id: string; orderNo: string; status: string; vehicleId?: string; createdAt: number }>(page, "salesOrders")
  return orders.filter((o) => o.vehicleId === VEHICLE && o.status !== "cancelled").sort((a, b) => b.createdAt - a.createdAt)[0]
}

async function quoteAndBook(page: Page): Promise<string> {
  await pick(page, "quote-party", "Shahed", "pty_shahed_kabir")
  await pick(page, "quote-vehicle", "7731", VEHICLE)
  await pick(page, "quote-add-service", "PRT-CC2", "svc_prt_cc2")
  await pick(page, "quote-add-service", "INT-DEEP", "svc_int_deep")
  await page.getByTestId("quote-save").click()
  await expect(page.getByTestId("quote-view")).toBeVisible()
  await page.getByTestId("quote-accept").click()
  await page.getByTestId("deposit-toggle").click()
  await page.getByTestId("deposit-method").locator('[data-value="bkash"]').click()
  await typeInto(page.getByTestId("deposit-amount"), "10000")
  await page.getByTestId("accept-confirm").click()
  await page.getByTestId("mfs-approve").click()
  await expect(page.getByTestId("order-view")).toBeVisible()
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
  return (await page.getByTestId("doc-no").textContent())!.trim()
}

test("J1 twice: Nayeem books the journey from the quotation editor each time", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, "nayeem")
  await launchFromPanel(page, "J1")
  await expect(page).toHaveURL(/\/stl\/quotations\/new/)
  const first = await quoteAndBook(page)
  await launch(page, "J1", /\/stl\/quotations\/new/)
  await expect(page.getByTestId("cue-card")).toContainText("Booking")
  const second = await quoteAndBook(page)
  expect(second).not.toBe(first)
  const orders = await rows<{ orderNo: string; status: string }>(page, "salesOrders")
  expect(orders.find((o) => o.orderNo === first)?.status).toBe("cancelled")
  expect(orders.find((o) => o.orderNo === second)?.status).toBe("booked")
})

test("J2 twice: Rakib works the journey's tasks; the card moves to QC", async ({ page }) => {
  test.setTimeout(240_000)
  // The first run books a fresh journey into C1; the second brings the same
  // journey forward (one task already done) and Rakib finishes the other.
  for (let run = 0; run < 2; run++) {
    await launch(page, "J2", /\/stl\/my-jobs/)
    const order = await journeyOrder(page)
    const queued = page.locator(`[data-testid="job-task"][data-order-no="${order.orderNo}"][data-status="queued"]`).first()
    await queued.getByTestId("task-start").click()
    await page.locator(`[data-testid="job-task"][data-order-no="${order.orderNo}"][data-status="in-progress"]`).first().getByTestId("task-finish").click()
    await expect(page.locator(`[data-testid="job-task"][data-order-no="${order.orderNo}"][data-status="done"]`)).toHaveCount(run + 1)
  }
  await expect.poll(async () => (await journeyOrder(page)).status).toBe("qc")
})

test("J3 twice: Shahriar passes QC and hands over with the gate pass", async ({ page }) => {
  test.setTimeout(240_000)
  for (let run = 0; run < 2; run++) {
    await launch(page, "J3", /\/sd\/handover\//)
    await page.getByTestId("qc-pass").click()
    await expect(page.getByTestId("handover-checklist")).toBeVisible()
    for (const item of ["exterior", "interior", "glass", "wheels", "belongings"]) await page.getByTestId(`handover-item-${item}`).click()
    await sign(page)
    await page.getByTestId("handover-submit").click()
    await expect(page.getByTestId("gate-pass")).toBeVisible()
    await expect(page.getByTestId("print-preview")).toContainText("GP-GUL-")
    await page.keyboard.press("Escape")
    await expect.poll(async () => (await journeyOrder(page)).status).toBe("delivered")
  }
})

test("J4 twice: Tania takes the balance by card and cash", async ({ page }) => {
  test.setTimeout(240_000)
  for (let run = 0; run < 2; run++) {
    await launch(page, "J4", /\/si\/counter/)
    const order = await journeyOrder(page)
    await page.locator(`[data-testid="counter-order"][data-order-no="${order.orderNo}"]`).click()
    await expect(page.getByTestId("counter-advance")).toBeVisible()
    await page.getByTestId("tender-card").click()
    await typeInto(page.getByTestId("tender-amount").first(), "20000")
    await page.getByTestId("tender-cash").click()
    await page.getByTestId("checkout-submit").click()
    await page.getByTestId("card-approve").click()
    await expect(page.getByTestId("counter-receipt")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect.poll(async () => (await journeyOrder(page)).status).toBe("closed")
  }
})

test("J5 and J6 twice: the vouchers are in FA and the owner's dashboard shows the day", async ({ page }) => {
  test.setTimeout(300_000)
  for (let run = 0; run < 2; run++) {
    await launch(page, "J5", /\/fa\/journals/)
    const order = await journeyOrder(page)
    const invoices = await rows<{ invoiceNo: string; orderIds: string[]; status: string }>(page, "salesInvoices")
    const invoice = invoices.find((i) => i.orderIds.includes(order.id))!
    expect(invoice.status).toBe("paid")
    const list = page.getByTestId("journals-list")
    await list.locator("input").first().fill(invoice.invoiceNo)
    await page.getByTestId("journal-row").first().click()
    await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-status", "posted")
  }
  for (let run = 0; run < 2; run++) {
    await launch(page, "J6", /\/dashboard/)
    await expect(page.getByTestId("dashboard")).toBeVisible()
    await expect(page.getByTestId("kpi-revenue-today")).toBeVisible()
  }
  const lines = await rows<{ debitP: number; creditP: number }>(page, "journalLines")
  expect(lines.reduce((s, l) => s + l.debitP, 0)).toBe(lines.reduce((s, l) => s + l.creditP, 0))
})
