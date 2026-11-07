import { expect, test, type Page } from "@playwright/test"

import { pick, rows, windowAs } from "./helpers"

/**
 * Screenshots of every WS-SDM screen for review (plan §13.1 rule 8), EN and
 * BN at 960x600 and 1920x1200. Runs only with SHOTS_DIR set:
 *   SHOTS_DIR=/tmp/claude-1000/WS-SDM-shots E2E_PORT=3405 bunx playwright test tests/e2e/stl/screenshots.spec.ts
 */
const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const

test.skip(!SHOTS, "SHOTS_DIR not set")

async function shot(page: Page, name: string, tag: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${name}-${tag}.png` })
}

for (const lang of LANGS) {
  for (const size of SIZES) {
    const tag = `${lang}-${size.name}`
    test(`SDM screens ${tag}`, async ({ context }) => {
      test.setTimeout(300_000)
      const open = async (user: string) => {
        const page = await windowAs(context, user, lang)
        await page.setViewportSize({ width: size.width, height: size.height })
        return page
      }

      // STL
      const nayeem = await open("nayeem")
      await nayeem.goto("/stl/board")
      await expect(nayeem.getByTestId("job-card").first()).toBeVisible()
      await shot(nayeem, "stl-board", tag)
      await nayeem.goto("/stl/quotations")
      await expect(nayeem.getByTestId("quote-new")).toBeVisible()
      await shot(nayeem, "stl-quotations", tag)
      await nayeem.goto("/stl/quotations/new")
      await pick(nayeem, "quote-party", "Shahed", "pty_shahed_kabir")
      await pick(nayeem, "quote-vehicle", "7731", "veh_corolla_cross_7731")
      await pick(nayeem, "quote-add-service", "PRT-CC2", "svc_prt_cc2")
      await pick(nayeem, "quote-add-service", "INT-DEEP", "svc_int_deep")
      await shot(nayeem, "stl-quote-new", tag)
      await nayeem.getByTestId("quote-save").click()
      await expect(nayeem.getByTestId("quote-view")).toBeVisible()
      await shot(nayeem, "stl-quote-view", tag)
      await nayeem.getByTestId("quote-accept").click()
      await nayeem.getByTestId("deposit-toggle").click()
      await shot(nayeem, "stl-quote-accept", tag)
      await nayeem.keyboard.press("Escape")
      await nayeem.goto("/stl/orders")
      await expect(nayeem.getByTestId("order-row").first()).toBeVisible()
      await shot(nayeem, "stl-orders", tag)
      await nayeem.goto("/stl/orders/new")
      await expect(nayeem.getByTestId("order-editor")).toBeVisible()
      await shot(nayeem, "stl-order-new", tag)
      await nayeem.goto("/stl/orders/so_gul_d3_continuing")
      await expect(nayeem.getByTestId("order-view")).toBeVisible()
      await shot(nayeem, "stl-order-view", tag)
      await nayeem.goto("/stl/board")
      await nayeem.locator('[data-testid="board-column"][data-status="booked"] [data-testid="job-schedule"]').first().click()
      await expect(nayeem.getByTestId("schedule-dialog")).toBeVisible()
      await shot(nayeem, "stl-schedule", tag)
      await nayeem.close()

      const rakib = await open("rakib")
      await expect(rakib.getByTestId("my-jobs")).toBeVisible()
      await shot(rakib, "stl-my-jobs", tag)
      await rakib.close()

      // SD
      const shahriar = await open("shahriar")
      await shahriar.goto("/sd")
      await expect(shahriar.getByTestId("sd-pending")).toBeVisible()
      await shot(shahriar, "sd-pending", tag)
      const ready = (await rows<{ id: string; status: string; locationId: string }>(shahriar, "salesOrders")).find((o) => o.status === "ready" && o.locationId === "loc_gul")
      if (ready) {
        await shahriar.goto(`/sd/handover/${ready.id}`)
        await expect(shahriar.getByTestId("handover-checklist")).toBeVisible()
        await shot(shahriar, "sd-handover", tag)
      }
      const inQc = (await rows<{ id: string; status: string; locationId: string }>(shahriar, "salesOrders")).find((o) => o.status === "qc" && o.locationId === "loc_gul")
      if (inQc) {
        await shahriar.goto(`/sd/handover/${inQc.id}`)
        await expect(shahriar.getByTestId("qc-panel")).toBeVisible()
        await shot(shahriar, "sd-handover-qc", tag)
      }
      await shahriar.goto("/sd/deliveries")
      await expect(shahriar.getByTestId("delivery-row").first()).toBeVisible()
      await shot(shahriar, "sd-deliveries", tag)
      await shahriar.getByTestId("delivery-row").first().click()
      await expect(shahriar.getByTestId("gate-pass")).toBeVisible()
      await shot(shahriar, "sd-gate-pass", tag)
      await shahriar.keyboard.press("Escape")
      await shahriar.goto("/si/new?mode=consolidated&party=pty_swift_ride")
      await expect(shahriar.getByTestId("credit-panel")).toBeVisible()
      await shot(shahriar, "si-new-consolidated", tag)
      await shahriar.close()

      // SI
      const tania = await open("tania")
      await expect(tania.getByTestId("counter")).toBeVisible()
      await tania.getByTestId("counter-item").click()
      await tania.getByTestId("counter-item-search").fill("RT-KIT")
      await tania.getByTestId("counter-item-option").first().click()
      await tania.getByTestId("counter-item-add").click()
      await tania.getByTestId("tender-card").click()
      await shot(tania, "si-counter", tag)
      await tania.goto("/si")
      await expect(tania.getByTestId("invoice-row").first()).toBeVisible()
      await shot(tania, "si-invoices", tag)
      await tania.goto("/si/inv_e12")
      await expect(tania.getByTestId("invoice-view")).toBeVisible()
      await shot(tania, "si-invoice-view", tag)
      await tania.getByTestId("mushak-print").click()
      await expect(tania.getByTestId("mushak-63")).toBeVisible()
      await shot(tania, "si-mushak-63", tag)
      await tania.keyboard.press("Escape")
      await tania.getByTestId("credit-note-new").click()
      await expect(tania.getByTestId("credit-note-dialog")).toBeVisible()
      await tania.getByTestId("credit-note-line-check").last().click()
      await shot(tania, "si-credit-note", tag)
      await tania.keyboard.press("Escape")
      await tania.goto("/si/credit-notes")
      await expect(tania.getByTestId("credit-notes")).toBeVisible()
      await shot(tania, "si-credit-notes", tag)
      await tania.close()

      // PC
      const farzana = await open("farzana")
      await farzana.goto("/pc")
      await expect(farzana.getByTestId("price-matrix")).toBeVisible()
      await shot(farzana, "pc-catalogue", tag)
      await farzana.goto("/pc/services/svc_prt_cc2")
      await expect(farzana.getByTestId("recipe-row").first()).toBeVisible()
      await shot(farzana, "pc-service", tag)
      await farzana.goto("/pc/packages")
      await expect(farzana.getByTestId("pc-packages")).toBeVisible()
      await shot(farzana, "pc-packages", tag)
      await farzana.goto("/pc/price-lists")
      await expect(farzana.getByTestId("price-list-row").first()).toBeVisible()
      await shot(farzana, "pc-price-lists", tag)
      await farzana.goto("/pc/promotions")
      await expect(farzana.getByTestId("promotion-card").first()).toBeVisible()
      await shot(farzana, "pc-promotions", tag)
      await farzana.close()
    })
  }
}
