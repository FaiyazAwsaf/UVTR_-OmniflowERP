import { expect, test } from "@playwright/test"

import { amountOf, retailSkuWithStock, rows, signIn, typeInto, windowAs } from "./helpers"

/**
 * WS-Dash: the owner's executive dashboard (every tile with its drill-down,
 * a drill into IRT-16 with the period, live revenue and cash after a sale
 * in another window), the role homes and the STL studio home.
 */

const KPIS = [
  "kpi-revenue-today",
  "kpi-revenue-mtd",
  "kpi-collections",
  "kpi-receivables",
  "kpi-overdue",
  "kpi-payables-due",
  "kpi-cash",
  "kpi-gross-margin",
  "kpi-stock-value",
]

test("Rashed's dashboard shows every tile, each with its drill-down", async ({ page }) => {
  await signIn(page, "rashed")
  await expect(page).toHaveURL(/\/dashboard/)
  const dash = page.getByTestId("dashboard")
  await expect(dash).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
  for (const id of KPIS) {
    const tile = page.getByTestId(id)
    await expect(tile, id).toBeVisible()
    await expect(tile.getByTestId("drill-link"), id).toHaveAttribute("data-href", /^\//)
    if (id === "kpi-gross-margin") await expect(tile).toHaveAttribute("data-value", /^-?\d+(\.\d+)?$/)
    else expect(await amountOf(page, id), id).toBeGreaterThanOrEqual(id === "kpi-revenue-today" ? 0 : 1)
  }
  for (const id of ["revenue-trend", "jobs-by-status", "bay-utilisation", "top-services", "alerts"]) await expect(page.getByTestId(id), id).toBeVisible()
  await expect(page.getByTestId("alert-item")).toHaveCount(6)
  await expect(page.getByTestId("alert-item").filter({ has: page.getByTestId("drill-link") })).toHaveCount(6)
  await expect(page.getByTestId("top-service").first()).toBeVisible()
  await expect(page.getByTestId("jobs-cell").first()).toBeVisible()
  await expect(page.locator('[data-testid="bay-studio"]')).toHaveCount(2)
  // The period control re-scopes the period tiles; a studio filter narrows them.
  await page.getByTestId("dashboard-period-last-month").click()
  await expect(dash).toHaveAttribute("data-period", "last-month")
  await expect(page.getByTestId("kpi-revenue-mtd").getByTestId("drill-link")).toHaveAttribute("data-href", /IRT-16\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/)
  await page.getByTestId("dashboard-location").click()
  await page.locator('[data-testid="dashboard-location-option"][data-value="loc_gul"]').click()
  await expect(dash).toHaveAttribute("data-location", "loc_gul")
  await expect(page.locator('[data-testid="bay-studio"]')).toHaveCount(1)
  await expect(page.getByTestId("kpi-revenue-mtd").getByTestId("drill-link")).toHaveAttribute("data-href", /loc=loc_gul/)
})

test("a drill-down opens IRT-16 with the dashboard's period", async ({ page }) => {
  await signIn(page, "rashed")
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
  const link = page.getByTestId("kpi-revenue-mtd").getByTestId("drill-link")
  const href = (await link.getAttribute("data-href")) ?? ""
  const url = new URL(href, "http://x")
  expect(url.pathname).toBe("/irt/run/IRT-16")
  const from = url.searchParams.get("from") ?? ""
  const to = url.searchParams.get("to") ?? ""
  expect(from).toMatch(/^\d{4}-\d{2}-01$/)
  expect(to.slice(0, 7)).toBe(from.slice(0, 7))
  await link.click()
  await expect(page).toHaveURL(/\/irt\/run\/IRT-16\?from=/)
  await expect(page.getByTestId("report-runner")).toHaveAttribute("data-code", "IRT-16")
  await expect(page.getByTestId("report-result")).toBeVisible({ timeout: 20_000 })
  const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
  await expect(page.getByTestId("report-from")).toHaveValue(dmy(from))
  await expect(page.getByTestId("report-to")).toHaveValue(dmy(to))
})

test("a walk-in sale at the counter moves revenue today and cash on the dashboard without a reload", async ({ context }) => {
  test.setTimeout(120_000)
  const rashed = await windowAs(context, "rashed")
  await expect(rashed.getByTestId("dashboard")).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
  const revenueBefore = await amountOf(rashed, "kpi-revenue-today")
  const cashBefore = await amountOf(rashed, "kpi-cash")
  const collectionsBefore = await amountOf(rashed, "kpi-collections")

  const tania = await windowAs(context, "tania")
  await expect(tania.getByTestId("counter")).toBeVisible()
  const sku = await retailSkuWithStock(tania, "loc_gul", 2)
  const invoicesBefore = new Set((await rows<{ id: string }>(tania, "salesInvoices")).map((i) => i.id))
  await tania.getByTestId("counter-item").click()
  await tania.getByTestId("counter-item-search").fill(sku)
  await tania.getByTestId("counter-item-option").first().click()
  await tania.getByTestId("counter-item-add").click()
  await expect(tania.getByTestId("counter-lines")).toBeVisible()
  await tania.getByTestId("tender-cash").click()
  await typeInto(tania.getByTestId("tender-received"), "10000")
  await tania.getByTestId("checkout-submit").click()
  await expect(tania.getByTestId("counter-receipt")).toBeVisible()

  const invoice = (await rows<{ id: string; totalP: number; partyId: string }>(tania, "salesInvoices")).find((i) => !invoicesBefore.has(i.id))
  expect(invoice?.partyId).toBe("pty_walk_in")
  const lines = (await rows<{ invoiceId: string; netP: number }>(tania, "salesInvoiceLines")).filter((l) => l.invoiceId === invoice!.id)
  const netP = lines.reduce((s, l) => s + l.netP, 0)

  // Rashed's window, untouched: the figures move by the invoice amounts.
  await expect(rashed.getByTestId("kpi-revenue-today")).toHaveAttribute("data-amount", String(revenueBefore + netP), { timeout: 15_000 })
  await expect(rashed.getByTestId("kpi-cash")).toHaveAttribute("data-amount", String(cashBefore + invoice!.totalP))
  await expect(rashed.getByTestId("kpi-collections")).toHaveAttribute("data-amount", String(collectionsBefore + invoice!.totalP))
  expect(new URL(rashed.url()).pathname).toBe("/dashboard")
})

const HOMES: [string, string][] = [
  ["rashed", "OWNER"],
  ["farzana", "ACC_MGR"],
  ["mahbub", "ACCOUNTANT"],
  ["nayeem", "ADVISOR"],
  ["rakib", "TECHNICIAN"],
  ["tania", "CASHIER"],
  ["habib", "STORE"],
  ["tahmid", "SYS_ADMIN"],
]

test("the role homes: KPIs and to-dos for each role", async ({ context }) => {
  test.setTimeout(150_000)
  for (const [user, role] of HOMES) {
    const page = await windowAs(context, user)
    if (!page.url().endsWith("/home")) await page.goto("/home")
    const home = page.getByTestId("role-home")
    await expect(home, user).toHaveAttribute("data-role", role, { timeout: 20_000 })
    await expect(page.getByTestId("home-kpi"), user).toHaveCount(4)
    for (const kpi of await page.getByTestId("home-kpi").all()) await expect(kpi.getByTestId("drill-link")).toHaveAttribute("data-href", /^\//)
    if (role === "OWNER") {
      await expect(page.locator('[data-testid="todo-item"][data-kind="dashboard"]')).toBeVisible()
      await expect(page.getByTestId("home-approvals")).toHaveAttribute("data-value", /^[1-9]\d*$/)
    }
    if (role === "ACC_MGR") await expect(page.locator('[data-testid="todo-item"][data-kind="bill-hold"]').first()).toBeVisible()
    if (role === "ACCOUNTANT") await expect(page.locator('[data-testid="todo-item"][data-kind="pdc"]').first()).toBeVisible()
    if (role === "ADVISOR") await expect(home).toHaveAttribute("data-location", "loc_gul")
    if (role === "TECHNICIAN") {
      for (const item of await page.getByTestId("todo-item").all()) await expect(item).toHaveAttribute("data-kind", "task")
    }
    if (role === "CASHIER") await expect(page.locator('[data-testid="home-kpi"][data-kind="tillBalance"]')).toHaveAttribute("data-amount", /^\d+$/)
    if (role === "STORE") await expect(page.locator('[data-testid="todo-item"][data-kind="grn"]').first()).toBeVisible()
    if (role === "SYS_ADMIN") await expect(page.locator('[data-testid="todo-item"][data-kind="locked-user"][data-ref="polash"]')).toBeVisible()
    // Each to-do opens the screen to act on it.
    const first = page.getByTestId("todo-item").first()
    if (await first.count()) await expect(first).toHaveAttribute("data-href", /^\//)
    await page.close()
  }
})

test("/stl studio home for Shahriar (Gulshan) and Arif (Uttara)", async ({ context }) => {
  test.setTimeout(120_000)
  for (const [user, code, loc] of [
    ["shahriar", "GUL", "loc_gul"],
    ["arif", "UTT", "loc_utt"],
  ] as const) {
    const page = await windowAs(context, user)
    await expect(page).toHaveURL(/\/stl$/)
    const studio = page.getByTestId("studio-home")
    await expect(studio).toHaveAttribute("data-code", code, { timeout: 20_000 })
    await expect(studio).toHaveAttribute("data-location", loc)
    await expect(page.getByTestId("studio-kpi")).toHaveCount(4)
    await expect(page.locator('[data-testid="studio-kpi"][data-kind="jobs"]')).toHaveAttribute("data-value", /^[1-9]\d*$/)
    await expect(page.getByTestId("studio-order").first()).toBeVisible()
    await expect(page.getByTestId("studio-column")).toHaveCount(5)
    const orders = await rows<{ locationId: string; status: string }>(page, "salesOrders")
    const inProgress = orders.filter((o) => o.locationId === loc && o.status === "in-progress").length
    await expect(page.locator('[data-testid="studio-column"][data-status="in-progress"]')).toHaveAttribute("data-value", String(inProgress))
    await expect(page.getByTestId("studio-link-board")).toBeVisible()
    await expect(page.getByTestId("studio-booking").first()).toBeVisible()
    await page.close()
  }
})
