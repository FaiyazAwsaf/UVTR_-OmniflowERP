import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../shell/helpers"

/**
 * Screenshots of every CSC screen (IRT, SAC, RBAC) for review, EN and BN at
 * 960x600 and 1920x1200, plus a light-theme pass. Runs only with SHOTS_DIR:
 *   SHOTS_DIR=/tmp/shots E2E_PORT=3407 bunx playwright test tests/e2e/sac/screenshots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const

test.skip(!SHOTS, "SHOTS_DIR not set")

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

const ADMIN_SCREENS: [string, string, string][] = [
  ["sac-users", "/sac", "user-row"],
  ["sac-user", "/sac/users/usr_polash", "user-detail"],
  ["sac-sessions", "/sac/sessions", "session-row"],
  ["sac-logins", "/sac/login-history", "login-row"],
  ["sac-policy", "/sac/policy", "policy"],
  ["sac-audit", "/sac/audit", "audit-row"],
  ["rbac-roles", "/rbac", "role-row"],
  ["rbac-role", "/rbac/roles/role_advisor", "matrix"],
  ["rbac-assignments", "/rbac/assignments", "assignment-row"],
  ["rbac-limits", "/rbac/limits", "limit-cell"],
  ["rbac-sod", "/rbac/sod", "sod-conflict"],
  ["rbac-effective", "/rbac/effective?for=nayeem&key=stl.quote.create", "effective-roles"],
]
const OWNER_SCREENS: [string, string, string][] = [
  ["irt-catalogue", "/irt", "report-card"],
  ["irt-run", "/irt/run/IRT-31", "report-result"],
  ["irt-builder", "/irt/builder?from=IRT-32", "builder-preview"],
  ["irt-schedules", "/irt/schedules", "schedule-new"],
  ["irt-history", "/irt/history", "history-row"],
]

for (const lang of LANGS) {
  for (const size of SIZES) {
    const tag = `${lang}-${size.name}`

    test(`SAC and RBAC screens ${tag}`, async ({ page }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, "tahmid", `&lang=${lang}`)
      for (const [name, route, testId] of ADMIN_SCREENS) {
        await page.goto(route)
        await expect(page.getByTestId(testId).first()).toBeVisible()
        await shot(page, `${name}-${tag}`)
      }
      // The matrix with a cell's key list open, and the new-user form.
      await page.goto("/rbac/roles/role_advisor")
      await page.locator('[data-testid="matrix-cell"][data-app="par"][data-column="create"]').getByTestId("matrix-keys").click()
      await expect(page.getByTestId("matrix-popover")).toBeVisible()
      await shot(page, `rbac-matrix-popover-${tag}`)
      await page.keyboard.press("Escape")
      await page.goto("/sac")
      await page.getByTestId("user-new").click()
      await expect(page.getByTestId("user-form")).toBeVisible()
      await shot(page, `sac-user-form-${tag}`)
    })

    test(`IRT screens ${tag}`, async ({ page }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, "rashed", `&lang=${lang}`)
      // One run first so the history has a row.
      await page.goto("/irt/run/IRT-31")
      await expect(page.getByTestId("report-result")).toBeVisible()
      for (const [name, route, testId] of OWNER_SCREENS) {
        await page.goto(route)
        await expect(page.getByTestId(testId).first()).toBeVisible()
        await shot(page, `${name}-${tag}`)
      }
      await page.goto("/irt/run/IRT-31")
      await page.getByTestId("report-print-preview").click()
      await expect(page.getByTestId("report-print-sheet")).toBeVisible()
      await shot(page, `irt-print-${tag}`)
    })
  }
}

test("light theme pass (EN, 1920)", async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1920, height: 1200 })
  await signIn(page, "rashed")
  await page.locator('[data-slot="theme-toggle"]').click()
  for (const [name, route, testId] of [
    ["sac-users", "/sac", "user-row"],
    ["rbac-role", "/rbac/roles/role_advisor", "matrix"],
    ["irt-run", "/irt/run/IRT-31", "report-result"],
    ["irt-catalogue", "/irt", "report-card"],
  ] as const) {
    await page.goto(route)
    await expect(page.getByTestId(testId).first()).toBeVisible()
    await shot(page, `${name}-light`)
  }
})
