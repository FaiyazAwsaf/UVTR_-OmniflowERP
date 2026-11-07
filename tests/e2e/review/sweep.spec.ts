import { mkdirSync, writeFileSync } from "node:fs"

import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import { rows } from "../stl/helpers"

/**
 * P4.2 screen pass: every route (and the overlays and print previews a
 * presenter opens) at 960x600 and 1920x1200, English and Bangla, dark and
 * light. Each screen is saved as a PNG and checked in the page: no sideways
 * page scroll, nothing pushed off the right edge, no text cut without an
 * ellipsis, no raw i18n keys, NaN, undefined or em dashes, Latin text in
 * Bangla windows listed (outside identifiers and `lang="en"` data), low
 * contrast listed, no console or page errors. Runs only with SWEEP_DIR:
 *   SWEEP_DIR=/path/to/out bunx playwright test tests/e2e/review --workers 2
 * Writes <SWEEP_DIR>/<combo>/<screen>.png and <SWEEP_DIR>/<combo>.json.
 */
const DIR = process.env.SWEEP_DIR
test.skip(!DIR, "SWEEP_DIR not set")
// A control that is missing at one size must not hang the pass: record it and move on.
test.use({ actionTimeout: 10_000, navigationTimeout: 30_000 })

const SIZES = [
  { name: "960", width: 960, height: 600 },
  { name: "1920", width: 1920, height: 1200 },
] as const
const LANGS = ["en", "bn"] as const
const THEMES = ["dark", "light"] as const
const ONLY = process.env.SWEEP_ONLY?.split(",") // e.g. "bn-light-960,en-dark-1920"
const SCREEN_FILTER = process.env.SWEEP_SCREENS
  ? new RegExp(process.env.SWEEP_SCREENS)
  : null

type Ids = Record<string, string>
type Screen = {
  name: string
  user: string | null
  path: string | ((ids: Ids) => string)
  /** After the page is ready: open a dialog, drawer or print preview */
  open?: (page: Page) => Promise<void>
}

const click = (testId: string) => async (page: Page) => {
  await page.getByTestId(testId).first().click()
  await page.waitForTimeout(600)
}

/** Every route of plan §9, as the user who works on it. */
const SCREENS: Screen[] = [
  // Shell, launcher and cross-app screens
  { name: "launcher", user: null, path: "/" },
  { name: "login", user: null, path: "/login" },
  { name: "apps", user: "rashed", path: "/apps" },
  { name: "dashboard", user: "rashed", path: "/dashboard" },
  { name: "home-owner", user: "rashed", path: "/home" },
  { name: "home-accounts-manager", user: "farzana", path: "/home" },
  { name: "home-accountant", user: "mahbub", path: "/home" },
  { name: "home-studio-manager", user: "shahriar", path: "/home" },
  { name: "home-advisor", user: "nayeem", path: "/home" },
  { name: "home-cashier", user: "tania", path: "/home" },
  { name: "home-technician", user: "rakib", path: "/home" },
  { name: "home-store", user: "habib", path: "/home" },
  { name: "home-purchase", user: "nusrat", path: "/home" },
  { name: "home-admin", user: "tahmid", path: "/home" },
  { name: "approvals", user: "farzana", path: "/approvals" },
  {
    name: "overlay-bell",
    user: "farzana",
    path: "/home",
    open: click("approvals-bell"),
  },
  {
    name: "overlay-search",
    user: "farzana",
    path: "/home",
    open: async (page) => {
      await page.keyboard.press("Control+k")
      await page.waitForTimeout(600)
    },
  },
  {
    name: "overlay-events",
    user: "farzana",
    path: "/home",
    open: click("event-stream-trigger"),
  },
  {
    name: "overlay-demo-panel",
    user: "farzana",
    path: "/home",
    open: click("demo-panel-trigger"),
  },
  {
    name: "overlay-user-menu",
    user: "farzana",
    path: "/home",
    open: click("user-menu"),
  },
  // FMS: FA
  { name: "fa-home", user: "mahbub", path: "/fa" },
  { name: "fa-accounts", user: "mahbub", path: "/fa/accounts" },
  { name: "fa-journals", user: "mahbub", path: "/fa/journals" },
  { name: "fa-journal-new", user: "mahbub", path: "/fa/journals/new" },
  {
    name: "fa-journal-view",
    user: "mahbub",
    path: (ids) => `/fa/journals/${ids.journal}`,
  },
  {
    name: "fa-journal-print",
    user: "mahbub",
    path: (ids) => `/fa/journals/${ids.journal}`,
    open: click("voucher-print"),
  },
  { name: "fa-ledger", user: "mahbub", path: "/fa/ledger" },
  { name: "fa-periods", user: "farzana", path: "/fa/periods" },
  { name: "fa-recurring", user: "mahbub", path: "/fa/recurring" },
  { name: "fa-settings", user: "farzana", path: "/fa/settings" },
  // AP
  { name: "ap-home", user: "mahbub", path: "/ap" },
  { name: "ap-bills", user: "mahbub", path: "/ap/bills" },
  { name: "ap-bill-new", user: "mahbub", path: "/ap/bills/new" },
  {
    name: "ap-bill-view",
    user: "mahbub",
    path: (ids) => `/ap/bills/${ids.heldBill}`,
  },
  { name: "ap-payments", user: "mahbub", path: "/ap/payments" },
  { name: "ap-payment-new", user: "mahbub", path: "/ap/payments/new" },
  {
    name: "ap-payment-view",
    user: "mahbub",
    path: (ids) => `/ap/payments/${ids.apPayment}`,
  },
  { name: "ap-aging", user: "mahbub", path: "/ap/aging" },
  { name: "ap-debit-notes", user: "mahbub", path: "/ap/debit-notes" },
  // AR
  { name: "ar-home", user: "mahbub", path: "/ar" },
  { name: "ar-receipts", user: "mahbub", path: "/ar/receipts" },
  { name: "ar-receipt-new", user: "mahbub", path: "/ar/receipts/new" },
  { name: "ar-refunds", user: "mahbub", path: "/ar/refunds" },
  { name: "ar-aging", user: "mahbub", path: "/ar/aging" },
  { name: "ar-credit-control", user: "farzana", path: "/ar/credit-control" },
  {
    name: "ar-statement",
    user: "mahbub",
    path: "/ar/statements/pty_swift_ride",
  },
  {
    name: "ar-statement-print",
    user: "mahbub",
    path: "/ar/statements/pty_swift_ride",
    open: click("statement-print"),
  },
  // CAB
  { name: "cab-home", user: "mahbub", path: "/cab" },
  { name: "cab-account", user: "mahbub", path: "/cab/accounts/cba_brac" },
  { name: "cab-transfers", user: "mahbub", path: "/cab/transfers" },
  { name: "cab-cheques", user: "mahbub", path: "/cab/cheques" },
  { name: "cab-reconciliation", user: "mahbub", path: "/cab/reconciliation" },
  { name: "cab-petty-cash", user: "mahbub", path: "/cab/petty-cash" },
  { name: "cab-settlements", user: "mahbub", path: "/cab/settlements" },
  // PAR
  { name: "par-list", user: "farzana", path: "/par" },
  { name: "par-new", user: "farzana", path: "/par/new" },
  { name: "par-360-fleet", user: "farzana", path: "/par/pty_greenway" },
  { name: "par-360-retail", user: "farzana", path: "/par/pty_shahed_kabir" },
  { name: "par-vehicles", user: "farzana", path: "/par/vehicles" },
  // FRS
  { name: "frs-home", user: "farzana", path: "/frs" },
  { name: "frs-trial-balance", user: "farzana", path: "/frs/trial-balance" },
  { name: "frs-profit-loss", user: "farzana", path: "/frs/profit-loss" },
  { name: "frs-balance-sheet", user: "farzana", path: "/frs/balance-sheet" },
  { name: "frs-cash-flow", user: "farzana", path: "/frs/cash-flow" },
  { name: "frs-vat", user: "farzana", path: "/frs/vat" },
  { name: "frs-withholding", user: "farzana", path: "/frs/withholding" },
  // SDM: STL
  { name: "stl-home", user: "shahriar", path: "/stl" },
  { name: "stl-board", user: "nayeem", path: "/stl/board" },
  { name: "stl-quotations", user: "nayeem", path: "/stl/quotations" },
  { name: "stl-quotation-new", user: "nayeem", path: "/stl/quotations/new" },
  {
    name: "stl-quotation-view",
    user: "nayeem",
    path: (ids) => `/stl/quotations/${ids.quotation}`,
  },
  { name: "stl-orders", user: "nayeem", path: "/stl/orders" },
  { name: "stl-order-new", user: "nayeem", path: "/stl/orders/new" },
  {
    name: "stl-order-view",
    user: "shahriar",
    path: "/stl/orders/so_gul_d3_continuing",
  },
  { name: "stl-my-jobs", user: "rakib", path: "/stl/my-jobs" },
  // SI
  { name: "si-list", user: "tania", path: "/si" },
  { name: "si-counter", user: "tania", path: "/si/counter" },
  { name: "si-new", user: "shahriar", path: "/si/new" },
  { name: "si-invoice", user: "tania", path: "/si/inv_e12" },
  {
    name: "si-mushak-63",
    user: "tania",
    path: "/si/inv_e12",
    open: click("mushak-print"),
  },
  { name: "si-credit-notes", user: "tania", path: "/si/credit-notes" },
  // PC
  { name: "pc-catalogue", user: "rashed", path: "/pc" },
  { name: "pc-service", user: "rashed", path: "/pc/services/svc_prt_cc2" },
  { name: "pc-packages", user: "rashed", path: "/pc/packages" },
  { name: "pc-price-lists", user: "rashed", path: "/pc/price-lists" },
  { name: "pc-promotions", user: "rashed", path: "/pc/promotions" },
  // SD
  { name: "sd-pending", user: "shahriar", path: "/sd" },
  {
    name: "sd-handover",
    user: "shahriar",
    path: (ids) => `/sd/handover/${ids.readyOrder}`,
  },
  { name: "sd-deliveries", user: "shahriar", path: "/sd/deliveries" },
  // SCM: PTL
  { name: "ptl-home", user: "nusrat", path: "/ptl" },
  { name: "ptl-requisitions", user: "nusrat", path: "/ptl/requisitions" },
  {
    name: "ptl-requisition-view",
    user: "nusrat",
    path: (ids) => `/ptl/requisitions/${ids.requisition}`,
  },
  { name: "ptl-pos", user: "nusrat", path: "/ptl/po" },
  { name: "ptl-po-view", user: "nusrat", path: "/ptl/po/po_pending_nusrat" },
  {
    name: "ptl-po-print",
    user: "nusrat",
    path: "/ptl/po/po_bengal_partial",
    open: click("po-print"),
  },
  { name: "ptl-returns", user: "nusrat", path: "/ptl/returns" },
  // PM
  { name: "pm-items", user: "habib", path: "/pm" },
  { name: "pm-item", user: "habib", path: (ids) => `/pm/items/${ids.item}` },
  { name: "pm-categories", user: "habib", path: "/pm/categories" },
  { name: "pm-uom", user: "habib", path: "/pm/uom" },
  // GRN
  { name: "grn-home", user: "habib", path: "/grn" },
  {
    name: "grn-receive",
    user: "habib",
    path: "/grn/receive/po_bengal_partial",
  },
  { name: "grn-view", user: "habib", path: "/grn/grn_bengal_partial" },
  { name: "grn-quarantine", user: "habib", path: "/grn/quarantine" },
  // ST
  { name: "st-home", user: "habib", path: "/st" },
  { name: "st-transfers", user: "habib", path: "/st/transfers" },
  {
    name: "st-transfer-view",
    user: "habib",
    path: "/st/transfers/trf_in_transit",
  },
  { name: "st-adjustments", user: "habib", path: "/st/adjustments" },
  { name: "st-issues", user: "habib", path: "/st/issues" },
  // IC
  { name: "ic-stock", user: "habib", path: "/ic" },
  {
    name: "ic-stock-card",
    user: "habib",
    path: (ids) => `/ic/items/${ids.item}`,
  },
  { name: "ic-counts", user: "habib", path: "/ic/counts" },
  {
    name: "ic-count-view",
    user: "habib",
    path: (ids) => `/ic/counts/${ids.count}`,
  },
  { name: "ic-reorder", user: "habib", path: "/ic/reorder" },
  { name: "ic-expiry", user: "habib", path: "/ic/expiry" },
  { name: "ic-consumption", user: "habib", path: "/ic/consumption" },
  // CSC: IRT
  { name: "irt-catalogue", user: "rashed", path: "/irt" },
  { name: "irt-run", user: "rashed", path: "/irt/run/IRT-01" },
  { name: "irt-builder", user: "rashed", path: "/irt/builder" },
  { name: "irt-schedules", user: "rashed", path: "/irt/schedules" },
  { name: "irt-history", user: "rashed", path: "/irt/history" },
  // SAC
  { name: "sac-users", user: "tahmid", path: "/sac" },
  { name: "sac-user", user: "tahmid", path: "/sac/users/usr_nayeem" },
  { name: "sac-sessions", user: "tahmid", path: "/sac/sessions" },
  { name: "sac-login-history", user: "tahmid", path: "/sac/login-history" },
  { name: "sac-policy", user: "tahmid", path: "/sac/policy" },
  { name: "sac-audit", user: "tahmid", path: "/sac/audit" },
  // RBAC
  { name: "rbac-roles", user: "tahmid", path: "/rbac" },
  { name: "rbac-matrix", user: "tahmid", path: "/rbac/roles/role_advisor" },
  { name: "rbac-assignments", user: "tahmid", path: "/rbac/assignments" },
  { name: "rbac-limits", user: "tahmid", path: "/rbac/limits" },
  { name: "rbac-sod", user: "tahmid", path: "/rbac/sod" },
  { name: "rbac-effective", user: "tahmid", path: "/rbac/effective" },
  // Demo Wall (one pane per user)
  { name: "wall", user: null, path: "/wall?users=nayeem,rakib,tania,mahbub" },
]

/** Seeded documents for the dynamic routes, looked up once (ids differ only for generated history). */
async function lookupIds(page: Page): Promise<Ids> {
  const journals = await rows<{
    id: string
    status: string
    source?: { docType?: string }
    date: string
  }>(page, "journals")
  const posted = journals
    .filter(
      (j) => j.status === "posted" && j.source?.docType === "salesInvoices"
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const payments = await rows<{ id: string; status: string }>(
    page,
    "vendorPayments"
  )
  const quotations = await rows<{ id: string; status: string }>(
    page,
    "quotations"
  )
  const orders = await rows<{ id: string; status: string; locationId: string }>(
    page,
    "salesOrders"
  )
  const requisitions = await rows<{ id: string }>(page, "purchaseRequisitions")
  const counts = await rows<{ id: string }>(page, "stockCounts")
  return {
    journal: posted[0]?.id ?? journals[0].id,
    heldBill: "bl_held_dhaka_autochem",
    apPayment:
      payments.find((p) => p.status === "posted")?.id ?? payments[0]?.id ?? "",
    quotation:
      quotations.find((q) => q.status === "sent")?.id ??
      quotations[0]?.id ??
      "",
    readyOrder:
      orders.find((o) => o.status === "ready" && o.locationId === "loc_gul")
        ?.id ??
      orders.find((o) => o.status === "ready")?.id ??
      "so_gul_d3_continuing",
    requisition: requisitions[0]?.id ?? "",
    count: counts[0]?.id ?? "",
    item: "itm_cc2_kit",
  }
}

type Finding = { kind: string; detail: string }
type Report = {
  screen: string
  url: string
  findings: Finding[]
  truncated: string[]
  latin: string[]
  lowContrast: string[]
  errors: string[]
}

/** The in-page checks (see the file comment). */
async function inspect(
  page: Page,
  lang: string
): Promise<Omit<Report, "screen" | "url" | "errors">> {
  return page.evaluate((lang) => {
    const findings: { kind: string; detail: string }[] = []
    const truncated = new Set<string>()
    const latin = new Set<string>()
    const lowContrast = new Set<string>()
    const vw = window.innerWidth
    const se = document.scrollingElement!
    if (se.scrollWidth > se.clientWidth + 1)
      findings.push({
        kind: "page-hscroll",
        detail: `${se.scrollWidth - se.clientWidth}px`,
      })

    const label = (el: Element) => {
      const id = el.closest("[data-testid]")?.getAttribute("data-testid")
      return `${el.tagName.toLowerCase()}${id ? `@${id}` : ""}`
    }
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect()
      // Screen-reader-only labels are 1px boxes clipped on purpose.
      if (r.width <= 2 || r.height <= 2 || el.closest(".sr-only")) return false
      const cs = getComputedStyle(el)
      return (
        cs.visibility !== "hidden" &&
        cs.display !== "none" &&
        Number(cs.opacity) > 0.05
      )
    }
    /** An ancestor that clips or scrolls sideways (content past the edge is intended there). */
    const clipped = (el: Element) => {
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        const ox = getComputedStyle(p).overflowX
        if (ox !== "visible") return true
      }
      return false
    }
    const parse = (c: string) => {
      const m = c.match(/[\d.]+/g)
      return m ? m.map(Number) : [0, 0, 0, 0]
    }
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const background = (el: Element): number[] | null => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.backgroundImage && cs.backgroundImage !== "none") return null
        const c = parse(cs.backgroundColor)
        if (c.length < 4 || c[3] > 0.95) return c.slice(0, 3)
        if (c[3] > 0.05) return null
      }
      return [255, 255, 255]
    }
    const IDENT = /^[A-Z0-9]+([-/.][A-Z0-9]+)+$/
    const isLatinData = (el: Element, text: string) =>
      !!el.closest('[lang="en"], .font-mono, code, kbd, [data-print-root]') ||
      IDENT.test(text)

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    )
    const seen = new Set<Element>()
    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim()
      const el = node.parentElement
      if (!text || !el || el.closest("script, style, noscript, svg")) continue
      if (!shown(el)) continue
      const data = isLatinData(el, text)
      // Permission keys and command names shown as data are mono or lang="en"; anything else is a missing string.
      if (!data && /^[a-z][a-zA-Z]+(\.[a-zA-Z0-9_-]+){2,}$/.test(text))
        findings.push({ kind: "raw-key", detail: `${label(el)}: ${text}` })
      if (/\bNaN\b|\bundefined\b|Invalid Date|\[object Object\]/.test(text))
        findings.push({
          kind: "bad-value",
          detail: `${label(el)}: ${text.slice(0, 80)}`,
        })
      if (text.includes("—"))
        findings.push({
          kind: "em-dash",
          detail: `${label(el)}: ${text.slice(0, 80)}`,
        })
      if (lang === "bn" && /[A-Za-z]{2,}/.test(text) && !data)
        latin.add(text.slice(0, 100))
      if (seen.has(el)) continue
      seen.add(el)
      const cs = getComputedStyle(el)
      // Cut text: wider than its box, clipped, with no ellipsis.
      if (
        el.scrollWidth > el.clientWidth + 1 &&
        cs.overflowX !== "visible" &&
        cs.overflowX !== "auto" &&
        cs.overflowX !== "scroll"
      ) {
        if (cs.textOverflow === "ellipsis")
          truncated.add(`${label(el)}: ${text.slice(0, 60)}`)
        else
          findings.push({
            kind: "text-cut",
            detail: `${label(el)}: ${text.slice(0, 60)}`,
          })
      }
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 && r.left < vw && !clipped(el))
        findings.push({
          kind: "offscreen-right",
          detail: `${label(el)}: ${text.slice(0, 60)} (${Math.round(r.right - vw)}px)`,
        })
      const bg = background(el)
      if (bg) {
        const fg = parse(cs.color)
        const alpha = fg[3] ?? 1
        const mixed = fg
          .slice(0, 3)
          .map((v, i) => v * alpha + bg[i] * (1 - alpha))
        const [a, b] = [lum(mixed), lum(bg)].sort((x, y) => y - x)
        const ratio = (a + 0.05) / (b + 0.05)
        if (ratio < 3)
          lowContrast.add(
            `${ratio.toFixed(2)} ${label(el)}: ${text.slice(0, 40)}`
          )
      }
    }
    for (const img of Array.from(document.images)) {
      if (img.complete && img.naturalWidth === 0 && shown(img))
        findings.push({ kind: "broken-image", detail: img.src.slice(0, 80) })
    }
    return {
      findings,
      truncated: [...truncated],
      latin: [...latin],
      lowContrast: [...lowContrast],
    }
  }, lang)
}

/** Wait until the screen has data: no skeletons, then a short settle. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded")
  for (let i = 0; i < 40; i++) {
    const loading = await page.locator('[data-slot="skeleton"]:visible').count()
    if (!loading) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(500)
  // Animated figures roll for about a second after their data arrives.
  if (await page.locator('[data-slot="number-ticker"]').count()) await page.waitForTimeout(1_500)
}

async function windowFor(
  context: BrowserContext,
  user: string | null,
  lang: string,
  theme: string,
  size: { width: number; height: number }
): Promise<Page> {
  const page = await context.newPage()
  await page.setViewportSize(size)
  if (user) {
    await page.goto(`/?user=${user}&lang=${lang}&theme=${theme}`)
    await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible({
      timeout: 90_000,
    })
  } else {
    // A signed-out window: language and theme from the address only.
    await page.goto(`/?lang=${lang}&theme=${theme}`)
  }
  return page
}

for (const lang of LANGS) {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const combo = `${lang}-${theme}-${size.name}`
      if (ONLY && !ONLY.includes(combo)) continue
      test(`screen pass ${combo}`, async ({ context }) => {
        test.setTimeout(3_600_000)
        mkdirSync(`${DIR}/${combo}`, { recursive: true })
        const reports: Report[] = []
        const windows = new Map<string, Page>()
        const errors = new Map<Page, string[]>()
        const get = async (user: string | null) => {
          const key = user ?? "(signed out)"
          let page = windows.get(key)
          if (!page) {
            page = await windowFor(context, user, lang, theme, size)
            const list: string[] = []
            errors.set(page, list)
            page.on("console", (m) => {
              if (m.type() === "error") list.push(m.text().slice(0, 200))
            })
            page.on("pageerror", (e) =>
              list.push(`pageerror: ${e.message.slice(0, 200)}`)
            )
            windows.set(key, page)
          }
          return page
        }
        // The first window seeds the browser; then the documents behind dynamic routes.
        const ids = await lookupIds(await get("rashed"))
        for (const screen of SCREENS) {
          if (SCREEN_FILTER && !SCREEN_FILTER.test(screen.name)) continue
          const page = await get(screen.user)
          const path =
            typeof screen.path === "function" ? screen.path(ids) : screen.path
          const list = errors.get(page)!
          list.length = 0
          try {
            await page.goto(path)
            await settle(page)
            if (screen.open) {
              await screen.open(page)
              await settle(page)
            }
          } catch (error) {
            list.push(`navigation: ${(error as Error).message.split("\n")[0]}`)
          }
          await page.screenshot({ path: `${DIR}/${combo}/${screen.name}.png` })
          const found = await inspect(page, lang)
          reports.push({
            screen: screen.name,
            url: path,
            ...found,
            errors: [...list],
          })
          if (screen.open) await page.keyboard.press("Escape")
        }
        writeFileSync(`${DIR}/${combo}.json`, JSON.stringify(reports, null, 1))
        const bad = reports.filter((r) => r.findings.length || r.errors.length)
        console.log(
          `sweep ${combo}: ${reports.length} screens, ${bad.length} with findings`
        )
      })
    }
  }
}
