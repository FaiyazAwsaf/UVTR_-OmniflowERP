import { expect, test } from "@playwright/test"

import { rows, sign, signIn } from "../stl/helpers"

/**
 * SD on the seeded data: pending deliveries (a ready vehicle at Gulshan),
 * the handover with checklist, signature and gate pass, and the delivery
 * history with its print.
 */

test("a ready vehicle is handed over with a signature and a gate pass", async ({ page }) => {
  await signIn(page, "shahriar")
  await page.goto("/sd")
  await expect(page.getByTestId("sd-pending")).toBeVisible()
  const ready = page.getByTestId("pending-handover").first()
  await expect(ready).toBeVisible()
  await ready.click()
  await expect(page.getByTestId("handover")).toBeVisible()
  await expect(page.getByTestId("handover-submit")).toBeDisabled()
  for (const key of ["exterior", "interior", "glass", "wheels", "belongings"]) await page.getByTestId(`handover-item-${key}`).click()
  await sign(page)
  await page.getByTestId("handover-submit").click()
  await expect(page.getByTestId("gate-pass")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("gate-pass-print")).toBeVisible()
  const deliveries = await rows<{ gatePassNo?: string; signatureSvg?: string }>(page, "deliveries")
  expect(deliveries.some((d) => d.gatePassNo?.startsWith("GP-GUL-") && (d.signatureSvg ?? "").startsWith("M"))).toBe(true)
  await page.goto("/sd/deliveries")
  await expect(page.getByTestId("delivery-row").first()).toBeVisible()
  await page.getByTestId("delivery-row").first().click()
  await expect(page.getByTestId("print-preview")).toBeVisible()
})
