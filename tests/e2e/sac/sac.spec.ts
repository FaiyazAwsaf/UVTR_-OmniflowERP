import { expect, test } from "@playwright/test"

import { signIn } from "../shell/helpers"

/**
 * SAC screens (plan §9) and E14 by hand: lockout after five wrong
 * passwords seen live in the administrator's window, unlock, and a forced
 * sign-out that returns the other window to /login.
 */
test.describe("SAC users, sessions, policy and audit", () => {
  test("E14: lockout shows live, unlock, and force sign-out returns Nayeem's window to /login", async ({ browser }) => {
    test.setTimeout(90_000)
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const admin = await context.newPage()
    const login = await context.newPage()
    const advisor = await context.newPage()
    await signIn(admin, "tahmid")
    await signIn(advisor, "nayeem")
    await expect(admin.getByTestId("user-row").first()).toBeVisible()
    const shuvo = admin.locator('[data-testid="user-row"][data-username="shuvo"]')
    await expect(shuvo).toHaveAttribute("data-status", "active")

    await login.goto("/login")
    await login.getByTestId("login-username").fill("shuvo")
    for (let attempt = 1; attempt <= 5; attempt++) {
      await login.getByTestId("login-password").fill(`wrong-${attempt}`)
      await login.getByTestId("login-submit").click()
      await expect(login.getByTestId("login-error")).toBeVisible()
    }
    await expect(login.getByTestId("login-error")).toHaveAttribute("data-reason", "locked")

    // The administrator's list turns Shuvo locked without a reload, then unlocks him.
    await expect(shuvo).toHaveAttribute("data-status", "locked")
    await shuvo.getByTestId("user-unlock").click()
    await expect(shuvo).toHaveAttribute("data-status", "active")

    // Force sign-out of Nayeem's session.
    await admin.getByTestId("tab-sac-sessions").click()
    const row = admin.locator('[data-testid="session-row"][data-username="nayeem"]')
    await expect(row).toBeVisible()
    await expect(admin.locator('[data-testid="session-row"][data-own="true"]')).toHaveCount(1)
    await row.getByTestId("session-end").click()
    await admin.getByTestId("confirm-reason").fill("E14 demo")
    await admin.getByTestId("confirm-ok").click()
    await expect(row).toHaveCount(0)
    await expect(admin.locator('[data-testid="session-ended-row"][data-username="nayeem"]').first()).toBeVisible()

    await expect(advisor).toHaveURL(/\/login/)
    await expect(advisor.getByTestId("signed-out-notice")).toHaveAttribute("data-reason", "forced")
    await context.close()
  })

  test("create a user with a one-time password, reset it, disable and enable", async ({ page }) => {
    test.setTimeout(90_000)
    await signIn(page, "tahmid")
    await page.getByTestId("user-new").click()
    await page.getByTestId("user-username").fill("nadia")
    await page.getByTestId("user-name-en").fill("Nadia Rahman")
    await page.getByTestId("user-name-bn").fill("নাদিয়া রহমান")
    await page.locator('[data-testid="user-location"][data-location="GUL"]').click()
    await page.getByTestId("user-save").click()
    await expect(page.getByTestId("temp-password")).toHaveText(/^[A-Z][a-z]{4}-\d{4}$/)
    await page.getByTestId("temp-password-done").click()

    const row = page.locator('[data-testid="user-row"][data-username="nadia"]')
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByTestId("user-detail")).toHaveAttribute("data-username", "nadia")
    await expect(page.getByTestId("must-change")).toBeVisible()

    await page.getByTestId("user-reset").click()
    await page.getByTestId("confirm-ok").click()
    await expect(page.getByTestId("temp-password")).toHaveText(/^[A-Z][a-z]{4}-\d{4}$/)
    await page.getByTestId("temp-password-done").click()

    await page.getByTestId("user-disable").click()
    await page.getByTestId("confirm-ok").click()
    await expect(page.getByTestId("user-status")).toHaveText("Disabled")
    await expect(page.getByTestId("user-disable")).toHaveAttribute("data-action", "enable")
    await page.getByTestId("user-disable").click()
    await page.getByTestId("confirm-ok").click()
    await expect(page.getByTestId("user-status")).toHaveText("Active")
  })

  test("login history filters by result; the policy saves; Polash unlocks from the list", async ({ page }) => {
    await signIn(page, "tahmid")
    const polash = page.locator('[data-testid="user-row"][data-username="polash"]')
    await expect(polash).toHaveAttribute("data-status", "locked")

    await page.goto("/sac/login-history")
    await expect(page.getByTestId("login-row").first()).toBeVisible()
    await page.getByTestId("login-result").click()
    await page.getByRole("option", { name: "Wrong password" }).click()
    await expect(page.locator('[data-testid="login-row"][data-result="success"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="login-row"][data-username="polash"]').first()).toBeVisible()

    await page.goto("/sac/policy")
    await page.getByTestId("policy-idle").fill("240")
    await page.getByTestId("policy-save").click()
    await expect(page.getByText("Security policy saved.")).toBeVisible()
    await page.reload()
    await expect(page.getByTestId("policy-idle")).toHaveValue("240")

    await page.goto("/sac")
    await polash.getByTestId("user-unlock").click()
    await expect(polash).toHaveAttribute("data-status", "active")
  })

  test("the auditor opens only the audit trail, verifies the chain and filters by record type", async ({ page }) => {
    await signIn(page, "rashed")
    await page.goto("/?user=shamima")
    await expect(page).toHaveURL(/\/frs/)
    await page.goto("/sac/audit")
    await expect(page.getByTestId("audit-viewer")).toBeVisible()
    await page.getByTestId("audit-verify").click()
    await expect(page.getByTestId("audit-chain")).toHaveAttribute("data-state", "intact")
    await page.getByTestId("audit-entity").click()
    await page.getByRole("option", { name: "loginEvents" }).click()
    await expect(page.getByTestId("audit-row").first()).toBeVisible()
    await page.getByTestId("audit-row").first().click()
    await expect(page.getByTestId("audit-details")).toBeVisible()
    await page.goto("/sac")
    await expect(page.getByTestId("access-denied")).toBeVisible()
  })
})
