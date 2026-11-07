import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test"

/**
 * WS-SDM e2e helpers: quick sign-in of a user in a page of a shared browser
 * context (one seeded database, many windows, like the 4-window layout),
 * picker selection by search, and drawing a signature.
 */

export const LANDING: Record<string, string> = {
  rashed: "/dashboard",
  farzana: "/home",
  shahriar: "/stl",
  arif: "/stl",
  nayeem: "/stl/board",
  shuvo: "/stl/board",
  tania: "/si/counter",
  sabbir: "/si/counter",
  rakib: "/stl/my-jobs",
}

/**
 * Quick sign-in (the launcher's one click). The first window seeds the
 * database ("Preparing demo data"), which takes longer while other browsers
 * share the machine; if the launcher shows the user signed in but has not
 * moved on after a while, open the landing route directly.
 */
export async function signIn(page: Page, username: string, lang?: "en" | "bn"): Promise<void> {
  const landing = LANDING[username] ?? "/home"
  await page.goto(`/?user=${username}${lang ? `&lang=${lang}` : ""}`)
  const reached = () => new URL(page.url()).pathname.startsWith(landing)
  for (let waited = 0; waited < 60_000 && !reached(); waited += 1_000) {
    await page.waitForTimeout(1_000)
    if (!reached() && waited >= 15_000 && (await page.locator(`a[href="${landing}"]`).count()) > 0) await page.goto(landing)
  }
  expect(reached(), `signed in as ${username} and on ${landing}`).toBe(true)
  await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible({ timeout: 30_000 })
}

/** A new window (page) in the same context, signed in as a user. */
export async function windowAs(context: BrowserContext, username: string, lang?: "en" | "bn"): Promise<Page> {
  const page = await context.newPage()
  await signIn(page, username, lang)
  return page
}

/** Open a SearchPicker by test id, type, and pick the first option (or the one with data-id). */
export async function pick(page: Page, testId: string, search: string, id?: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.getByTestId(`${testId}-search`).fill(search)
  const option = id ? page.locator(`[data-testid="${testId}-option"][data-id="${id}"]`) : page.getByTestId(`${testId}-option`).first()
  await expect(option).toBeVisible()
  await option.click()
}

/** Draw a short signature on the pad. */
export async function sign(page: Page): Promise<void> {
  const pad = page.getByTestId("signature-pad")
  await pad.scrollIntoViewIfNeeded()
  const box = await pad.boundingBox()
  if (!box) throw new Error("no signature pad")
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 5 })
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 5 })
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.35, { steps: 5 })
  await page.mouse.up()
}

/** Inline approval dialog: choose the approver, give a reason and the demo PIN. */
export async function approveInline(page: Page, approver: string, reason = "Approved for the demo"): Promise<void> {
  const dialog = page.getByTestId("inline-approval")
  await expect(dialog).toBeVisible()
  await dialog.locator(`[data-testid="approver-option"][data-user="${approver}"]`).click()
  await dialog.getByTestId("approval-reason").fill(reason)
  await dialog.getByTestId("approval-pin").fill("1234")
  await dialog.getByTestId("approval-submit").click()
  await expect(dialog).toBeHidden()
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

/**
 * Type into a money or quantity input: the shared inputs reformat on focus,
 * so select what is there and type over it (fill() can lose the selection).
 */
export async function typeInto(input: Locator, text: string): Promise<void> {
  await input.click()
  await input.press("ControlOrMeta+a")
  await input.pressSequentially(text)
  await input.press("Tab")
}

/** A retail item with at least `min` on the shelf at a location (its SKU). */
export async function retailSkuWithStock(page: Page, locationId: string, min: number): Promise<string> {
  const items = await rows<{ id: string; sku: string; kind: string; status: string }>(page, "items")
  const values = await rows<{ itemId: string; locationId: string; qtyBase: number }>(page, "stockValues")
  const ok = items.filter((i) => i.kind === "retail" && i.status === "active").find((i) => values.some((v) => v.itemId === i.id && v.locationId === locationId && v.qtyBase >= min))
  if (!ok) throw new Error("no retail item in stock")
  return ok.sku
}
