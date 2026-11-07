import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { decideApproval } from "@/core/approvals/decide"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { Actor } from "@/core/engine/types"
import { trialBalance } from "@/core/ledger/statements"
import { runScenario } from "@/core/scenarios/runner"
import { seedDatabase } from "@/core/seed"
import { CBA, ITM, VND } from "@/core/seed/content/seed-refs"
import { dhakaAt } from "@/core/seed/time"
import { recordBill, recordPayment } from "@/modules/ap/commands"
import { apScenarios } from "@/modules/ap/scenarios"
import { loadAging } from "@/modules/ar/queries"
import { receiveGoods } from "@/modules/grn/commands"
import { grnScenarios } from "@/modules/grn/scenarios"
import { parseDmy } from "@/lib/i18n/dmy"

import { gl, run, T } from "../ar/fin-helpers"
import { freshDb, signedIn } from "../helpers/foundation"

/**
 * WS-FIN launchers E5 and E6 on the small seed (plan §10): each runs twice in
 * a row, and after each run its key action works through the real commands
 * as the story's users, with the amounts the cue names.
 */
let db: OmniflowDb
let mahbub: Actor
let farzana: Actor
let habib: Actor
const today = dhakaDate(now())
const E5 = apScenarios.find((s) => s.id === "E5")!
const E6 = apScenarios.find((s) => s.id === "E6")!

beforeAll(async () => {
  db = await freshDb("ap-scenarios")
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
  mahbub = await signedIn(db, "mahbub")
  farzana = await signedIn(db, "farzana")
  habib = await signedIn(db, "habib")
}, 180_000)
afterAll(async () => {
  await db.delete()
})

async function ties() {
  const tb = trialBalance(await db.accounts.toArray(), await db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" })
  expect(tb.balanced).toBe(true)
  const ap = await loadAging(db, today, "ap")
  expect(ap.totals.total).toBe(ap.controlP)
}

/** E5's key action: Mahbub bills the GRN at the cue's prices; it holds; Farzana releases it. */
async function billAndRelease(params: Record<string, string | number>, grnId: string, key: string) {
  const lines = (await db.grnLines.where("grnId").equals(grnId).toArray()).filter((l) => l.qtyAccepted - l.qtyReturned - l.qtyBilled > 0)
  const ppvBefore = await gl(db, "PPV")
  const r = await run(
    db,
    recordBill,
    {
      kind: "goods",
      partyId: VND.glossGuard,
      vendorRef: String(params.vendorRef),
      hasMushak63: true,
      goodsLines: lines.map((l) => ({
        grnLineId: l.id,
        qty: l.qtyAccepted - l.qtyReturned - l.qtyBilled,
        unitPriceP: l.itemId === ITM.cc2Kit ? Number(params.invoicePriceP) : l.unitCostP,
      })),
      idempotencyKey: key,
    },
    mahbub
  )
  expect(r).toMatchObject({ status: "on-hold", matchStatus: "mismatch" })
  const bill = (await db.vendorBills.get(r.billId))!
  expect(bill.totalP).toBe(params.totalP)
  expect(bill.matchDiffs.some((d) => d.field === "price" && d.diffPct === params.pct)).toBe(true)
  const approval = (await db.approvals.get(r.approvalId!))!
  expect(approval.routedTo).toContain("usr_farzana")
  await run(db, decideApproval, { approvalId: approval.id, decision: "approve", reason: "Price agreed with the vendor", expectedVersion: approval.version }, farzana)
  const posted = (await db.vendorBills.get(bill.id))!
  expect(posted.status).toBe("posted")
  expect((await db.journals.get(posted.journalId!))?.rule).toBe("R13")
  expect((await gl(db, "PPV")) - ppvBefore).toBe(params.ppvP)
  return bill
}

describe("E5 three-way mismatch launcher", () => {
  it("runs twice in a row; each run bills a fresh Gloss & Guard receipt 6% over the PO, held and released by Farzana", async () => {
    const grns: string[] = []
    for (const key of ["e5-a", "e5-b"]) {
      const launch = await runScenario(E5, db)
      const grnId = launch.outcome.refs!.grnId!
      expect(grns).not.toContain(grnId)
      grns.push(grnId)
      expect(launch.route).toBe(`/ap/bills/new?vendor=${VND.glossGuard}&grn=${grnId}&ref=${encodeURIComponent(String(launch.outcome.params!.vendorRef))}`)
      const params = launch.outcome.params!
      expect(params).toMatchObject({ kitQty: 18, poPriceP: T(6_500), invoicePriceP: T(6_890), ppvP: T(7_020), pct: 6 })
      const grn = (await db.grns.get(grnId))!
      expect(grn.vendorId).toBe(VND.glossGuard)
      // E4's receipt: 18 kits accepted, 2 in quarantine for short expiry, 12 polish.
      const lines = await db.grnLines.where("grnId").equals(grnId).toArray()
      expect(lines.filter((l) => l.itemId === ITM.cc2Kit).reduce((s, l) => s + l.qtyRejected, 0)).toBe(2)
      expect((await db.purchaseOrders.get(grn.poId))?.status).toBe("partial")
      await billAndRelease(params, grnId, key)
      await ties()
    }
  }, 60_000)

  it("reuses an unbilled receipt from the previous run instead of receiving again", async () => {
    const first = await runScenario(E5, db)
    const second = await runScenario(E5, db)
    expect(second.outcome.refs!.grnId).toBe(first.outcome.refs!.grnId)
    expect(second.outcome.params!.vendorRef).toBe(first.outcome.params!.vendorRef)
    await billAndRelease(second.outcome.params!, second.outcome.refs!.grnId!, "e5-c")
    const third = await runScenario(E5, db)
    expect(third.outcome.refs!.grnId).not.toBe(first.outcome.refs!.grnId)
    await ties()
  }, 60_000)
})

describe("E4 then E5", () => {
  it("bills the receipt the presenter made in E4 instead of receiving again", async () => {
    const e4 = await runScenario(grnScenarios.find((x) => x.id === "E4")!, db)
    const poId = e4.outcome.refs!.poId!
    const p = e4.outcome.params!
    const po = (await db.purchaseOrders.get(poId))!
    const lines = await db.poLines.where("poId").equals(poId).toArray()
    const kits = lines.find((l) => l.itemId === ITM.cc2Kit)!
    const polish = lines.find((l) => l.itemId === ITM.polish)!
    // Habib performs E4 by hand: 20 kits (2 rejected for short expiry) and 12 polish.
    const grn = await run(
      db,
      receiveGoods,
      {
        poId,
        expectedVersion: po.version,
        lots: [
          { poLineId: kits.id, qtyAccepted: 18, qtyRejected: 2, rejectReason: "short-expiry", quarantine: true, batchNo: String(p.kitBatch), expiry: parseDmy(String(p.kitExpiry)) },
          { poLineId: polish.id, qtyAccepted: 12, quarantine: true, batchNo: String(p.polishBatch), expiry: parseDmy(String(p.polishExpiry)) },
        ],
        idempotencyKey: "e4-by-hand",
      },
      habib
    )
    const e5 = await runScenario(E5, db)
    expect(e5.outcome.refs!.grnId).toBe(grn.id)
    expect(e5.outcome.params).toMatchObject({ kitQty: 18, ppvP: T(7_020) })
    await billAndRelease(e5.outcome.params!, grn.id, "e5-after-e4")
    await ties()
  }, 60_000)
})

describe("E6 pay with withholding launcher", () => {
  it("runs twice in a row; each run's fresh Prime Guard bill is paid by cheque with AIT 6,000 and VDS 9,000, approved by Farzana", async () => {
    const bills: string[] = []
    for (const key of ["e6-a", "e6-b"]) {
      const launch = await runScenario(E6, db)
      const billId = launch.outcome.refs!.billId!
      expect(bills).not.toContain(billId)
      bills.push(billId)
      expect(launch.route).toBe(`/ap/payments/new?party=${VND.primeGuard}&bill=${billId}`)
      const params = launch.outcome.params!
      expect(params).toMatchObject({ netP: T(60_000), vatP: T(9_000), grossP: T(69_000), aitP: T(6_000), vdsP: T(9_000), payP: T(54_000) })
      const bill = (await db.vendorBills.get(billId))!
      expect(bill).toMatchObject({ status: "posted", partyId: VND.primeGuard, totalP: T(69_000) })
      const r = await run(
        db,
        recordPayment,
        { partyId: VND.primeGuard, method: "cheque", cashBankAccountId: CBA.BRAC, chequeNo: String(params.chequeNo), allocations: [{ billId, amountP: T(69_000) }], idempotencyKey: key },
        mahbub
      )
      expect(r.status).toBe("pending-approval")
      const approval = (await db.approvals.get(r.approvalId!))!
      expect(approval.routedTo).toContain("usr_farzana")
      await run(db, decideApproval, { approvalId: approval.id, decision: "approve", reason: "", expectedVersion: approval.version }, farzana)
      const paid = (await db.vendorPayments.get(r.paymentId))!
      expect(paid).toMatchObject({ status: "posted", aitP: T(6_000), vdsP: T(9_000), netPaidP: T(54_000) })
      expect(paid.vdsCertificateNo).toMatch(/^VDS-/)
      expect((await db.cheques.get(paid.chequeId!))?.chequeNo).toBe(params.chequeNo)
      expect((await db.journals.get(paid.journalId!))?.rule).toBe("R15")
      expect((await db.vendorBills.get(billId))?.status).toBe("paid")
      await ties()
    }
  }, 60_000)

  it("never offers a cheque number a payment still waiting for approval already holds", async () => {
    const first = await runScenario(E6, db)
    await run(
      db,
      recordPayment,
      { partyId: VND.primeGuard, method: "cheque", cashBankAccountId: CBA.BRAC, chequeNo: String(first.outcome.params!.chequeNo), allocations: [{ billId: first.outcome.refs!.billId!, amountP: T(69_000) }], idempotencyKey: "e6-c" },
      mahbub
    )
    const second = await runScenario(E6, db)
    expect(second.outcome.params!.chequeNo).not.toBe(first.outcome.params!.chequeNo)
    await ties()
  }, 60_000)
})
