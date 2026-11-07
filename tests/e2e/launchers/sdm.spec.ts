import { expect, test, type Page } from "@playwright/test"

import { approveInline, rows, signIn } from "../stl/helpers"
import { launchByUrl, launchFromPanel } from "./helpers"

/**
 * WS-SDM launchers (plan §10): E1, E2 and E12, each launched twice in the
 * same browser (once from the Demo panel, once by `?launch=`). Each time the
 * window is the scenario's user on the screen the cue describes, and the
 * presenter's key action goes through the UI. With SHOTS_DIR set, the
 * landing screens with their cue cards are saved in EN and BN at 960x600
 * and 1920x1200.
 */

const LAUNCHES = [
  { via: "panel", n: 1 },
  { via: "url", n: 2 },
] as const

/**
 * The user this window is signed in as: its own session in sessionStorage,
 * keyed by window.name (a pop-up starts with a copy of its opener's keys).
 */
async function windowUser(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem(`of:session:${window.name}`)
    return raw ? ((JSON.parse(raw) as { userId?: string }).userId ?? null) : null
  })
}

async function launch(page: Page, id: string, via: "panel" | "url", from: string) {
  const started = Date.now()
  if (via === "panel") await launchFromPanel(page, id)
  else await launchByUrl(page, id, from)
  console.log(`${id} via ${via}: cue card after ${Date.now() - started} ms`)
}

const cueOf = (page: Page, id: string) => page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)

/** Close the cue card once it has been checked (at 960x600 it can cover page buttons). */
async function closeCue(page: Page) {
  await page.getByRole("button", { name: "Close the cue card" }).click()
}

test("E1: twice, Shuvo asks 12% on a fresh quotation and Arif approves with the PIN", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, "shuvo")
  const seen = new Set<string>()
  for (const { via } of LAUNCHES) {
    await launch(page, "E1", via, "/stl/board")
    await expect(page).toHaveURL(/\/stl\/quotations\/qt_[^/?]+$/)
    expect(await windowUser(page)).toBe("usr_shuvo")
    await expect(page.getByTestId("quote-view")).toBeVisible()
    const quoteNo = (await page.getByTestId("doc-no").textContent())?.trim() ?? ""
    expect(quoteNo).toMatch(/^QT-UTT-/)
    expect(seen.has(quoteNo)).toBe(false)
    seen.add(quoteNo)
    const cue = cueOf(page, "E1")
    await expect(cue).toHaveAttribute("data-step", "0")
    await expect(cue).toContainText(quoteNo)
    await expect(cue).toContainText("Allion")
    await expect(page.getByTestId("quote-discount-pct")).toHaveText("0%")
    await closeCue(page)

    await page.getByTestId("quote-discount-open").click()
    const dialog = page.getByTestId("quote-discount-dialog")
    await dialog.getByTestId("quote-discount-edit").fill("12")
    await expect(dialog).toContainText("an approver confirms with a PIN")
    // ৳20,000 less 12% is ৳17,600; with 15% VAT the total is ৳20,240.
    await expect(dialog.getByTestId("quote-discount-preview")).toContainText("2,400")
    await expect(dialog).toContainText("20,240")
    await dialog.getByTestId("quote-discount-apply").click()
    await approveInline(page, "arif", "Loyal customer, second car")
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId("quote-discount-pct")).toHaveText("12%")
    await expect(page.getByTestId("approval-chip").first()).toBeVisible()
    const quotes = await rows<{ quoteNo: string; discountPct: number; discountP: number; totalP: number; discountApprovalId?: string }>(page, "quotations")
    const saved = quotes.find((q) => q.quoteNo === quoteNo)
    expect(saved).toMatchObject({ discountPct: 12, discountP: 2_400_00, totalP: 20_240_00 })
    const approvals = await rows<{ id: string; decidedBy: string; inline: boolean }>(page, "approvals")
    expect(approvals.find((a) => a.id === saved?.discountApprovalId)).toMatchObject({ decidedBy: "usr_arif", inline: true })
  }
})

test("E2: twice, the consolidated invoice is blocked over the limit until Farzana overrides; Mahbub takes a receipt", async ({ page, context }) => {
  test.setTimeout(240_000)
  await signIn(page, "shahriar")
  const popup = page.waitForEvent("popup", { timeout: 90_000 }).catch(() => null)
  for (const { via } of LAUNCHES) {
    await launch(page, "E2", via, "/stl")
    await expect(page).toHaveURL(/\/si\/new\?mode=consolidated&party=pty_swift_ride$/)
    expect(await windowUser(page)).toBe("usr_shahriar")
    const cue = cueOf(page, "E2")
    await expect(cue).toHaveAttribute("data-step", "0")
    const count = Number((await cue.textContent())?.match(/(\d+) delivered/)?.[1])
    expect(count).toBeGreaterThanOrEqual(18)
    await expect(page.getByTestId("invoice-order")).toHaveCount(count)
    await expect(page.getByTestId("credit-panel")).toHaveAttribute("data-needs-override", "true")
    await closeCue(page)

    await page.getByTestId("credit-override").click()
    await approveInline(page, "farzana", "Fleet contract renewal this week")
    await expect(page.getByTestId("credit-override-granted")).toBeVisible()
    await page.getByTestId("consolidated-issue").click()
    await expect(page.getByTestId("invoice-view")).toBeVisible()
    await expect(page.getByTestId("doc-no")).toContainText("INV-GUL-")
    const invoiceId = new URL(page.url()).pathname.split("/").pop()
    const invoices = await rows<{ id: string; kind: string; orderIds: string[]; creditOverrideApprovalId?: string }>(page, "salesInvoices")
    const issued = invoices.find((i) => i.id === invoiceId)
    expect(issued).toMatchObject({ kind: "consolidated" })
    expect(issued?.orderIds).toHaveLength(count)
    expect(issued?.creditOverrideApprovalId).toBeTruthy()
  }

  // The companion window opened on Mahbub's receipt screen (or open one).
  let mahbub = await popup
  if (!mahbub) {
    mahbub = await context.newPage()
    await signIn(mahbub, "mahbub")
    await mahbub.goto("/ar/receipts/new?party=pty_swift_ride")
  }
  await expect(mahbub.getByTestId("receipt-form")).toBeVisible({ timeout: 60_000 })
  expect(await windowUser(mahbub)).toBe("usr_mahbub")
  await mahbub.getByTestId("receipt-method").locator('[data-value="bank-transfer"]').click()
  await expect(mahbub.getByTestId("receipt-allocation").getByTestId("alloc-row").first()).toBeVisible()
  await mahbub.getByTestId("receipt-amount").click()
  await mahbub.getByTestId("receipt-amount").fill("100000")
  await mahbub.getByTestId("receipt-amount").blur()
  await expect(mahbub.getByTestId("receipt-vds")).not.toHaveValue("0.00")
  await expect(mahbub.getByTestId("receipt-ait")).not.toHaveValue("0.00")
  await mahbub.getByTestId("receipt-certificate").fill("6.6/SRR/0117")
  await mahbub.getByTestId("receipt-save").click()
  await expect(mahbub).toHaveURL(/\/ar\/receipts\?id=/)
  await expect(mahbub.getByTestId("receipt-detail")).toContainText("6.6/SRR/0117")
})

test("E12: twice, Tania's partial credit note is approved inline by Shahriar and kept as advance", async ({ page }) => {
  test.setTimeout(150_000)
  await signIn(page, "tania")
  const seen = new Set<string>()
  for (const { via } of LAUNCHES) {
    await launch(page, "E12", via, "/si")
    await expect(page).toHaveURL(/\/si\/inv_[^/?]+$/)
    expect(await windowUser(page)).toBe("usr_tania")
    await expect(page.getByTestId("invoice-view")).toBeVisible()
    const invoiceNo = (await page.getByTestId("doc-no").textContent())?.trim() ?? ""
    expect(invoiceNo).toMatch(/^INV-GUL-/)
    expect(seen.has(invoiceNo)).toBe(false)
    seen.add(invoiceNo)
    const cue = cueOf(page, "E12")
    await expect(cue).toHaveAttribute("data-step", "0")
    await expect(cue).toContainText(invoiceNo)
    await expect(page.getByTestId("invoice-complaint")).toContainText("damp smell")
    await closeCue(page)

    await page.getByTestId("credit-note-new").click()
    const dialog = page.getByTestId("credit-note-dialog")
    await dialog.getByTestId("credit-note-line").filter({ hasText: /Interior deep/ }).getByTestId("credit-note-line-check").click()
    await dialog.getByTestId("credit-note-reason").fill("Damp smell in the rear carpet after the interior clean")
    // SUV interior deep clean on the retail list: ৳6,500 + 15% VAT, all kept as advance.
    await expect(dialog.getByTestId("credit-note-total")).toContainText("৳7,475")
    await expect(dialog.getByTestId("credit-note-vat")).toContainText("৳975")
    await dialog.getByTestId("credit-note-submit").click()
    await approveInline(page, "shahriar", "Complaint upheld")
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId("linked-docs")).toContainText("CRN-")
    const invoiceId = new URL(page.url()).pathname.split("/").pop()
    const notes = await rows<{ invoiceId: string; status: string; toAdvanceP: number; totalP: number }>(page, "creditNotes")
    const note = notes.find((n) => n.invoiceId === invoiceId)
    expect(note).toMatchObject({ status: "posted" })
    expect(note?.toAdvanceP).toBe(note?.totalP)
  }
})

/* ------------------------------------------------------------------ *
 * Landing screens with their cue cards, for review (SHOTS_DIR only)
 * ------------------------------------------------------------------ */

const SHOTS = process.env.SHOTS_DIR
const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const

for (const lang of ["en", "bn"] as const) {
  for (const size of SIZES) {
    test(`SDM launcher screens ${lang}-${size.name}`, async ({ page }) => {
      test.skip(!SHOTS, "SHOTS_DIR not set")
      test.setTimeout(240_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      for (const [id, user, from] of [
        ["E1", "shuvo", "/stl/board"],
        ["E2", "shahriar", "/stl"],
        ["E12", "tania", "/si"],
      ] as const) {
        await signIn(page, user, lang)
        await launchByUrl(page, id, from)
        await page.waitForTimeout(800)
        await page.screenshot({ path: `${SHOTS}/launcher-${id}-${lang}-${size.name}.png` })
        if (id === "E1") {
          await page.getByTestId("quote-discount-open").click()
          await page.getByTestId("quote-discount-edit").fill("12")
          await page.waitForTimeout(300)
          await page.screenshot({ path: `${SHOTS}/launcher-E1-dialog-${lang}-${size.name}.png` })
          await page.keyboard.press("Escape")
        }
        if (id === "E2" && size.name === "960") {
          await page.getByTestId("credit-panel").scrollIntoViewIfNeeded()
          await page.screenshot({ path: `${SHOTS}/launcher-E2-credit-${lang}-${size.name}.png` })
        }
      }
    })
  }
}
