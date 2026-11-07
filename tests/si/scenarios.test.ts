import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { defaultTaxSettings } from "@/config/rules.config"
import { invoiceOpen } from "@/core/ar/receipt"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import type { OmniflowDb } from "@/core/db/database"
import type { SalesInvoiceRow } from "@/core/db/schema"
import { runScenario } from "@/core/scenarios/runner"
import { CBA, LOC, PTY, SVC, USR } from "@/core/seed/content/seed-refs"
import { recordReceipt } from "@/modules/ar/commands"
import { allocateOldestFirst, deductionsFor } from "@/modules/ar/lib"
import { readPartyAdvance, readPartyExposure } from "@/modules/si/balances"
import { createCreditNote, issueConsolidatedInvoice } from "@/modules/si/commands"
import { E12_COMPLAINT, E2_FRESH_ORDERS, E2_RECEIPT_P, siScenarios } from "@/modules/si/scenarios"

import { actors, balance, booksTie, inventoryTies, journalsOf, key, refusal, run, seededDb } from "../stl/helpers"

/**
 * SI launchers on the small seed (plan §10): E2 and E12 run twice in a row
 * and after each run the presenter's key action works through the real
 * commands: Swift Ride's consolidated invoice is refused over the limit
 * (INV-10) until Farzana overrides inline, then Mahbub records a receipt
 * with VDS and AIT; the E12 credit note is refused at Tania's limit 0 and
 * posts R11 to customer advance with Shahriar's PIN. E2 also bills extra
 * work when receipts left the account within the limit. Books tie.
 */

let db: OmniflowDb
let as: ReturnType<typeof actors>
beforeAll(async () => {
  db = await seededDb("si-scn")
  as = actors(db)
}, 120_000)
afterAll(async () => {
  await db.delete()
})

const e2 = siScenarios.find((s) => s.id === "E2")!
const e12 = siScenarios.find((s) => s.id === "E12")!
const today = () => dhakaDate(now())

/** Mahbub's receipt from Swift Ride (bank transfer) with the deductions the form proposes. */
async function swiftReceipt(cashP: number, label: string) {
  const party = (await db.parties.get(PTY.swiftRide))!
  const invoices = (await db.salesInvoices.where("partyId").equals(party.id).toArray()).filter((i) => invoiceOpen(i) - i.reservedP > 0)
  const open = invoices.map((i) => ({ ...i, availableP: invoiceOpen(i) - i.reservedP }))
  const { allocations } = allocateOldestFirst(cashP, open, party, defaultTaxSettings)
  const d = deductionsFor(party, allocations, new Map<string, SalesInvoiceRow>(invoices.map((i) => [i.id, i])), defaultTaxSettings)
  const allocated = allocations.reduce((s, a) => s + a.amountP, 0)
  return run(db, await as("mahbub"), recordReceipt, {
    partyId: party.id,
    method: "bank-transfer",
    cashBankAccountId: CBA.BRAC,
    amountP: allocated - d.vdsP - d.aitP,
    allocations,
    vdsDeductedP: d.vdsP,
    aitDeductedP: d.aitP,
    certificateNo: `6.6/SRR/${label}`,
    idempotencyKey: key(`swift-${label}`),
  })
}

/** The consolidated invoice the presenter issues from the route's tab (last 30 days). */
async function presenterConsolidates(expected: Record<string, string | number>) {
  const shahriar = await as("shahriar")
  const input = { partyId: PTY.swiftRide, locationId: LOC.GUL, from: addDaysISO(today(), -30), to: today(), idempotencyKey: key("e2") }
  expect(await refusal(db, shahriar, issueConsolidatedInvoice, input)).toBe("CREDIT_OVERRIDE_REQUIRED")
  expect(await refusal(db, shahriar, issueConsolidatedInvoice, { ...input, inline: { approverId: USR.mahbub, pin: "1234", reason: "No" } })).toBe("NOT_APPROVER")
  const out = await run(db, shahriar, issueConsolidatedInvoice, { ...input, inline: { approverId: USR.farzana, pin: "1234", reason: "Fleet contract renewal" } })
  expect(out.orderCount).toBe(expected.count)
  const invoice = (await db.salesInvoices.get(out.invoiceId))!
  expect(invoice).toMatchObject({ kind: "consolidated", totalP: expected.invoiceP, locationId: LOC.GUL })
  expect(await db.approvals.get(invoice.creditOverrideApprovalId!)).toMatchObject({ kind: "credit-override", decidedBy: USR.farzana, inline: true })
  expect(await readPartyExposure(db, PTY.swiftRide)).toBe(expected.afterP)
  return invoice
}

describe("E2 fleet over credit limit", () => {
  it("run 1: 18 fresh delivered fleet jobs join the seeded ones; over the limit until Farzana overrides", async () => {
    const before = await readPartyExposure(db, PTY.swiftRide)
    expect(before).toBe(3_12_000_00)
    const started = performance.now()
    const launch = await runScenario(e2, db)
    console.info(`E2 setup ${Math.round(performance.now() - started)} ms`)
    expect(launch.route).toBe("/si/new?mode=consolidated&party=pty_swift_ride")
    expect(launch.companionRoute).toBe("/ar/receipts/new?party=pty_swift_ride")
    const p = launch.outcome.params!
    expect(p.outstandingP).toBe(3_12_000_00)
    expect(p.limitP).toBe(3_50_000_00)
    expect(p.count).toBeGreaterThanOrEqual(E2_FRESH_ORDERS + 18)
    expect(p.afterP).toBe((p.outstandingP as number) + (p.invoiceP as number))
    expect(p.overP).toBeGreaterThan(0)
    expect(p.receiptP).toBe(E2_RECEIPT_P)
    expect(launch.outcome.refs?.invoiceId).toBeUndefined()
    const fresh = (await db.salesOrders.where("partyId").equals(PTY.swiftRide).toArray()).filter((o) => o.status === "delivered" && o.bookedOn === today())
    expect(fresh).toHaveLength(E2_FRESH_ORDERS)
    expect(fresh.filter((o) => o.kind === "b2b")).toHaveLength(E2_FRESH_ORDERS)
    // Each was worked: tasks done, the recipe issued with R4, QC passed, handed over.
    const one = fresh[0]
    expect((await db.jobTasks.where("orderId").equals(one.id).toArray()).every((t) => t.status === "done")).toBe(true)
    expect((await journalsOf(db, one.id)).map((j) => j.rule)).toContain("R4")
    expect(await db.deliveries.where("orderId").equals(one.id).count()).toBe(1)
    await presenterConsolidates(p)
    const receipt = await swiftReceipt(E2_RECEIPT_P, "1")
    expect(receipt.status).toBe("posted")
  }, 120_000)

  it("run 2: only the new 18 orders are pending and still take it over the limit", async () => {
    const launch = await runScenario(e2, db)
    const p = launch.outcome.params!
    expect(p.count).toBe(E2_FRESH_ORDERS)
    expect(p.outstandingP).toBe(await readPartyExposure(db, PTY.swiftRide))
    expect(p.afterP).toBeGreaterThan(p.limitP as number)
    await presenterConsolidates(p)
  }, 120_000)

  it("run 3 after the account is paid down: extra fleet work is billed today so it goes over again", async () => {
    // Swift Ride pays everything it owes (net of its deductions).
    const exposure = await readPartyExposure(db, PTY.swiftRide)
    await swiftReceipt(exposure, "all")
    expect(await readPartyExposure(db, PTY.swiftRide)).toBeLessThan(10_000_00)
    const launch = await runScenario(e2, db)
    const p = launch.outcome.params!
    const extraId = launch.outcome.refs?.invoiceId
    expect(extraId).toBeTruthy()
    const extra = (await db.salesInvoices.get(extraId!))!
    expect(extra.date).toBe(today())
    const extraLines = await db.salesInvoiceLines.where("invoiceId").equals(extra.id).toArray()
    expect(extraLines.every((l) => l.serviceId === SVC.PRT_CC5)).toBe(true)
    expect(p.count).toBe(E2_FRESH_ORDERS)
    expect(p.afterP).toBeGreaterThan(p.limitP as number)
    await presenterConsolidates(p)
  }, 120_000)
})

describe("E12 credit note", () => {
  for (const runNo of [1, 2]) {
    it(`run ${runNo}: a fresh paid invoice with a complaint; the interior credit note needs Shahriar's PIN`, async () => {
      const launch = await runScenario(e12, db)
      const invoiceId = launch.outcome.refs?.invoiceId
      expect(launch.route).toBe(`/si/${invoiceId}`)
      const invoice = (await db.salesInvoices.get(invoiceId!))!
      expect(invoice).toMatchObject({ status: "paid", kind: "counter", locationId: LOC.GUL, date: today(), advanceAppliedP: 0, paidP: invoice.totalP })
      const order = (await db.salesOrders.get(invoice.orderIds[0]))!
      expect(order).toMatchObject({ status: "closed", complaintNote: E12_COMPLAINT })
      const lines = await db.salesInvoiceLines.where("invoiceId").equals(invoice.id).toArray()
      expect(lines.map((l) => l.serviceId).sort()).toEqual([SVC.INT_DEEP, SVC.WSH_PRM].sort())
      expect(lines.every((l) => l.vehicleClass === "SUV")).toBe(true)
      const interior = lines.find((l) => l.serviceId === SVC.INT_DEEP)!
      const p = launch.outcome.params!
      expect(p).toMatchObject({ invoiceNo: invoice.invoiceNo, totalP: invoice.totalP, creditP: interior.netP + interior.vatP, vatP: interior.vatP })

      const tania = await as("tania")
      const req = { invoiceId: invoice.id, lines: [{ invoiceLineId: interior.id }], reason: "Damp smell after the interior clean", idempotencyKey: key("cn") }
      expect(await refusal(db, tania, createCreditNote, req)).toBe("APPROVAL_LIMIT")
      const advanceBefore = await readPartyAdvance(db, invoice.partyId)
      const vatBefore = await balance(db, "VAT_OUTPUT", { locationId: LOC.GUL })
      const out = await run(db, tania, createCreditNote, { ...req, inline: { approverId: USR.shahriar, pin: "1234", reason: "Complaint upheld" } })
      expect(out.status).toBe("posted")
      const cn = (await db.creditNotes.get(out.creditNoteId))!
      expect(cn).toMatchObject({ totalP: p.creditP, toInvoiceP: 0, toAdvanceP: p.creditP })
      expect(await readPartyAdvance(db, invoice.partyId)).toBe(advanceBefore + (p.creditP as number))
      expect(await balance(db, "VAT_OUTPUT", { locationId: LOC.GUL })).toBe(vatBefore + (p.vatP as number))
      expect((await journalsOf(db, cn.id))[0]).toMatchObject({ rule: "R11" })
      expect(await db.approvals.get(cn.approvalId!)).toMatchObject({ kind: "credit-note", decidedBy: USR.shahriar, inline: true })
    }, 60_000)
  }
})

describe("books", () => {
  it("tie after every run, and Gulshan's inventory equals its stock value", async () => {
    const tie = await booksTie(db)
    expect(tie.unbalanced).toEqual([])
    expect(tie.debit).toBe(tie.credit)
    const inv = await inventoryTies(db, LOC.GUL)
    expect(inv.gl).toBe(inv.stock)
  })
})
