import { expect, test } from "@playwright/test"

import { openDemoPanel, signIn } from "./helpers"

/**
 * Checkpoint 1 (plan §12 P1), UI side: sign-in rules, the user's apps only,
 * a live permission revoke and a forced sign-out across two windows of one
 * browser (two pages share IndexedDB and the BroadcastChannel bus, exactly
 * like two windows of the demo).
 */
test.describe("sign-in and access", () => {
  test("five wrong passwords lock a user, and the launcher shows the lock", async ({
    page,
  }) => {
    await page.goto("/login")
    await page.getByTestId("login-username").fill("shuvo")
    for (let attempt = 1; attempt <= 5; attempt++) {
      await page.getByTestId("login-password").fill(`wrong-${attempt}`)
      await page.getByTestId("login-submit").click()
      if (attempt < 5) {
        await expect(page.getByTestId("login-error")).toHaveAttribute(
          "data-reason",
          "bad-credentials"
        )
        await expect(page.getByTestId("login-error")).toContainText(
          `${5 - attempt} ${5 - attempt === 1 ? "attempt" : "attempts"} left`
        )
      }
    }
    await expect(page.getByTestId("login-error")).toHaveAttribute(
      "data-reason",
      "locked"
    )
    // The right password no longer opens a locked account.
    await page.getByTestId("login-password").fill("demo1234")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-error")).toHaveAttribute(
      "data-reason",
      "locked"
    )
    await expect(page).toHaveURL(/\/login/)

    await page.goto("/")
    await expect(page.getByTestId("launch-shuvo")).toHaveAttribute(
      "data-locked",
      "true"
    )
    await expect(page.getByTestId("launch-polash")).toHaveAttribute(
      "data-locked",
      "true"
    )
    await expect(page.getByTestId("launch-nayeem")).toHaveAttribute(
      "data-locked",
      "false"
    )
    // One click on a locked user lands on /login with the lockout message.
    await page.getByTestId("launch-polash").click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByTestId("login-error")).toHaveAttribute(
      "data-reason",
      "locked"
    )
  })

  test("a user changes their own password from the user menu", async ({
    page,
  }) => {
    await signIn(page, "sabbir")
    await page.getByTestId("user-menu").click()
    await page.getByTestId("change-password").click()
    await expect(page.getByTestId("change-password-dialog")).toBeVisible()
    await page.getByTestId("password-current").fill("wrong-one")
    await page.getByTestId("password-next").fill("newpass99")
    await page.getByTestId("password-confirm").fill("newpass99")
    await page.getByTestId("password-submit").click()
    await expect(page.getByTestId("password-error")).toContainText(
      "The current password is wrong"
    )
    await page.getByTestId("password-current").fill("demo1234")
    await page.getByTestId("password-confirm").fill("different99")
    await page.getByTestId("password-submit").click()
    await expect(page.getByTestId("password-error")).toContainText(
      "don't match"
    )
    await page.getByTestId("password-confirm").fill("newpass99")
    await page.getByTestId("password-submit").click()
    await expect(page.getByText("Password changed")).toBeVisible()
    await expect(page.getByTestId("change-password-dialog")).toBeHidden()

    // A plain sign-out shows no notice; the new password works.
    await page.getByTestId("user-menu").click()
    await page.getByTestId("sign-out").click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByTestId("signed-out-notice")).toHaveCount(0)
    await page.getByTestId("login-username").fill("sabbir")
    await page.getByTestId("login-password").fill("newpass99")
    await page.getByTestId("login-submit").click()
    await expect(page).toHaveURL(/\/si\/counter/)
  })

  test("after an administrator's reset the user must choose a new password before going on", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const admin = await context.newPage()
    const user = await context.newPage()
    await signIn(admin, "tahmid")
    const row = admin.locator(
      '[data-testid="user-row"][data-username="sabbir"]'
    )
    await expect(row).toBeVisible()
    await row.click()
    await admin.getByTestId("user-reset").click()
    await admin.getByTestId("confirm-ok").click()
    const temp = (
      (await admin.getByTestId("temp-password").textContent()) ?? ""
    ).trim()
    expect(temp).toMatch(/^[A-Z][a-z]{4}-\d{4}$/)
    await admin.getByTestId("temp-password-done").click()

    await user.goto("/login")
    await user.getByTestId("login-username").fill("sabbir")
    await user.getByTestId("login-password").fill(temp)
    await user.getByTestId("login-submit").click()
    await expect(user).toHaveURL(/\/si\/counter/)
    const dialog = user.getByTestId("change-password-dialog")
    await expect(dialog).toHaveAttribute("data-required", "true")
    // No way around it but sign out: Escape keeps it open, there is no cancel.
    await user.keyboard.press("Escape")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId("password-sign-out")).toBeVisible()
    await user.getByTestId("password-current").fill(temp)
    await user.getByTestId("password-next").fill("counter77")
    await user.getByTestId("password-confirm").fill("counter77")
    await user.getByTestId("password-submit").click()
    await expect(dialog).toBeHidden()
    await expect(user.getByTestId("counter")).toBeVisible()
    await context.close()
  })

  test("the demo password and the simulated MFA step sign the administrator in", async ({
    page,
  }) => {
    await page.goto("/login")
    await page.getByTestId("login-username").fill("tahmid")
    await page.getByTestId("login-password").fill("demo1234")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-mfa")).toBeVisible()
    await page.getByTestId("login-mfa").fill("000000")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-error")).toHaveAttribute(
      "data-reason",
      "mfa-failed"
    )
    await page.getByTestId("login-mfa").fill("123456")
    await page.getByTestId("login-submit").click()
    await expect(page).toHaveURL(/\/sac/)
    await expect(page.getByTestId("greeting-context")).toContainText(
      "System Administrator"
    )
  })

  test("/apps and the sidebar show only the signed-in user's apps", async ({
    page,
  }) => {
    await page.goto("/login")
    await page.getByTestId("login-username").fill("nayeem")
    await page.getByTestId("login-password").fill("demo1234")
    await page.getByTestId("login-submit").click()
    await expect(page).toHaveURL(/\/stl\/board/)
    await page.goto("/apps")
    await expect(page.getByTestId("apps-grid")).toBeVisible()
    // A service advisor opens PAR, STL, SI, PC, SD, PM, IC and IRT (plan §3.9).
    const open = ["par", "stl", "si", "pc", "sd", "pm", "ic", "irt"]
    const locked = [
      "fa",
      "ap",
      "ar",
      "cab",
      "frs",
      "ptl",
      "grn",
      "st",
      "sac",
      "rbac",
    ]
    for (const app of open) {
      await expect(page.getByTestId(`app-tile-${app}`)).not.toHaveAttribute(
        "data-locked",
        "true"
      )
      await expect(page.getByTestId(`nav-${app}`)).toBeVisible()
    }
    for (const app of locked) {
      await expect(page.getByTestId(`app-tile-${app}`)).toHaveAttribute(
        "data-locked",
        "true"
      )
      await expect(page.getByTestId(`nav-${app}`)).toHaveCount(0)
    }
    await page.goto("/fa")
    await expect(page.getByTestId("access-denied")).toContainText(
      "You don't have access to FA Core Accounting. An administrator can grant it in RBAC."
    )
  })
})

test.describe("live security across windows", () => {
  test("revoking an app's view permission hides it live in another window", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const admin = await context.newPage()
    const advisor = await context.newPage()
    await signIn(admin, "tahmid")
    await signIn(advisor, "nayeem")
    await advisor.goto("/par")
    await expect(advisor.getByTestId("nav-par")).toBeVisible()
    await expect(advisor.getByTestId("access-denied")).toHaveCount(0)

    await openDemoPanel(admin, "Data")
    const toggle = admin.getByTestId("dev-grant-toggle")
    // Defaults: the Service Advisor role and PAR.
    await expect(toggle).toHaveAttribute("data-granted", "true")
    await toggle.click()
    await expect(toggle).toHaveAttribute("data-granted", "false")

    // The other window loses PAR at once: the sidebar entry goes, the open screen is denied.
    await expect(advisor.getByTestId("nav-par")).toHaveCount(0)
    await expect(advisor.getByTestId("access-denied")).toContainText(
      "You don't have access to PAR"
    )
    await expect(
      advisor.getByText("An administrator changed your access")
    ).toBeVisible()

    // Granting it back restores it live.
    await toggle.click()
    await expect(toggle).toHaveAttribute("data-granted", "true")
    await expect(advisor.getByTestId("nav-par")).toBeVisible()
    await expect(advisor.getByTestId("access-denied")).toHaveCount(0)
    await context.close()
  })

  test("a test voucher posted in one window appears live in another", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const accountant = await context.newPage()
    const manager = await context.newPage()
    await signIn(accountant, "mahbub")
    await signIn(manager, "farzana")
    await manager.getByTestId("event-stream-trigger").click()
    await expect(manager.getByTestId("event-stream")).toBeVisible()

    await openDemoPanel(accountant, "Data")
    await accountant.getByTestId("dev-test-journal").click()
    const posted = accountant.getByText(/Posted JV-\d{4}-\d{6}/)
    await expect(posted).toBeVisible()
    const journalNo = (await posted.textContent())!
      .match(/JV[-\u2011]\d{4}[-\u2011]\d{6}/)![0]
      .replace(/\u2011/g, "-")

    await expect(
      // Document numbers in event text use non-breaking hyphens (U+2011) so they never wrap.
      manager.getByTestId("event-row").filter({
        hasText: new RegExp(
          `Voucher ${journalNo.replace(/-/g, "[-\u2011]")} posted`
        ),
      })
    ).toBeVisible()
    await context.close()
  })

  test("a forced sign-out returns the other window to /login with the notice", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const admin = await context.newPage()
    const advisor = await context.newPage()
    await signIn(admin, "tahmid")
    await signIn(advisor, "nayeem")

    await openDemoPanel(admin, "Data")
    const sessions = admin.getByTestId("dev-sessions")
    await expect(
      sessions.locator('[data-testid="dev-session"][data-username="tahmid"]')
    ).toContainText("This window")
    await sessions
      .locator('[data-testid="dev-force-signout"][data-username="nayeem"]')
      .click()
    await expect(
      sessions.locator('[data-testid="dev-session"][data-username="nayeem"]')
    ).toHaveCount(0)

    await expect(advisor).toHaveURL(/\/login/)
    await expect(advisor.getByTestId("signed-out-notice")).toHaveAttribute(
      "data-reason",
      "forced"
    )
    await expect(advisor.getByTestId("signed-out-notice")).toContainText(
      "You were signed out by an administrator."
    )
    await context.close()
  })
})
