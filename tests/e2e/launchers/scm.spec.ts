import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import { approveInInbox, asUser, choose, docNo, rows, signIn, windowSession } from "../ic/scm-helpers"
import { launchByUrl, launchFromPanel } from "./helpers"

/**
 * WS-SCM launchers (plan §10): E3 Stock-out for a job, E4 Partial GRN with
 * QC reject, E9 Stock count variance. Each launches twice in one browser
 * context (from the Demo panel, then by `?launch=`); each time the window is
 * the launcher's user on the right screen with the cue card, and the key
 * action works through the UI with the values the cue names.
 */

/** Companion windows the launchers open (Habib for E3, Shahriar for E9) are closed: the tests open their own. */
function closePopups(context: BrowserContext) {
  context.on("page", async (p) => {
    if (await p.opener()) await p.close().catch(() => undefined)
  })
}

type Cue = Record<string, string | number>

/** The window is the launcher's user, on its route, with its cue card at step 1; returns the cue's values. */
async function landed(page: Page, id: string, user: string, route: RegExp): Promise<Cue> {
  await expect(page).toHaveURL(route, { timeout: 30_000 })
  const card = page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute("data-step", "0")
  await expect.poll(async () => (await windowSession(page)).userId, { timeout: 30_000 }).toBe(`usr_${user}`)
  const session = await windowSession(page)
  expect(session.cue?.scenarioId).toBe(id)
  return session.cue?.params ?? {}
}

/** The cue card covers the bottom-left of a 960x600 window: close it once checked. */
async function closeCue(page: Page) {
  await page.getByRole("button", { name: "Close the cue card" }).click()
  await expect(page.getByTestId("cue-card")).toBeHidden()
}

test.describe("SCM launchers", () => {
  test("E3 twice: Arif on the fresh job; request from the stock check, Habib dispatches, Arif receives", async ({ page, context }) => {
    test.setTimeout(240_000)
    closePopups(context)
    await signIn(page, "habib")
    const habib = await asUser(context, "habib")

    const runOnce = async (how: "panel" | "url") => {
      if (how === "panel") await launchFromPanel(page, "E3")
      else await launchByUrl(page, "E3", "/st")
      const cue = await landed(page, "E3", "arif", /\/stl\/orders\/so_/)
      const orderId = new URL(page.url()).pathname.split("/").pop()!
      const [order] = (await rows<{ id: string; orderNo: string; status: string; locationId: string }>(page, "salesOrders")).filter((o) => o.id === orderId)
      expect(order.status).toBe("booked")
      expect(order.locationId).toBe("loc_utt")
      expect(cue).toMatchObject({ orderNo: order.orderNo, sku: "CH-CC2-50", needQty: 38, onHandQty: 20, shortQty: 18, transferQty: 50, afterQty: 70 })
      const card = page.getByTestId("cue-card")
      await expect(card).toContainText(order.orderNo)
      await expect(card).toContainText("needs 38 ml")
      await expect(card).toContainText("holds 20 ml")
      await expect(page.getByTestId("order-view")).toBeVisible()
      await closeCue(page)

      // Request the transfer from the order's stock check (STL's link), else open the same address.
      const request = page.getByTestId("order-request-transfer")
      if (await request.count()) await request.first().click()
      else await page.goto(`/st/transfers?new=1&from=loc_cst&to=loc_utt&item=itm_cc2_kit&qty=50&order=${order.orderNo}`)
      const dialog = page.getByTestId("transfer-dialog")
      await expect(dialog).toBeVisible()
      await expect(dialog.getByTestId("transfer-prefill-hint")).toContainText(order.orderNo)
      await expect(dialog.getByTestId("transfer-qty").first()).toHaveValue("50")
      await expect(dialog.getByTestId("transfer-note")).toHaveValue(new RegExp(order.orderNo))
      await dialog.getByTestId("transfer-submit").click()
      await expect(page.getByTestId("transfer-detail")).toBeVisible()
      const trfNo = await docNo(page)
      expect(trfNo).toMatch(/^TRF-\d{4}-\d{4}$/)

      // Habib finds the request for the order on Transfers and dispatches it with the 6.5 challan.
      await habib.goto("/st/transfers")
      await habib.locator("tr").filter({ has: habib.locator(`[data-transfer-no="${trfNo}"]`) }).filter({ hasText: order.orderNo }).click()
      await expect(habib.getByTestId("doc-no")).toHaveText(trfNo)
      await habib.getByTestId("transfer-dispatch").click()
      await habib.getByTestId("dispatch-submit").click()
      await expect(habib.getByTestId("transfer-detail").locator('[data-status="in-transit"]').first()).toBeVisible()

      // Arif's window shows it in transit live; he receives it: Uttara holds 70 ml.
      await page.getByTestId("transfer-receive").click()
      await page.getByTestId("receive-submit").click()
      await expect(page.getByTestId("transfer-detail").locator('[data-status="received"]').first()).toBeVisible()
      const [value] = (await rows<{ id: string; qtyBase: number }>(page, "stockValues")).filter((v) => v.id === "sv:itm_cc2_kit:loc_utt")
      expect(value.qtyBase).toBe(70)
      return orderId
    }

    const first = await runOnce("panel")
    const second = await runOnce("url")
    expect(second).not.toBe(first)
  })

  test("E4 twice: Habib on the fresh PO; 18 accepted, 2 quarantined, 12 polish", async ({ page }) => {
    test.setTimeout(240_000)
    closePopups(page.context())
    await signIn(page, "farzana")

    const runOnce = async (how: "panel" | "url") => {
      if (how === "panel") await launchFromPanel(page, "E4")
      else await launchByUrl(page, "E4", "/grn")
      const cue = await landed(page, "E4", "habib", /\/grn\/receive\/po_/)
      const poId = new URL(page.url()).pathname.split("/").pop()!
      const [po] = (await rows<{ id: string; poNo: string; status: string; totalP: number }>(page, "purchaseOrders")).filter((p) => p.id === poId)
      expect(po.status).toBe("issued")
      expect(cue).toMatchObject({ poNo: po.poNo, poTotalP: 226_320_00, grnValueP: 157_800_00 })
      await expect(page.getByTestId("cue-card")).toContainText(po.poNo)
      await expect(page.getByTestId("grn-receive-form")).toBeVisible()
      await closeCue(page)

      const kits = page.locator('[data-testid="grn-line"][data-sku="CH-CC2-50"]').first()
      await kits.getByTestId("grn-accept-qty").fill("18")
      await kits.getByTestId("grn-reject-qty").fill("2")
      await choose(page, kits.getByTestId("grn-reject-reason"), "Short expiry")
      await kits.getByTestId("grn-batch").fill(String(cue.kitBatch))
      await kits.getByTestId("grn-expiry").fill(String(cue.kitExpiry))
      await expect(page.locator('[data-testid="grn-progress"][data-sku="CH-CC2-50"]')).toHaveText("18 accepted · 6 pending")
      const polish = page.locator('[data-testid="grn-line"][data-sku="CH-POL-1L"]').first()
      await expect(polish.getByTestId("grn-accept-qty")).toHaveValue("12")
      await polish.getByTestId("grn-batch").fill(String(cue.polishBatch))
      await polish.getByTestId("grn-expiry").fill(String(cue.polishExpiry))
      await page.getByTestId("grn-submit").click()
      await expect(page.getByTestId("grn-view")).toBeVisible()
      expect(await docNo(page)).toMatch(/^GRN-CST-\d{4}-\d{4}$/)
      await expect(page.getByTestId("journal-link")).toBeVisible()
      await expect.poll(async () => (await rows<{ id: string; status: string }>(page, "purchaseOrders")).find((p) => p.id === poId)?.status).toBe("partial")
      return poId
    }

    const first = await runOnce("panel")
    const second = await runOnce("url")
    expect(second).not.toBe(first)
  })

  test("E9 twice: Habib on the fresh count; the cue's counts wait for Shahriar, whose approval posts them", async ({ page, context }) => {
    test.setTimeout(240_000)
    closePopups(context)
    await signIn(page, "shahriar")
    const shahriar = await asUser(context, "shahriar")

    const runOnce = async (how: "panel" | "url") => {
      if (how === "panel") await launchFromPanel(page, "E9")
      else await launchByUrl(page, "E9", "/ic/counts")
      const cue = await landed(page, "E9", "habib", /\/ic\/counts\/cnt_/)
      const countId = new URL(page.url()).pathname.split("/").pop()!
      const [count] = (await rows<{ id: string; countNo: string; status: string; locationId: string }>(page, "stockCounts")).filter((c) => c.id === countId)
      expect(count.status).toBe("open")
      expect(count.locationId).toBe("loc_gul")
      expect(cue.countNo).toBe(count.countNo)
      await expect(page.getByTestId("cue-card")).toContainText(count.countNo)
      await expect(page.getByTestId("count-detail")).toBeVisible()
      await closeCue(page)

      await page.getByTestId("count-fill").click()
      for (const i of [1, 2, 3]) {
        const line = page.locator(`[data-testid="count-line"][data-sku="${cue[`sku${i}`]}"][data-expected="${cue[`expected${i}`]}"]`).first()
        await line.getByTestId("count-qty").fill(String(cue[`counted${i}`]))
      }
      await expect(page.getByTestId("count-variance-total")).toHaveAttribute("data-total-p", String(cue.varianceP))
      await page.getByTestId("count-post").click()
      await expect(page.getByTestId("count-detail").locator('[data-status="pending-approval"]').first()).toBeVisible()

      await approveInInbox(shahriar, count.countNo)
      await expect(page.getByTestId("count-detail").locator('[data-status="posted"]').first()).toBeVisible()
      await expect(page.getByTestId("journal-link")).toBeVisible()
      return countId
    }

    const first = await runOnce("panel")
    const second = await runOnce("url")
    expect(second).not.toBe(first)
  })
})
