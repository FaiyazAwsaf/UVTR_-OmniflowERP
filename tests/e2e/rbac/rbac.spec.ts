import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../shell/helpers"

/**
 * RBAC screens (plan §9) and E13 by hand: the permission matrix changes a
 * role and the advisor's other window follows at once; approval limits;
 * assignments with SoD; the conflicts report; the effective checker.
 */

function cell(page: Page, app: string, column: string) {
  return page.locator(`[data-testid="matrix-cell"][data-app="${app}"][data-column="${column}"]`)
}

test.describe("RBAC", () => {
  test("E13: the matrix revokes and restores live in the advisor's window; the discount limit goes to 0% and back", async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const admin = await context.newPage()
    const advisor = await context.newPage()
    await signIn(admin, "tahmid")
    await signIn(advisor, "nayeem")
    await advisor.goto("/irt")
    await expect(advisor.getByTestId("irt-catalogue")).toBeVisible()
    await expect(advisor.getByTestId("nav-irt")).toBeVisible()

    await admin.goto("/rbac")
    await admin.locator('[data-testid="role-row"][data-code="ADVISOR"]').click()
    await expect(admin.getByTestId("matrix")).toHaveAttribute("data-role", "ADVISOR")

    // PAR create holds customer (granted) and vendor (not): indeterminate. Revoke the customer key alone.
    await expect(cell(admin, "par", "create")).toHaveAttribute("data-state", "indeterminate")
    await cell(admin, "par", "create").getByTestId("matrix-keys").click()
    await admin.locator('[data-testid="matrix-key"][data-key="par.customer.create"]').click()
    await admin.keyboard.press("Escape")
    await expect(cell(admin, "par", "create")).toHaveAttribute("data-state", "unchecked")
    await expect(cell(admin, "par", "create")).toHaveAttribute("data-pending", "true")

    // IRT view: the advisor loses Reporting Tool live.
    await cell(admin, "irt", "view").getByTestId("matrix-check").click()
    await expect(admin.getByTestId("matrix-pending")).toHaveAttribute("data-count", "2")
    await admin.getByTestId("matrix-save").click()
    await expect(admin.getByTestId("matrix-pending")).toHaveCount(0)
    await expect(cell(admin, "par", "create")).toHaveAttribute("data-pending", "false")
    await expect(advisor.getByTestId("nav-irt")).toHaveCount(0)
    await expect(advisor.getByTestId("access-denied")).toBeVisible()

    // Restore both.
    await cell(admin, "irt", "view").getByTestId("matrix-check").click()
    await cell(admin, "par", "create").getByTestId("matrix-keys").click()
    await admin.locator('[data-testid="matrix-key"][data-key="par.customer.create"]').click()
    await admin.keyboard.press("Escape")
    await admin.getByTestId("matrix-save").click()
    await expect(cell(admin, "par", "create")).toHaveAttribute("data-state", "indeterminate")
    await expect(advisor.getByTestId("nav-irt")).toBeVisible()
    await expect(advisor.getByTestId("irt-catalogue")).toBeVisible()

    // The advisor discount limit to 0%, then back to 5%.
    await admin.goto("/rbac/limits")
    const limit = admin.locator('[data-testid="limit-cell"][data-role="ADVISOR"][data-kind="discount-pct"]')
    await expect(limit).toHaveAttribute("data-value", "5")
    await limit.getByTestId("limit-edit").click()
    await admin.getByTestId("limit-input").fill("0")
    await admin.getByTestId("limit-save").click()
    await expect(limit).toHaveAttribute("data-value", "0")
    await limit.getByTestId("limit-edit").click()
    await admin.getByTestId("limit-input").fill("5")
    await admin.getByTestId("limit-save").click()
    await expect(limit).toHaveAttribute("data-value", "5")
    await context.close()
  })

  test("the row scope toggle rescopes a role's grants; a role the admin holds is read-only", async ({ page }) => {
    await signIn(page, "tahmid")
    await page.goto("/rbac/roles/role_advisor")
    const scope = page.locator('[data-testid="matrix-scope"][data-app="stl"]')
    await expect(scope).toHaveAttribute("data-scope", "own-location")
    await scope.getByTestId("matrix-scope-all").click()
    await expect(scope).toHaveAttribute("data-scope", "all")
    await page.getByTestId("matrix-save").click()
    await expect(page.getByTestId("matrix-pending")).toHaveCount(0)
    await expect(scope).toHaveAttribute("data-scope", "all")
    await scope.getByTestId("matrix-scope-own").click()
    await page.getByTestId("matrix-save").click()
    await expect(scope).toHaveAttribute("data-scope", "own-location")

    await page.goto("/rbac/roles/role_sys_admin")
    await expect(page.getByTestId("matrix-readonly")).toBeVisible()
    await expect(page.getByTestId("matrix-save")).toHaveCount(0)
  })

  test("assignments: add and remove a role with the SoD warning; own row locked", async ({ page }) => {
    await signIn(page, "tahmid")
    await page.goto("/rbac/assignments")
    const nayeem = page.locator('[data-testid="assignment-row"][data-username="nayeem"]')
    await nayeem.getByTestId("assignment-add").click()
    await page.locator('[data-testid="assignment-role-option"][data-role="STUDIO_MGR"]').click()
    await expect(nayeem.locator('[data-testid="assignment-role"][data-role="STUDIO_MGR"]')).toBeVisible()
    await expect(page.getByText(/SoD conflict flagged/).first()).toBeVisible()
    await nayeem.locator('[data-testid="assignment-remove"][data-role="STUDIO_MGR"]').click()
    await expect(nayeem.locator('[data-testid="assignment-role"][data-role="STUDIO_MGR"]')).toHaveCount(0)

    const own = page.locator('[data-testid="assignment-row"][data-own="true"]')
    await expect(own).toHaveAttribute("data-username", "tahmid")
    await expect(own.getByTestId("assignment-add")).toHaveCount(0)
  })

  test("SoD rules and the conflicts report; the effective checker explains yes and no", async ({ page }) => {
    await signIn(page, "tahmid")
    await page.goto("/rbac/sod")
    await expect(page.getByTestId("sod-rule")).toHaveCount(6)
    await expect(page.locator('[data-testid="sod-rule"][data-code="SOD-04"]')).toHaveAttribute("data-mode", "block")
    await expect(page.locator('[data-testid="sod-conflict"][data-rule="SOD-01"][data-subject="ACC_MGR"]')).toBeVisible()
    await expect(page.locator('[data-testid="sod-conflict"][data-rule="SOD-05"][data-subject="STUDIO_MGR"]')).toBeVisible()

    await page.goto("/rbac/effective")
    await page.getByTestId("effective-user").click()
    await page.getByTestId("effective-user-search").fill("nayeem")
    await page.locator('[data-testid="effective-user-option"][data-id="usr_nayeem"]').click()
    await page.getByTestId("effective-key").click()
    await page.getByTestId("effective-key-search").fill("par.customer.create")
    await page.locator('[data-testid="effective-key-option"][data-id="par.customer.create"]').click()
    const result = page.getByTestId("effective-result")
    await expect(result).toHaveAttribute("data-allowed", "true")
    await expect(result.getByTestId("effective-source")).toHaveAttribute("data-role", "ADVISOR")

    await page.getByTestId("effective-key").click()
    await page.getByTestId("effective-key-search").fill("fa.journal.approve")
    await page.locator('[data-testid="effective-key-option"][data-id="fa.journal.approve"]').click()
    await expect(result).toHaveAttribute("data-allowed", "false")
    await expect(page.locator('[data-testid="effective-limit"][data-kind="discount-pct"]')).toContainText("5%")
  })
})
