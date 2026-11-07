import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test"

/**
 * WS-Dash e2e helpers (copied from the SDM helpers, which are not ours):
 * quick sign-in of a user in a page of a shared browser context, reading
 * rows straight from IndexedDB for assertions, typing into money inputs.
 */

export const LANDING: Record<string, string> = {
  rashed: "/dashboard",
  farzana: "/home",
  mahbub: "/fa",
  shahriar: "/stl",
  arif: "/stl",
  nayeem: "/stl/board",
  shuvo: "/stl/board",
  tania: "/si/counter",
  sabbir: "/si/counter",
  rakib: "/stl/my-jobs",
  habib: "/ic",
  nusrat: "/ptl",
  tahmid: "/sac",
  shamima: "/frs",
}

/**
 * Quick sign-in (the launcher's one click). The first window seeds the demo
 * data, slower while other browsers share the machine; if the launcher has
 * not moved on after a while, open the landing route directly.
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

/** Type into a money input: select what is there and type over it. */
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

/** A tile's exact figure (`data-amount` in poisha), once loaded. */
export async function amountOf(page: Page, testId: string): Promise<number> {
  const tile = page.getByTestId(testId).first()
  await expect(tile).toHaveAttribute("data-amount", /^-?\d+$/)
  return Number(await tile.getAttribute("data-amount"))
}
