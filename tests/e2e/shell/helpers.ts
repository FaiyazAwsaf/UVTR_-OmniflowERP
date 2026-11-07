import { expect, type Page } from "@playwright/test"

/** Landing route per seeded user used in these specs (plan §8). */
export const LANDING: Record<string, RegExp> = {
  rashed: /\/dashboard/,
  farzana: /\/home/,
  mahbub: /\/fa/,
  shahriar: /\/stl/,
  nayeem: /\/stl\/board/,
  tania: /\/si\/counter/,
  sabbir: /\/si\/counter/,
  rakib: /\/stl\/my-jobs/,
  habib: /\/ic/,
  tahmid: /\/sac/,
  nusrat: /\/ptl/,
}

/** Quick sign-in (the launcher's one click) and wait for the shell on the landing route. */
export async function signIn(page: Page, username: string, extra = ""): Promise<void> {
  await page.goto(`/?user=${username}${extra}`)
  // The first window of a browser seeds the demo data; with other browsers
  // sharing the machine that can take well over the default 10 s.
  await expect(page).toHaveURL(LANDING[username] ?? /\/home/, { timeout: 30_000 })
  await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible({ timeout: 30_000 })
}

/** Open the demo panel on one of its tabs (Clock, Data, Scenarios), in English. */
export async function openDemoPanel(page: Page, tab: string): Promise<void> {
  if (!(await page.getByTestId("demo-panel").isVisible())) {
    await page.getByTestId("demo-panel-trigger").click()
  }
  await page.getByTestId("demo-panel").getByRole("tab", { name: tab }).click()
}

const BASE = { version: 1, createdAt: 0, updatedAt: 0, createdBy: "system", updatedBy: "system", origin: "central" }

/**
 * Test fixture: puts rows straight into the shared IndexedDB, for data no
 * command can create yet (Phase 1 has no module commands that raise
 * approvals, and parties arrive with the full seed). Live queries do not see
 * raw writes, so reload the page (or run a fresh query) afterwards.
 */
export async function plant(page: Page, table: string, rows: Record<string, unknown>[]): Promise<void> {
  const now = await page.evaluate(() => Date.now())
  const full = rows.map((row) => ({ ...BASE, createdAt: now, updatedAt: now, ...row }))
  await page.evaluate(
    async ({ table, rows }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("omniflow-central")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(table, "readwrite")
        for (const row of rows) tx.objectStore(table).put(row)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { table, rows: full }
  )
}

/** The demo clock's now (real time plus the shared offset in omniflow-control). */
export async function demoNow(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("omniflow-control")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const offset = await new Promise<number>((resolve) => {
      try {
        const get = db.transaction("clock", "readonly").objectStore("clock").get("clock")
        get.onsuccess = () => resolve((get.result as { offsetMs?: number } | undefined)?.offsetMs ?? 0)
        get.onerror = () => resolve(0)
      } catch {
        resolve(0)
      }
    })
    db.close()
    return Date.now() + offset
  })
}

/** A pending journal approval from Mahbub, routed to Farzana (within her limit). */
export async function plantJournalApproval(page: Page, id = "apr_e2e"): Promise<void> {
  const now = await demoNow(page)
  await plant(page, "approvals", [
    {
      id,
      kind: "journal",
      docType: "journals",
      docId: "jv_e2e",
      docNo: "JV-2627-000999",
      locationId: "loc_hq",
      amountP: 1_20_000_00,
      requestedBy: "usr_mahbub",
      requestedAt: now - 5 * 60_000,
      approveKey: "fa.journal.approve",
      status: "pending",
      reason: "Accrual for the month",
      inline: false,
      pinVerified: false,
      routedTo: ["usr_farzana", "usr_rashed"],
    },
  ])
}

/** A customer with a vehicle and two invoices (GUL and UTT), for the global search. */
export async function plantSearchData(page: Page): Promise<void> {
  await plant(page, "parties", [
    {
      id: "pty_e2e",
      code: "C-000999",
      isCustomer: true,
      isVendor: false,
      type: "individual",
      nameEn: "Test Customer",
      nameBn: "পরীক্ষা গ্রাহক",
      segment: "retail",
      phone: "01711-000999",
      addresses: [],
      contacts: [],
      creditLimitP: 0,
      paymentTermsDays: 0,
      deductsVds: false,
      deductsAit: false,
      status: "active",
      smsConsent: true,
      avatarSeed: "e2e",
    },
  ])
  await plant(page, "vehicles", [
    {
      id: "veh_e2e",
      partyId: "pty_e2e",
      regNo: "DHAKA METRO-GA 27-4419",
      regNoBn: "ঢাকা মেট্রো-গ ২৭-৪৪১৯",
      make: "Toyota",
      model: "Corolla Cross",
      year: 2022,
      colour: "White",
      vehicleClass: "SUV",
      active: true,
    },
  ])
  const invoice = (id: string, no: string, locationId: string) => ({
    id,
    invoiceNo: no,
    locationId,
    partyId: "pty_e2e",
    orderIds: [],
    date: "2026-11-01",
    dueDate: "2026-11-01",
    kind: "counter",
    status: "paid",
  })
  await plant(page, "salesInvoices", [
    invoice("inv_e2e_gul", "INV-GUL-2627-000123", "loc_gul"),
    invoice("inv_e2e_utt", "INV-UTT-2627-000456", "loc_utt"),
  ])
}

/** Reads rows straight from the shared IndexedDB (seeded fixed ids, numbers to search for). */
export async function readRows<T = Record<string, unknown>>(
  page: Page,
  table: string,
  filter?: { field: string; equals: string }
): Promise<T[]> {
  return page.evaluate(
    async ({ table, filter }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("omniflow-central")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(table, "readonly").objectStore(table).getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return filter ? rows.filter((r) => (r as Record<string, unknown>)[filter.field] === filter.equals) : rows
    },
    { table, filter }
  ) as Promise<T[]>
}
