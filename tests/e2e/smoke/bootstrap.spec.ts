import { expect, test } from "@playwright/test"

/** Every route under app/(erp) (plan §9), dynamic segments filled with a dummy id. */
const ROUTES: string[] = ["/ap", "/ap/aging", "/ap/bills", "/ap/bills/[id]", "/ap/bills/new", "/ap/debit-notes", "/ap/payments", "/ap/payments/[id]", "/ap/payments/new", "/approvals", "/apps", "/ar", "/ar/aging", "/ar/credit-control", "/ar/receipts", "/ar/receipts/new", "/ar/refunds", "/ar/statements/[partyId]", "/cab", "/cab/accounts/[id]", "/cab/cheques", "/cab/petty-cash", "/cab/reconciliation", "/cab/settlements", "/cab/transfers", "/dashboard", "/fa", "/fa/accounts", "/fa/journals", "/fa/journals/[id]", "/fa/journals/new", "/fa/ledger", "/fa/periods", "/fa/recurring", "/fa/settings", "/frs", "/frs/balance-sheet", "/frs/cash-flow", "/frs/profit-loss", "/frs/trial-balance", "/frs/vat", "/frs/withholding", "/grn", "/grn/[id]", "/grn/quarantine", "/grn/receive/[poId]", "/home", "/ic", "/ic/consumption", "/ic/counts", "/ic/counts/[id]", "/ic/expiry", "/ic/items/[id]", "/ic/reorder", "/irt", "/irt/builder", "/irt/history", "/irt/run/[code]", "/irt/schedules", "/par", "/par/[id]", "/par/new", "/par/vehicles", "/pc", "/pc/packages", "/pc/price-lists", "/pc/promotions", "/pc/services/[id]", "/pm", "/pm/categories", "/pm/items/[id]", "/pm/uom", "/ptl", "/ptl/po", "/ptl/po/[id]", "/ptl/requisitions", "/ptl/requisitions/[id]", "/ptl/returns", "/rbac", "/rbac/assignments", "/rbac/effective", "/rbac/limits", "/rbac/roles/[id]", "/rbac/sod", "/sac", "/sac/audit", "/sac/login-history", "/sac/policy", "/sac/sessions", "/sac/users/[id]", "/sd", "/sd/deliveries", "/sd/handover/[orderId]", "/si", "/si/[id]", "/si/counter", "/si/credit-notes", "/si/new", "/st", "/st/adjustments", "/st/issues", "/st/transfers", "/st/transfers/[id]", "/stl", "/stl/board", "/stl/my-jobs", "/stl/orders", "/stl/orders/[id]", "/stl/orders/new", "/stl/quotations", "/stl/quotations/[id]", "/stl/quotations/new"]

const SHOTS = process.env.SHOTS_DIR

test.describe("Phase 0 bootstrap", () => {
  test("the launcher signs a window in and /apps shows the 18 apps in 4 suites", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("launcher")).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/launcher-960.png` })
    await page.getByTestId("launch-rashed").click()
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto("/apps")
    await expect(page.getByTestId("apps-grid")).toBeVisible()
    for (const suite of ["fms", "sdm", "scm", "csc"]) {
      await expect(page.getByTestId(`suite-${suite}`)).toBeVisible()
    }
    await expect(page.locator('[data-testid^="app-tile-"]')).toHaveCount(18)
    await expect(page.locator('[data-testid^="app-tile-"][data-locked="true"]')).toHaveCount(0)
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/apps-960.png`, fullPage: true })
      await page.setViewportSize({ width: 1920, height: 1200 })
      await page.screenshot({ path: `${SHOTS}/apps-1920.png` })
    }
  })

  test("every ERP route resolves inside the shell", async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto("/?user=rashed")
    await expect(page).toHaveURL(/\/dashboard/)
    for (const route of ROUTES) {
      const path = route.replace(/\[[^\]]+\]/g, "x")
      await page.goto(path)
      await expect(page.locator('[data-slot="erp-shell"]'), path).toBeVisible()
      await expect(page.getByTestId("access-denied"), path).toHaveCount(0)
    }
  })

  test("a cashier sees only her apps; others are locked or denied", async ({ page }) => {
    await page.goto("/?user=tania")
    await expect(page).toHaveURL(/\/si\/counter/)
    await page.goto("/apps")
    await expect(page.getByTestId("app-tile-sac")).toHaveAttribute("data-locked", "true")
    await expect(page.getByTestId("app-tile-si")).not.toHaveAttribute("data-locked", "true")
    await page.goto("/fa")
    await expect(page.getByTestId("access-denied")).toBeVisible()
    await expect(page.getByTestId("nav-fa")).toHaveCount(0)
    await expect(page.getByTestId("nav-si")).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/denied-960.png` })
  })

  test("sign-in counts failures and the demo password works", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-username").fill("mahbub")
    await page.getByTestId("login-password").fill("wrong")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-error")).toContainText("4")
    await page.getByTestId("login-password").fill("demo1234")
    await page.getByTestId("login-submit").click()
    await expect(page).toHaveURL(/\/fa/)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/fa-960.png` })
  })
})
