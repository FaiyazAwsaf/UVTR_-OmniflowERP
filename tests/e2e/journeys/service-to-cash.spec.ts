import { expect, test, type Page } from "@playwright/test"

import { pick, rows, sign, signIn, typeInto, windowAs } from "../stl/helpers"

/**
 * Service to cash (plan §10 J1 to J5, P2.7): one browser, one database, a
 * window per person, every hand-off live.
 *
 * J1 Nayeem quotes ceramic coating 2-year and interior deep clean for Shahed
 *    Kabir's Corolla Cross, accepts it with a bKash deposit and books bay C1.
 * J2 Rakib starts and finishes both tasks; the ceramic kit's stock card at
 *    Gulshan gains the issue live in another window (IC).
 * J3 Shahriar passes QC and hands over with a signature and a gate pass.
 * J4 Tania issues the Mushak 6.3 invoice with the deposit applied and takes
 *    the balance by card and cash.
 * J5 Mahbub finds the vouchers in FA, follows one back to its invoice, and
 *    the trial balance still ties.
 */

const CC2_KIT = "itm_cc2_kit"

async function stockCardRows(page: Page): Promise<number> {
  await expect(page.getByTestId("stock-card")).toBeVisible()
  return page.getByTestId("stock-card-row").count()
}

async function searchJournals(page: Page, text: string): Promise<void> {
  const list = page.getByTestId("journals-list")
  await expect(list).toBeVisible()
  const search = list.locator("input").first()
  await search.fill(text)
}

test("service to cash: J1 to J5 across five windows, the books tie", async ({ page, context }) => {
  test.setTimeout(300_000)

  // J1: quotation, acceptance with a bKash deposit, booking.
  await signIn(page, "nayeem")
  await page.goto("/stl/quotations/new")
  await pick(page, "quote-party", "Shahed", "pty_shahed_kabir")
  await pick(page, "quote-vehicle", "7731", "veh_corolla_cross_7731")
  await pick(page, "quote-add-service", "PRT-CC2", "svc_prt_cc2")
  await pick(page, "quote-add-service", "INT-DEEP", "svc_int_deep")
  await expect(page.getByTestId("quote-line")).toHaveCount(2)
  await page.getByTestId("quote-save").click()
  await expect(page.getByTestId("quote-view")).toBeVisible()
  await page.getByTestId("quote-accept").click()
  await page.getByTestId("deposit-toggle").click()
  await page.getByTestId("deposit-method").locator('[data-value="bkash"]').click()
  await typeInto(page.getByTestId("deposit-amount"), "10000")
  await page.getByTestId("accept-confirm").click()
  await page.getByTestId("mfs-approve").click()
  await expect(page.getByTestId("order-view")).toBeVisible()
  await expect(page.getByTestId("order-advance")).toContainText("10,000")
  const orderNo = (await page.getByTestId("doc-no").textContent())!.trim()
  const orderId = page.url().split("/").pop()!

  // Schedule into bay C1 at 11:00 with Rakib for both services.
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

  // The board (another window) shows the job in Booked.
  const board = await windowAs(context, "nayeem")
  await expect(board.locator(`[data-testid="board-column"][data-status="booked"] [data-testid="job-card"][data-order-no="${orderNo}"]`)).toBeVisible()

  // The ceramic kit's stock card at Gulshan, open before the work starts.
  const stock = await windowAs(context, "nayeem")
  await stock.goto(`/ic/items/${CC2_KIT}?location=loc_gul`)
  const movesBefore = await stockCardRows(stock)

  // J2: Rakib starts and finishes both tasks.
  const rakib = await windowAs(context, "rakib")
  for (let i = 0; i < 2; i++) {
    const queued = rakib.locator(`[data-testid="job-task"][data-order-no="${orderNo}"][data-status="queued"]`).first()
    await queued.getByTestId("task-start").click()
    const running = rakib.locator(`[data-testid="job-task"][data-order-no="${orderNo}"][data-status="in-progress"]`).first()
    await running.getByTestId("task-finish").click()
    await expect(rakib.locator(`[data-testid="job-task"][data-order-no="${orderNo}"][data-status="done"]`)).toHaveCount(i + 1)
  }
  // Live, without a reload: the card moved to QC and the kit's issue is on the stock card.
  await expect(board.locator(`[data-testid="board-column"][data-status="qc"] [data-testid="job-card"][data-order-no="${orderNo}"]`)).toBeVisible()
  await expect.poll(() => stock.getByTestId("stock-card-row").count(), { timeout: 15_000 }).toBeGreaterThan(movesBefore)

  // J3: Shahriar passes QC and hands over with a signature and a gate pass.
  const shahriar = await windowAs(context, "shahriar")
  await shahriar.goto(`/sd/handover/${orderId}`)
  await shahriar.getByTestId("qc-pass").click()
  await expect(shahriar.getByTestId("handover-checklist")).toBeVisible()
  for (const key of ["exterior", "interior", "glass", "wheels", "belongings"]) await shahriar.getByTestId(`handover-item-${key}`).click()
  await sign(shahriar)
  await shahriar.getByTestId("handover-submit").click()
  await expect(shahriar.getByTestId("gate-pass")).toBeVisible()
  await expect(shahriar.getByTestId("print-preview")).toContainText("GP-GUL-")
  await shahriar.keyboard.press("Escape")

  // J4: Tania takes the balance by card and cash; the deposit is applied.
  const tania = await windowAs(context, "tania")
  await tania.locator(`[data-testid="counter-order"][data-order-no="${orderNo}"]`).click()
  await expect(tania.getByTestId("counter-advance")).toContainText("10,000")
  await tania.getByTestId("tender-card").click()
  await typeInto(tania.getByTestId("tender-amount").first(), "20000")
  await tania.getByTestId("tender-cash").click()
  await tania.getByTestId("checkout-submit").click()
  await tania.getByTestId("card-approve").click()
  await expect(tania.getByTestId("counter-receipt")).toBeVisible()

  const invoices = await rows<{ id: string; orderIds: string[]; status: string; advanceAppliedP: number; invoiceNo: string }>(tania, "salesInvoices")
  const invoice = invoices.find((i) => i.orderIds.includes(orderId))!
  expect(invoice.status).toBe("paid")
  expect(invoice.advanceAppliedP).toBe(10_000_00)

  // J5: Mahbub finds the job's vouchers in FA and follows the invoice's back to SI.
  const mahbub = await windowAs(context, "mahbub")
  await mahbub.goto("/fa/journals")
  await searchJournals(mahbub, orderNo)
  await expect(mahbub.getByTestId("journal-row").first()).toBeVisible()
  await searchJournals(mahbub, invoice.invoiceNo)
  const invoiceVoucher = mahbub.getByTestId("journal-row").first()
  await expect(invoiceVoucher).toBeVisible()
  await invoiceVoucher.click()
  await expect(mahbub.getByTestId("voucher-page")).toHaveAttribute("data-status", "posted")
  await mahbub.locator('[data-testid="doc-link"][data-doc-type="salesInvoices"]').first().click()
  await expect(mahbub).toHaveURL(new RegExp(`/si/${invoice.id}`))

  // Every voucher of the job is posted and balanced; the trial balance ties.
  const journals = await rows<{ id: string; status: string; source?: { docId: string } }>(mahbub, "journals")
  const lines = await rows<{ journalId: string; debitP: number; creditP: number }>(mahbub, "journalLines")
  const receipts = await rows<{ id: string; orderId?: string; allocations: { invoiceId: string }[] }>(mahbub, "receipts")
  const jobReceipts = receipts.filter((r) => r.orderId === orderId || r.allocations.some((a) => a.invoiceId === invoice.id))
  const docIds = new Set([orderId, invoice.id, ...jobReceipts.map((r) => r.id)])
  const jobJournals = journals.filter((j) => j.source && docIds.has(j.source.docId))
  expect(jobJournals.length).toBeGreaterThanOrEqual(4)
  for (const j of jobJournals) {
    const own = lines.filter((l) => l.journalId === j.id)
    expect(own.reduce((s, l) => s + l.debitP, 0)).toBe(own.reduce((s, l) => s + l.creditP, 0))
  }
  expect(lines.reduce((s, l) => s + l.debitP, 0)).toBe(lines.reduce((s, l) => s + l.creditP, 0))
  await mahbub.goto("/frs/trial-balance")
  await expect(mahbub.getByTestId("tb-balanced")).toHaveAttribute("data-balanced", "true")
  // The balance sheet (with this year's profit from the P&L) and the cash flow tie too.
  await mahbub.goto("/frs/balance-sheet")
  await expect(mahbub.getByTestId("bs-balanced")).toHaveAttribute("data-balanced", "true")
  await mahbub.goto("/frs/cash-flow")
  await expect(mahbub.getByTestId("cf-balanced")).toHaveAttribute("data-balanced", "true")
})
