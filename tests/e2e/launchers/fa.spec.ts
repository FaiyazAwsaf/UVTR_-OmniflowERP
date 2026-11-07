import { expect, test, type Page } from "@playwright/test"

import { fillVoucher, latestRun, rowById, secondWindow, signIn, windowUser } from "../fa/helpers"
import { launchByUrl, launchFromPanel } from "./helpers"

/**
 * The FA launchers (plan §10 E10, E11), each launched twice in one browser
 * context (from the Demo panel, then by `?launch=`): the window's user, its
 * route and cue card, then the presenter's key action through the UI.
 */

type Journal = { id: string; journalNo: string; status: string; date: string }
type Approval = { id: string; docId: string; docNo: string }
type Period = { id: string; code: string; month: string; status: string }
type Petty = { id: string; voucherNo: string }

/** Approve a document from this window's approvals inbox. */
async function approveFromInbox(page: Page, docNo: string): Promise<void> {
  await page.goto("/approvals")
  const row = page.locator('[data-testid="approval-row"][data-status="pending"]').filter({
    has: page.getByTestId("approval-doc").filter({ hasText: docNo }),
  })
  await row.getByTestId("approval-approve").click()
  await page.getByTestId("approval-confirm").click()
  await expect(page.getByTestId("approval-dialog")).toBeHidden()
  await expect(row).toHaveCount(0)
}

const cue = (page: Page, id: string) => page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)

/** Close the cue card once checked: in a 960x600 window it can cover page buttons. */
async function closeCue(page: Page, id: string): Promise<void> {
  await cue(page, id).getByRole("button", { name: "Close the cue card" }).click()
  await expect(cue(page, id)).toHaveCount(0)
}

test("E10 twice: Mahbub's accrual waits for Farzana; her own voucher waits for Rashed", async ({ page, context }) => {
  test.setTimeout(120_000)
  await signIn(page, "mahbub")
  const farzana = await secondWindow(context, "farzana")
  const rashed = await secondWindow(context, "rashed")
  const seen = new Set<string>()

  for (const how of ["panel", "url"] as const) {
    if (how === "panel") await launchFromPanel(page, "E10")
    else await launchByUrl(page, "E10", "/fa")

    // Mahbub's window on his fresh draft, with the cue card.
    const run = await latestRun(page, "E10")
    expect(seen.has(run.id)).toBe(false)
    seen.add(run.id)
    const draft = await rowById<Journal>(page, "journals", run.refs.journalId)
    const bigApproval = await rowById<Approval>(page, "approvals", run.refs.approvalId)
    await expect(page).toHaveURL(new RegExp(`/fa/journals/${draft.id}$`))
    expect(await windowUser(page)).toBe("usr_mahbub")
    await expect(cue(page, "E10")).toHaveAttribute("data-step", "0")
    await expect(cue(page, "E10")).toContainText(draft.journalNo)
    await expect(page.getByTestId("journal-editor")).toContainText(draft.journalNo)
    await closeCue(page, "E10")

    // Submit: above his limit it waits, and he has no approve action.
    await page.getByTestId("journal-submit").click()
    await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-status", "pending-approval")
    await expect(page.getByTestId("voucher-approve-hint")).toBeVisible()
    await expect(page.getByTestId("voucher-approve")).toHaveCount(0)

    // Farzana approves it from her inbox; Mahbub's window shows it posted, live.
    await approveFromInbox(farzana, draft.journalNo)
    await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-status", "posted")
    await expect(page.getByTestId("voucher-view")).toBeVisible()

    // Her own ৳12,00,000 voucher: "You prepared this", no approve button.
    await farzana.goto(`/fa/journals/${bigApproval.docId}`)
    await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-journal-no", bigApproval.docNo)
    await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-status", "pending-approval")
    await expect(farzana.getByTestId("voucher-approve-hint")).toBeVisible()
    await expect(farzana.getByTestId("voucher-approve")).toHaveCount(0)

    // Rashed approves it; Farzana's page shows it posted.
    await approveFromInbox(rashed, bigApproval.docNo)
    await expect(farzana.getByTestId("voucher-page")).toHaveAttribute("data-status", "posted")
  }
})

test("E11 twice: the close is blocked, the blockers are cleared, the month closes and refuses a posting", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, "farzana")
  const seen = new Set<string>()

  for (const how of ["panel", "url"] as const) {
    if (how === "panel") await launchFromPanel(page, "E11")
    else await launchByUrl(page, "E11", "/fa")

    const run = await latestRun(page, "E11")
    expect(seen.has(run.id)).toBe(false)
    seen.add(run.id)
    const period = await rowById<Period>(page, "periods", run.refs.periodId)
    const draft = await rowById<Journal>(page, "journals", run.refs.journalId)
    const petty = await rowById<Petty>(page, "pettyCashVouchers", run.refs.pettyCashVoucherId)
    await expect(page).toHaveURL(new RegExp(`/fa/periods\\?id=${period.id}$`))
    expect(await windowUser(page)).toBe("usr_farzana")
    await expect(cue(page, "E11")).toHaveAttribute("data-step", "0")
    await expect(cue(page, "E11")).toContainText(draft.journalNo)
    await expect(cue(page, "E11")).toContainText(petty.voucherNo)
    await closeCue(page, "E11")

    // Last month is open (the second run reopened it) and blocked by exactly the two items.
    const monthRow = page.locator(`[data-testid="period-row"][data-month="${period.month}"]`)
    await expect(monthRow).toHaveAttribute("data-status", "open")
    const checklist = page.getByTestId("close-checklist")
    await expect(checklist).toHaveAttribute("data-period", period.code)
    await expect(checklist).toHaveAttribute("data-allowed", "false")
    await expect(checklist.getByTestId("close-check-item")).toHaveCount(2)
    await expect(checklist.locator('[data-testid="close-check"][data-key="journals"]')).toContainText(draft.journalNo)
    await expect(checklist.locator('[data-testid="close-check"][data-key="approvals"]')).toContainText(petty.voucherNo)

    // Close: refused by the engine (INV-13).
    await page.getByTestId("period-close").click()
    await page.getByTestId("period-close-confirm").click()
    await expect(page.getByRole("dialog").filter({ hasText: /can't close yet/ })).toBeVisible()
    await page.keyboard.press("Escape")

    // Discard the draft from the checklist link.
    await checklist.getByTestId("close-check-item").filter({ hasText: draft.journalNo }).locator("a").click()
    await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-journal-no", draft.journalNo)
    await page.getByTestId("journal-discard").click()
    await page.getByTestId("journal-discard-confirm").click()
    await expect(page.getByTestId("voucher-page")).toHaveAttribute("data-status", "discarded")

    // Approve the petty cash; the checklist is clear; close.
    await approveFromInbox(page, petty.voucherNo)
    await page.goto(`/fa/periods?id=${period.id}`)
    await expect(page.getByTestId("close-checklist")).toHaveAttribute("data-allowed", "true")
    await page.getByTestId("period-close").click()
    await page.getByTestId("period-close-confirm").click()
    await expect(monthRow).toHaveAttribute("data-status", "closed")

    // A new voucher dated last month is refused (PERIOD_CLOSED).
    const [y, m, d] = draft.date.split("-")
    await page.goto("/fa/journals/new")
    await fillVoucher(page, { narration: "Late accrual", debit: "6400", credit: "2175", amount: "500", date: `${d}-${m}-${y}` })
    await page.getByTestId("journal-save").click()
    await expect(page.getByRole("dialog").filter({ hasText: /is closed/ })).toBeVisible()
    await page.keyboard.press("Escape")
  }
})
