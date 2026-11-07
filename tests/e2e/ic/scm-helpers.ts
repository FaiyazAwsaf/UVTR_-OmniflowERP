import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test"

/**
 * E2E helpers for the SCM specs (PTL, PM, GRN, ST, IC). Every flow runs
 * through the UI on the seeded data; several users share one browser
 * context (one database), each in its own page (its own window session).
 */

const LANDING: Record<string, RegExp> = {
  habib: /\/ic/,
  nusrat: /\/ptl/,
  farzana: /\/home/,
  shahriar: /\/stl/,
  arif: /\/stl/,
  rashed: /\/dashboard/,
  mahbub: /\/fa/,
}

/** Quick sign-in in this page (the launcher's one click), optionally in Bangla. */
export async function signIn(page: Page, username: string, lang?: "bn" | "en"): Promise<void> {
  await page.goto(`/?user=${username}${lang ? `&lang=${lang}` : ""}`)
  await expect(page).toHaveURL(LANDING[username] ?? /\/home/, { timeout: 30_000 })
  await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible()
}

/** A second user in the same database: a new page of the same context. */
export async function asUser(context: BrowserContext, username: string): Promise<Page> {
  const page = await context.newPage()
  await signIn(page, username)
  return page
}

/** Pick an option from a SearchPicker (party, item) by typing a search. */
export async function pick(page: Page, trigger: Locator, search: string, testId: string): Promise<void> {
  await trigger.click()
  await page.getByTestId(`${testId}-search`).fill(search)
  await page.getByTestId(`${testId}-option`).first().click()
}

/** Choose an option of a Base UI select by its visible label. */
export async function choose(page: Page, trigger: Locator, label: string | RegExp): Promise<void> {
  await trigger.click()
  await page.getByRole("option", { name: label }).first().click()
}

/** Approve a pending approval from the inbox of the page's user. */
export async function approveInInbox(page: Page, docNo: string): Promise<void> {
  await page.goto("/approvals")
  const row = page.getByTestId("approval-row").filter({ hasText: docNo }).first()
  await expect(row).toBeVisible()
  await row.getByTestId("approval-approve").click()
  await page.getByTestId("approval-confirm").click()
  await expect(page.getByTestId("approval-row").filter({ hasText: docNo }).first()).toHaveAttribute("data-status", "approved")
}

/** Wait for a toast and the route of a document. */
export async function docNo(page: Page): Promise<string> {
  const no = page.getByTestId("doc-no").first()
  await expect(no).toBeVisible()
  return (await no.textContent())?.trim() ?? ""
}
