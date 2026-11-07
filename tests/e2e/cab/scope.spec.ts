import { expect, test } from "@playwright/test"

import { signIn } from "../shell/helpers"

/** CAB lists follow the CAB view scope: a Gulshan cashier sees Gulshan's till and petty cash only. */
test("Tania (cashier, Gulshan) sees only Gulshan's till and petty cash; Mahbub sees every account", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const tania = await context.newPage()
  await signIn(tania, "tania")
  await tania.goto("/cab")
  await expect(tania.getByTestId("cash-position")).toBeVisible()
  const rows = tania.getByTestId("position-row")
  await expect(rows).toHaveCount(2)
  await expect(tania.locator('[data-testid="position-row"][data-account="TILL-GUL"]')).toBeVisible()
  await expect(tania.locator('[data-testid="position-row"][data-account="PETTY-GUL"]')).toBeVisible()
  await tania.goto("/cab/petty-cash")
  await expect(tania.getByTestId("petty-box")).toHaveCount(1)
  await expect(tania.locator('[data-testid="petty-box"][data-account="PETTY-GUL"]')).toBeVisible()
  await tania.goto("/cab/accounts/cba_brac")
  await expect(tania.getByTestId("account-book")).toHaveCount(0)

  const mahbub = await context.newPage()
  await signIn(mahbub, "mahbub")
  await mahbub.goto("/cab")
  await expect(mahbub.locator('[data-testid="position-row"][data-account="BANK-BRAC"]')).toBeVisible()
  expect(await mahbub.getByTestId("position-row").count()).toBeGreaterThan(5)
  await context.close()
})
