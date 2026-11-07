import { expect, type BrowserContext, type Page } from "@playwright/test"

/** Landing routes of the users these specs sign in (plan §8). */
const LANDING: Record<string, RegExp> = {
  mahbub: /\/fa/,
  farzana: /\/home/,
  rashed: /\/dashboard/,
  shamima: /\/frs/,
}

/** Quick sign-in (the launcher's one click), waiting for the shell on the landing route. */
export async function signIn(page: Page, username: string, extra = ""): Promise<void> {
  await page.goto(`/?user=${username}${extra}`)
  await expect(page).toHaveURL(LANDING[username] ?? /\/home/, { timeout: 30_000 })
  await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible({ timeout: 30_000 })
}

/** A second window of the same browser (same IndexedDB), signed in as another user. */
export async function secondWindow(context: BrowserContext, username: string, extra = ""): Promise<Page> {
  const page = await context.newPage()
  await signIn(page, username, extra)
  return page
}

/** Today in Dhaka (the demo clock starts at 10:30 today after a reset). */
export function dhakaToday(): string {
  return new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10)
}

/** The 10th of last month as ISO and as DD-MM-YYYY. */
export function lastMonthDay(): { iso: string; dmy: string; month: string } {
  const today = dhakaToday()
  const [y, m] = today.split("-").map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const month = `${py}-${String(pm).padStart(2, "0")}`
  return { iso: `${month}-10`, dmy: `10-${String(pm).padStart(2, "0")}-${py}`, month }
}

/** Picks an account in the n-th journal line by searching its code. */
export async function pickAccount(page: Page, line: number, code: string): Promise<void> {
  await page.getByTestId("journal-line-account").nth(line).click()
  await page.getByTestId("journal-line-account-search").fill(code)
  await page.getByTestId("journal-line-account-option").first().click()
}

/**
 * Fills the open journal editor: narration, optional date, and a two-line
 * voucher (debit one account, credit another) of `amount` taka.
 */
export async function fillVoucher(
  page: Page,
  opts: { narration: string; debit: string; credit: string; amount: string; date?: string }
): Promise<void> {
  await expect(page.getByTestId("journal-lines-editor")).toBeVisible()
  if (opts.date) {
    await page.getByTestId("journal-date").fill(opts.date)
  }
  await page.getByTestId("journal-narration").fill(opts.narration)
  await pickAccount(page, 0, opts.debit)
  await page.getByTestId("journal-line-debit").nth(0).fill(opts.amount)
  await pickAccount(page, 1, opts.credit)
  await page.getByTestId("journal-line-credit").nth(1).fill(opts.amount)
  await expect(page.getByTestId("journal-balance")).toHaveAttribute("data-balanced", "true")
}

/** Reads rows straight from the shared IndexedDB (assertions only). */
export async function rows<T = Record<string, unknown>>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("omniflow-central")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const out = await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction(name, "readonly").objectStore(name).getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return out
  }, table) as Promise<T[]>
}

/** One row of a table by id. */
export async function rowById<T = Record<string, unknown>>(page: Page, table: string, id: string): Promise<T> {
  const found = (await rows<T & { id: string }>(page, table)).find((r) => r.id === id)
  if (!found) throw new Error(`${table} ${id} not found`)
  return found
}

/** The newest recorded run of a launcher (its refs name what the setup created). */
export async function latestRun(page: Page, scenarioId: string): Promise<{ id: string; refs: Record<string, string> }> {
  const runs = await rows<{ id: string; scenarioId: string; at: number; refs: Record<string, string> }>(page, "scenarioRuns")
  const mine = runs.filter((r) => r.scenarioId === scenarioId).sort((a, b) => b.at - a.at)
  if (!mine.length) throw new Error(`no ${scenarioId} run`)
  return mine[0]
}

/** The user id this window is signed in as (its window session). */
export async function windowUser(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i)
      if (!k?.startsWith("of:session:")) continue
      const session = JSON.parse(window.sessionStorage.getItem(k) ?? "{}") as { userId?: string | null }
      if (session.userId) return session.userId
    }
    return null
  })
}
