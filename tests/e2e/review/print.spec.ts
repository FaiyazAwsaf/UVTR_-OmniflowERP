import { mkdirSync, writeFileSync } from "node:fs"

import { expect, test, type Page } from "@playwright/test"

import { rows } from "../stl/helpers"

/**
 * Print layouts on paper (plan §9 print list, open item from checkpoint 3):
 * each document's print preview sent through the browser's print path to a
 * PDF (Chromium's print renderer, print CSS, @page size), English and
 * Bangla, for review as page images (`pdftoppm`). PDFs stay in PRINT_DIR,
 * never in the repository. Runs only with PRINT_DIR:
 *   PRINT_DIR=/path/to/out bunx playwright test tests/e2e/review/print.spec.ts --workers 1
 */
const DIR = process.env.PRINT_DIR
test.skip(!DIR, "PRINT_DIR not set")
test.use({ actionTimeout: 10_000, navigationTimeout: 30_000 })

type Doc = {
  name: string
  user: string
  path: (ids: Record<string, string>) => string
  open?: string
}

const DOCS: Doc[] = [
  {
    name: "mushak-6-3-invoice",
    user: "tania",
    path: () => "/si/inv_e12",
    open: "mushak-print",
  },
  {
    name: "mushak-6-7-credit-note",
    user: "tania",
    path: (ids) => `/si/credit-notes?id=${ids.creditNote}`,
  },
  {
    name: "mushak-6-8-debit-note",
    user: "mahbub",
    path: () => "/ap/debit-notes",
    open: "debit-note-print",
  },
  {
    name: "mushak-6-5-transfer-challan",
    user: "habib",
    path: () => "/st/transfers/trf_in_transit",
    open: "challan-print",
  },
  {
    name: "mushak-6-6-vds-certificate",
    user: "mahbub",
    path: (ids) => `/ap/payments/${ids.vdsPayment}`,
    open: "certificate-print",
  },
  {
    name: "ait-certificate",
    user: "mahbub",
    path: (ids) => `/ap/payments/${ids.vdsPayment}`,
    open: "tds-print",
  },
  {
    name: "payment-voucher",
    user: "mahbub",
    path: (ids) => `/ap/payments/${ids.vdsPayment}`,
    open: "voucher-print",
  },
  {
    name: "quotation",
    user: "nayeem",
    path: (ids) => `/stl/quotations/${ids.quotation}`,
    open: "quote-print",
  },
  {
    name: "job-card",
    user: "shahriar",
    path: () => "/stl/orders/so_gul_d3_continuing",
    open: "job-card-print",
  },
  {
    name: "delivery-challan",
    user: "shahriar",
    path: (ids) => `/sd/deliveries?id=${ids.goodsDelivery}`,
  },
  {
    name: "gate-pass",
    user: "shahriar",
    path: (ids) => `/sd/deliveries?id=${ids.vehicleDelivery}`,
  },
  { name: "money-receipt", user: "mahbub", path: () => "/ar/receipts" },
  {
    name: "purchase-order",
    user: "nusrat",
    path: () => "/ptl/po/po_bengal_partial",
    open: "po-print",
  },
  {
    name: "grn",
    user: "habib",
    path: () => "/grn/grn_bengal_partial",
    open: "grn-print",
  },
  {
    name: "journal-voucher",
    user: "mahbub",
    path: (ids) => `/fa/journals/${ids.journal}`,
    open: "voucher-print",
  },
  {
    name: "customer-statement",
    user: "mahbub",
    path: () => "/ar/statements/pty_swift_ride",
    open: "statement-print",
  },
  {
    name: "barcode-labels",
    user: "habib",
    path: () => "/pm/items/itm_cc2_kit",
    open: "barcode-print",
  },
  {
    name: "trial-balance",
    user: "farzana",
    path: () => "/frs/trial-balance",
    open: "tb-print",
  },
  {
    name: "profit-loss",
    user: "farzana",
    path: () => "/frs/profit-loss",
    open: "pl-print",
  },
  {
    name: "balance-sheet",
    user: "farzana",
    path: () => "/frs/balance-sheet",
    open: "bs-print",
  },
  { name: "irt-report", user: "rashed", path: () => "/irt/run/IRT-01" },
]

async function ids(page: Page): Promise<Record<string, string>> {
  const creditNotes = await rows<{ id: string; status: string }>(
    page,
    "creditNotes"
  )
  const payments = await rows<{ id: string; vdsP?: number; status: string }>(
    page,
    "vendorPayments"
  )
  const quotations = await rows<{ id: string }>(page, "quotations")
  const deliveries = await rows<{ id: string; kind: string }>(
    page,
    "deliveries"
  )
  const journals = await rows<{
    id: string
    status: string
    source?: { docType?: string }
  }>(page, "journals")
  return {
    creditNote: creditNotes.find((c) => c.status === "posted")?.id ?? "",
    vdsPayment:
      payments.find((p) => (p.vdsP ?? 0) > 0 && p.status === "posted")?.id ??
      payments[0]?.id ??
      "",
    quotation: quotations[0]?.id ?? "",
    goodsDelivery: deliveries.find((d) => d.kind === "goods")?.id ?? "",
    vehicleDelivery: deliveries.find((d) => d.kind !== "goods")?.id ?? "",
    journal:
      journals.find(
        (j) => j.status === "posted" && j.source?.docType === "salesInvoices"
      )?.id ?? journals[0].id,
  }
}

for (const lang of ["en", "bn"] as const) {
  test(`print layouts ${lang}`, async ({ context }) => {
    test.setTimeout(900_000)
    mkdirSync(`${DIR}/${lang}`, { recursive: true })
    const windows = new Map<string, Page>()
    const log: string[] = []
    const as = async (user: string) => {
      let page = windows.get(user)
      if (!page) {
        page = await context.newPage()
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.goto(`/?user=${user}&lang=${lang}`)
        await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible({
          timeout: 90_000,
        })
        windows.set(user, page)
      }
      return page
    }
    const known = await ids(await as("mahbub"))
    for (const doc of DOCS) {
      const page = await as(doc.user)
      try {
        await page.goto(doc.path(known))
        await page.waitForTimeout(1_500)
        if (doc.name === "irt-report") {
          await page.getByTestId("report-run").click()
          await page.getByTestId("report-print").first().click()
        } else if (doc.name === "money-receipt") {
          await page.locator('[data-testid="receipt-row"]').first().click()
          await page.getByTestId("receipt-print").click()
        } else if (doc.open) {
          await page.getByTestId(doc.open).first().click()
        }
        await page.waitForTimeout(1_200)
        const sheets = await page.locator("[data-print-root]").count()
        await page.pdf({
          path: `${DIR}/${lang}/${doc.name}.pdf`,
          preferCSSPageSize: true,
          printBackground: true,
        })
        log.push(`${doc.name}: ok (${sheets} print root)`)
      } catch (error) {
        log.push(
          `${doc.name}: FAILED ${(error as Error).message.split("\n")[0]}`
        )
      }
      await page.keyboard.press("Escape")
    }
    writeFileSync(`${DIR}/${lang}.log`, log.join("\n"))
    console.log(log.join("\n"))
  })
}
