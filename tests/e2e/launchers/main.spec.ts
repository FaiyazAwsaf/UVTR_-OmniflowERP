import { expect, test, type BrowserContext, type Page } from "@playwright/test"

/**
 * The main agent's scenario launchers E13 to E16 (plan §10, P3.3): each
 * launched twice in a row in one browser, each time landing as the right
 * user on the right screen with its cue card (and its companion window or
 * Demo Wall pane), and its key action done through the UI.
 */

async function launch(page: Page, id: string, route: RegExp): Promise<void> {
  await page.goto(`/?launch=${id}`)
  await expect(page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)).toBeVisible({ timeout: 60_000 })
  await expect(page).toHaveURL(route)
  // The cue card can cover buttons in a 960x600 window: close it once checked.
  await page.getByTestId("cue-close").click()
}

/** Launch and catch the companion window the launcher opens. */
async function launchWithCompanion(context: BrowserContext, page: Page, id: string, route: RegExp, companionRoute: RegExp): Promise<Page> {
  const opened = context.waitForEvent("page", { timeout: 60_000 })
  await launch(page, id, route)
  const companion = await opened
  await expect(companion).toHaveURL(companionRoute, { timeout: 30_000 })
  await expect(companion.locator('[data-slot="erp-shell"]')).toBeVisible({ timeout: 30_000 })
  return companion
}

const cell = (page: Page, app: string, column: string) =>
  page.locator(`[data-testid="matrix-cell"][data-app="${app}"][data-column="${column}"]`)

test("E13 twice: revoking the advisor's customer key hides + New customer live; the next run restores it", async ({ context }) => {
  test.setTimeout(240_000)
  const admin = await context.newPage()
  for (let run = 0; run < 2; run++) {
    const nayeem = await launchWithCompanion(context, admin, "E13", /\/rbac\/roles\/role_advisor/, /\/stl\/quotations\/new/)
    await expect(nayeem.getByTestId("quick-add")).toBeVisible()
    await expect(cell(admin, "par", "create")).toHaveAttribute("data-state", "indeterminate")
    await cell(admin, "par", "create").getByTestId("matrix-keys").click()
    await admin.locator('[data-testid="matrix-key"][data-key="par.customer.create"]').click()
    await admin.keyboard.press("Escape")
    await admin.getByTestId("matrix-save").click()
    await expect(cell(admin, "par", "create")).toHaveAttribute("data-state", "unchecked")
    // Live in Nayeem's window, no reload.
    await expect(nayeem.getByTestId("quick-add")).toHaveCount(0)
    await nayeem.close()
  }
})

test("E14 twice: five wrong passwords lock Shuvo, Tahmid unlocks him and ends Nayeem's session", async ({ context }) => {
  test.setTimeout(240_000)
  const admin = await context.newPage()
  for (let run = 0; run < 2; run++) {
    const nayeem = await launchWithCompanion(context, admin, "E14", /\/sac/, /\/stl\/board/)
    const shuvo = admin.locator('[data-testid="user-row"][data-username="shuvo"]')
    await expect(shuvo).toHaveAttribute("data-status", "active")
    const login = await context.newPage()
    await login.goto("/login")
    await login.getByTestId("login-username").fill("shuvo")
    for (let attempt = 1; attempt <= 5; attempt++) {
      await login.getByTestId("login-password").fill(`wrong-${attempt}`)
      await login.getByTestId("login-submit").click()
      await expect(login.getByTestId("login-error")).toBeVisible()
    }
    await expect(login.getByTestId("login-error")).toHaveAttribute("data-reason", "locked")
    await login.close()
    await expect(shuvo).toHaveAttribute("data-status", "locked")
    if (run === 0) {
      await shuvo.getByTestId("user-unlock").click()
      await expect(shuvo).toHaveAttribute("data-status", "active")
    }
    // On the second run Shuvo stays locked: the next launch unlocks him (checked below).
    await admin.getByTestId("tab-sac-sessions").click()
    const row = admin.locator('[data-testid="session-row"][data-username="nayeem"]').first()
    await row.getByTestId("session-end").click()
    await admin.getByTestId("confirm-reason").fill("E14 demo")
    await admin.getByTestId("confirm-ok").click()
    await expect(nayeem).toHaveURL(/\/login/, { timeout: 30_000 })
    await expect(nayeem.getByTestId("signed-out-notice")).toHaveAttribute("data-reason", "forced")
    await nayeem.close()
  }
  const nayeem = await launchWithCompanion(context, admin, "E14", /\/sac/, /\/stl\/board/)
  await expect(admin.locator('[data-testid="user-row"][data-username="shuvo"]')).toHaveAttribute("data-status", "active")
  await nayeem.close()
})

test("E15 twice on the Demo Wall: the launcher opens Mahbub in the next pane; the second save conflicts", async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1920, height: 1200 })
  await page.goto("/wall?users=farzana,tania,rakib,nayeem")
  await expect(page.getByTestId("demo-wall")).toBeVisible()
  for (let run = 0; run < 2; run++) {
    const one = page.frame({ name: "of-wall-1" })!
    await expect.poll(() => one.url(), { timeout: 60_000 }).toMatch(/\/home|\/par/)
    await one.goto("/?launch=E15")
    await expect(page.frameLocator('iframe[name="of-wall-1"]').locator('[data-testid="cue-card"][data-scenario-id="E15"]')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId("wall-user-2")).toContainText("Mahbub Alam", { timeout: 30_000 })
    const paneOne = page.frameLocator('iframe[name="of-wall-1"]')
    const paneTwo = page.frameLocator('iframe[name="of-wall-2"]')
    for (const pane of [paneOne, paneTwo]) {
      await expect(pane.getByTestId("party-edit")).toBeVisible({ timeout: 60_000 })
      await pane.getByTestId("party-edit").click()
      await expect(pane.getByTestId("party-form")).toBeVisible()
    }
    await paneOne.getByTestId("party-phone").fill(`01711-55000${run}`)
    await paneOne.getByTestId("party-save").click()
    await expect(paneOne.getByTestId("party-phone-text")).toHaveText(`01711-55000${run}`)
    await paneTwo.getByTestId("party-phone").fill(`01811-55000${run}`)
    await paneTwo.getByTestId("party-save").click()
    await expect(paneTwo.getByText("This record was changed")).toBeVisible()
    await paneTwo.locator("body").press("Escape")
  }
})

test("E16 twice: Rashed lands on the builder and saves a new report each time", async ({ page }) => {
  test.setTimeout(240_000)
  const saved: string[] = []
  for (let run = 0; run < 2; run++) {
    await launch(page, "E16", /\/irt\/builder/)
    await page.getByTestId("builder-dataset").click()
    await page.getByRole("option", { name: "Invoice lines" }).click()
    await page.getByTestId("builder-group-1").click()
    await page.getByRole("option", { name: "Category" }).click()
    await page.getByTestId("builder-chart").click()
    await page.getByRole("option", { name: "Bar" }).click()
    await expect(page.getByTestId("builder-preview")).toBeVisible()
    await page.getByTestId("builder-save").click()
    await page.getByTestId("builder-name-en").fill(`Revenue by service category ${run + 1}`)
    await page.getByTestId("builder-save-confirm").click()
    const toast = page.getByText(/saved as RPT-\d{4}/).last()
    await expect(toast).toBeVisible()
    saved.push((await toast.textContent()) ?? "")
    await expect(page).toHaveURL(/\/irt\/builder\?id=/)
  }
  expect(new Set(saved).size).toBe(2)
})
