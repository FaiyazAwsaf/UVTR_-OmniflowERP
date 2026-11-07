import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysISO } from "@/core/clock/dates"
import { stockBalanceId } from "@/core/db/tables"
import { ITM, LOC, VND } from "@/core/seed/content/seed-refs"
import { acceptQuarantine, receiveGoods, returnRejected } from "@/modules/grn/commands"
import { issuePo } from "@/modules/ptl/commands"

import { decide, expectBalanced, expectStockTies, journalByTag, refused, run, scmDb, type ScmDb } from "../ic/scm"

/**
 * GRN (plan §6.2, accounting_rules R12): E4 by hand. A fresh PO to Gloss &
 * Guard for 24 ceramic 2-year kits and 12 finishing polish; receive 20 kits
 * (2 rejected, short expiry, into quarantine) and 12 polish: "18 accepted ·
 * 6 pending"; quarantine accept (R12) and return (nothing posts).
 */

let s: ScmDb
let poId: string
let grnId: string

beforeAll(async () => {
  s = await scmDb("grn")
  const out = await run(
    s,
    issuePo,
    {
      locationId: LOC.CST,
      orders: [
        {
          vendorId: VND.glossGuard,
          expectedDate: addDaysISO(s.today, 3),
          lines: [
            { itemId: ITM.cc2Kit, qty: 24, unitCostP: 6_500_00 },
            { itemId: ITM.polish, qty: 12, unitCostP: 3_400_00 },
          ],
        },
      ],
      idempotencyKey: "e4-po",
    },
    "nusrat"
  )
  poId = out.pos[0].id
  // ৳2,26,320 is above Nusrat's ৳1,00,000: Farzana approves it.
  expect(out.pos[0].status).toBe("pending-approval")
  const po = await s.db.purchaseOrders.get(poId)
  await decide(s, po!.approvalId!, "farzana")
}, 120_000)

afterAll(async () => {
  await s.db.delete()
})

const lots = (kitsAccepted: number, kitsRejected: number, polish: number, lines: { id: string; itemId: string }[], today: string) => [
  {
    poLineId: lines.find((l) => l.itemId === ITM.cc2Kit)!.id,
    qtyAccepted: kitsAccepted,
    qtyRejected: kitsRejected,
    rejectReason: kitsRejected ? ("short-expiry" as const) : undefined,
    quarantine: true,
    batchNo: "E4-CC2-01",
    expiry: addDaysISO(today, 500),
  },
  ...(polish
    ? [{ poLineId: lines.find((l) => l.itemId === ITM.polish)!.id, qtyAccepted: polish, qtyRejected: 0, quarantine: true, batchNo: "E4-POL-01", expiry: addDaysISO(today, 700) }]
    : []),
]

describe("grn.receive (E4)", () => {
  it("the approved PO is issued", async () => {
    const po = await s.db.purchaseOrders.get(poId)
    expect(po?.status).toBe("issued")
    expect(po?.totalP).toBe(226_320_00)
  })

  it("is refused for a cashier and outside a studio manager's own location", async () => {
    const po = (await s.db.purchaseOrders.get(poId))!
    const lines = await s.db.poLines.where("poId").equals(poId).toArray()
    const input = { poId, expectedVersion: po.version, lots: lots(1, 0, 0, lines, s.today), idempotencyKey: "x1" }
    await refused(s, receiveGoods, input, "tania", "DENIED")
    await refused(s, receiveGoods, input, "arif", "OUT_OF_SCOPE")
  })

  it("receives 18 accepted and 2 quarantined kits and 12 polish with R12 at PO cost", async () => {
    const po = (await s.db.purchaseOrders.get(poId))!
    const lines = await s.db.poLines.where("poId").equals(poId).toArray()
    const before = (await s.db.stockValues.get(`sv:${ITM.cc2Kit}:${LOC.CST}`)) ?? { qtyBase: 0, valueP: 0 }
    const out = await run(s, receiveGoods, { poId, expectedVersion: po.version, vendorChallanNo: "GG-7781", lots: lots(18, 2, 12, lines, s.today), idempotencyKey: "e4-grn" }, "habib")
    grnId = out.id
    expect(out.grnNo).toMatch(/^GRN-CST-\d{4}-\d{4}$/)
    expect(out.poStatus).toBe("partial")

    const j = await expectBalanced(s, out.journalId!)
    expect(j.journal.rule).toBe("R12")
    expect(j.journal.voucherType).toBe("PJ")
    expect(j.journal.source?.docType).toBe("grns")
    expect(j.byTag.get("INV_CHEMICAL")).toBe(18 * 6_500_00 + 12 * 3_400_00)
    expect(j.byTag.get("GRNI")).toBe(-(18 * 6_500_00 + 12 * 3_400_00))
    expect(j.lines.find((l) => j.tagOf.get(l.accountId) === "GRNI")?.partyId).toBe(VND.glossGuard)

    // Stock and value in at PO cost; the 2 rejected kits held in quarantine without value.
    const after = (await s.db.stockValues.get(`sv:${ITM.cc2Kit}:${LOC.CST}`))!
    expect(after.qtyBase - before.qtyBase).toBe(18 * 50)
    expect(after.valueP - before.valueP).toBe(18 * 6_500_00)
    const grnLines = await s.db.grnLines.where("grnId").equals(grnId).toArray()
    const kits = grnLines.find((l) => l.itemId === ITM.cc2Kit)!
    expect(kits.quarantineStatus).toBe("held")
    expect(kits.qtyAccepted).toBe(18)
    expect(kits.qtyRejected).toBe(2)
    const batches = await s.db.batches.where("itemId").equals(ITM.cc2Kit).toArray()
    const qc = batches.find((b) => b.grnLineId === kits.id && b.status === "quarantine")!
    const held = await s.db.stockBalances.get(stockBalanceId(ITM.cc2Kit, LOC.CST, qc.id))
    expect(held?.quarantinedQty).toBe(100)
    expect(held?.qtyBase).toBe(0)

    // "18 accepted · 6 pending"
    const poLine = (await s.db.poLines.where("poId").equals(poId).toArray()).find((l) => l.itemId === ITM.cc2Kit)!
    expect(poLine.qtyReceived - poLine.qtyRejected).toBe(18)
    expect(poLine.qty - (poLine.qtyReceived - poLine.qtyRejected)).toBe(6)
    expect(await s.db.events.where("type").equals("GoodsReceived").count()).toBeGreaterThan(0)
    expect(await s.db.events.where("type").equals("LotQuarantined").count()).toBeGreaterThan(0)
    await expectStockTies(s)
  })

  it("refuses more than is still open on a line, a tracked item without a batch, and a rejection without a reason", async () => {
    const po = (await s.db.purchaseOrders.get(poId))!
    const lines = await s.db.poLines.where("poId").equals(poId).toArray()
    const kitLine = lines.find((l) => l.itemId === ITM.cc2Kit)!.id
    // Open = 24 − 18 accepted − 2 held = 4.
    await refused(s, receiveGoods, { poId, expectedVersion: po.version, lots: [{ poLineId: kitLine, qtyAccepted: 5, batchNo: "B", expiry: addDaysISO(s.today, 400) }], idempotencyKey: "x2" }, "habib", "OVER_RECEIPT")
    await refused(s, receiveGoods, { poId, expectedVersion: po.version, lots: [{ poLineId: kitLine, qtyAccepted: 1 }], idempotencyKey: "x3" }, "habib", "BATCH_REQUIRED")
    await refused(s, receiveGoods, { poId, expectedVersion: po.version, lots: [{ poLineId: kitLine, qtyAccepted: 0, qtyRejected: 1, batchNo: "B", expiry: addDaysISO(s.today, 400) }], idempotencyKey: "x4" }, "habib", "REJECT_REASON_REQUIRED")
  })

  it("accepts the quarantined lot into stock at PO cost (R12)", async () => {
    const kits = (await s.db.grnLines.where("grnId").equals(grnId).toArray()).find((l) => l.itemId === ITM.cc2Kit)!
    await refused(s, acceptQuarantine, { grnLineId: kits.id }, "tania", "DENIED")
    const before = (await s.db.stockValues.get(`sv:${ITM.cc2Kit}:${LOC.CST}`))!
    const out = await run(s, acceptQuarantine, { grnLineId: kits.id }, "nusrat")
    const j = await expectBalanced(s, out.journalId)
    expect(j.journal.rule).toBe("R12")
    expect(j.byTag.get("INV_CHEMICAL")).toBe(2 * 6_500_00)
    const after = (await s.db.stockValues.get(`sv:${ITM.cc2Kit}:${LOC.CST}`))!
    expect(after.qtyBase - before.qtyBase).toBe(100)
    const line = (await s.db.grnLines.get(kits.id))!
    expect(line.quarantineStatus).toBe("accepted")
    expect(line.qtyAccepted).toBe(20)
    const poLine = (await s.db.poLines.where("poId").equals(poId).toArray()).find((l) => l.itemId === ITM.cc2Kit)!
    expect(poLine.qtyReceived - poLine.qtyRejected).toBe(20)
    await refused(s, acceptQuarantine, { grnLineId: kits.id }, "nusrat", "QUARANTINE_NOT_HELD")
    await expectStockTies(s)
  })

  it("returns a rejected lot to the vendor without a journal and completes the PO", async () => {
    const po = (await s.db.purchaseOrders.get(poId))!
    const lines = await s.db.poLines.where("poId").equals(poId).toArray()
    const journalsBefore = await s.db.journals.count()
    const out = await run(
      s,
      receiveGoods,
      { poId, expectedVersion: po.version, lots: [{ ...lots(3, 1, 0, lines, s.today)[0], batchNo: "E4-CC2-02" }], idempotencyKey: "e4-grn-2" },
      "habib"
    )
    expect(out.poStatus).toBe("partial")
    const line = (await s.db.grnLines.where("grnId").equals(out.id).toArray())[0]
    await run(s, returnRejected, { grnLineId: line.id }, "habib").catch(async () => {
      // Store keepers decide quarantine too (grn.quarantine.decide: STO, PRO).
      throw new Error("habib could not return")
    })
    expect(await s.db.journals.count()).toBe(journalsBefore + 1) // only the GRN's own R12
    expect((await s.db.grnLines.get(line.id))?.quarantineStatus).toBe("returned")
    const qc = (await s.db.batches.where("itemId").equals(ITM.cc2Kit).toArray()).find((b) => b.grnLineId === line.id)!
    expect((await s.db.stockBalances.get(stockBalanceId(ITM.cc2Kit, LOC.CST, qc.id)))?.quarantinedQty).toBe(0)
    // 23 accepted, the returned one is open again: receive it and the PO is complete.
    const po2 = (await s.db.purchaseOrders.get(poId))!
    const last = await run(
      s,
      receiveGoods,
      { poId, expectedVersion: po2.version, lots: [{ ...lots(1, 0, 0, lines, s.today)[0], batchNo: "E4-CC2-03" }], idempotencyKey: "e4-grn-3" },
      "habib"
    )
    expect(last.poStatus).toBe("received")
    await expectStockTies(s)
    const j = await journalByTag(s, last.journalId!)
    expect(j.byTag.get("GRNI")).toBe(-6_500_00)
  })
})
