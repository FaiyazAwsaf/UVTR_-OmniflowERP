import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { decideApproval } from "@/core/approvals/decide"
import { addDaysISO } from "@/core/clock/dates"
import { stockValueId } from "@/core/db/tables"
import { ITM, LOC, PLANT, VND } from "@/core/seed/content/seed-refs"
import { postJournal } from "@/core/ledger/post"
import { linesForGoodsBill } from "@/core/ledger/rules"
import { receiveGoods } from "@/modules/grn/commands"
import { cancelPo, issuePo, returnToVendor, saveRequisition, sendPo, submitRequisition } from "@/modules/ptl/commands"

import { asSystem } from "../helpers/fixtures"
import { decide, expectBalanced, expectStockTies, refused, run, scmDb, type ScmDb } from "../ic/scm"

/**
 * PTL (plan §6.2, §3.7, accounting_rules R16): requisitions approved by
 * value (never by the requester), POs from an approved requisition without a
 * second approval or direct with approval above the buyer's limit, sending
 * and cancelling, and returns to the vendor with the Mushak 6.8 debit note.
 */

let s: ScmDb
beforeAll(async () => {
  s = await scmDb("ptl")
}, 120_000)
afterAll(async () => {
  await s.db.delete()
})

describe("requisitions", () => {
  let prId: string

  it("Habib's requisition waits for an approver who is not Habib", async () => {
    await refused(s, submitRequisition, { locationId: LOC.CST, lines: [{ itemId: ITM.polish, qty: 6, estUnitCostP: 3_400_00 }] }, "tania", "DENIED")
    const out = await run(
      s,
      submitRequisition,
      {
        locationId: LOC.CST,
        reason: "manual",
        note: "Polish for the coating week",
        lines: [
          { itemId: ITM.polish, qty: 6, estUnitCostP: 3_400_00, suggestedVendorId: VND.glossGuard },
          { itemId: ITM.microfiber, qty: 10, estUnitCostP: 2_200_00, suggestedVendorId: VND.bengalDetail },
        ],
      },
      "habib"
    )
    prId = out.id
    expect(out.status).toBe("pending-approval")
    const pr = (await s.db.purchaseRequisitions.get(prId))!
    expect(pr.totalP).toBe(6 * 3_400_00 + 10 * 2_200_00)
    const approval = (await s.db.approvals.get(pr.approvalId!))!
    expect(approval.approveKey).toBe("ptl.pr.approve")
    expect(new Set(approval.routedTo)).toEqual(new Set(["usr_nusrat", "usr_farzana", "usr_rashed"]))
    await refused(s, decideApproval, { approvalId: approval.id, decision: "approve", reason: "", expectedVersion: approval.version }, "habib", "SELF_APPROVAL")
    await decide(s, approval.id, "nusrat")
    expect((await s.db.purchaseRequisitions.get(prId))?.status).toBe("approved")
    expect(await s.db.events.where("type").equals("RequisitionApproved").count()).toBeGreaterThan(0)
  })

  it("within the requester's own limit a requisition is approved at once", async () => {
    const draft = await run(s, saveRequisition, { locationId: LOC.CST, lines: [{ itemId: ITM.gloves, qty: 2, estUnitCostP: 850_00 }] }, "nusrat")
    let pr = (await s.db.purchaseRequisitions.get(draft.id))!
    expect(pr.status).toBe("draft")
    const out = await run(s, submitRequisition, { prId: draft.id, expectedVersion: pr.version }, "nusrat")
    expect(out.status).toBe("approved")
    pr = (await s.db.purchaseRequisitions.get(draft.id))!
    expect(pr.approvalId).toBeUndefined()
  })

  it("POs from the approved requisition: one per vendor, no second approval within its total", async () => {
    await refused(s, issuePo, { prId, locationId: LOC.CST, orders: [{ vendorId: VND.glossGuard, expectedDate: addDaysISO(s.today, 2), lines: [{ itemId: ITM.polish, qty: 6, unitCostP: 3_400_00 }] }], idempotencyKey: "p0" }, "habib", "DENIED")
    const out = await run(
      s,
      issuePo,
      {
        prId,
        locationId: LOC.CST,
        orders: [
          { vendorId: VND.glossGuard, expectedDate: addDaysISO(s.today, 2), lines: [{ itemId: ITM.polish, qty: 6, unitCostP: 3_400_00 }] },
          { vendorId: VND.bengalDetail, expectedDate: addDaysISO(s.today, 2), lines: [{ itemId: ITM.microfiber, qty: 10, unitCostP: 2_200_00 }] },
        ],
        send: true,
        idempotencyKey: "p1",
      },
      "nusrat"
    )
    expect(out.pos.map((p) => p.status)).toEqual(["issued", "issued"])
    expect((await s.db.purchaseRequisitions.get(prId))?.status).toBe("ordered")
    const po = (await s.db.purchaseOrders.get(out.pos[0].id))!
    expect(po.subtotalP).toBe(6 * 3_400_00)
    expect(po.vatP).toBe(Math.round(6 * 3_400_00 * 0.15))
    expect(po.totalP).toBe(po.subtotalP + po.vatP)
    expect(po.sentAt).toBeDefined()
    expect(await s.db.emails.count()).toBeGreaterThanOrEqual(2)
    await refused(
      s,
      issuePo,
      { locationId: LOC.CST, orders: [{ vendorId: VND.glossGuard, expectedDate: s.today, lines: [{ itemId: ITM.polish, qty: 1, unitCostP: 1 }] }, { vendorId: VND.glossGuard, expectedDate: s.today, lines: [{ itemId: ITM.polish, qty: 1, unitCostP: 1 }] }], idempotencyKey: "p2" },
      "nusrat",
      "PO_ONE_PER_VENDOR"
    )
  })
})

describe("purchase orders", () => {
  it("a direct PO above Nusrat's ৳1,00,000 waits; Farzana approves and it is issued", async () => {
    const out = await run(s, issuePo, { locationId: LOC.CST, orders: [{ vendorId: VND.dhakaAutochem, expectedDate: addDaysISO(s.today, 4), lines: [{ itemId: ITM.snowFoam, qty: 30, unitCostP: 4_200_00 }] }], idempotencyKey: "d1" }, "nusrat")
    expect(out.pos[0].status).toBe("pending-approval")
    const po = (await s.db.purchaseOrders.get(out.pos[0].id))!
    const approval = (await s.db.approvals.get(po.approvalId!))!
    expect(approval.approveKey).toBe("ptl.po.approve")
    expect(approval.routedTo).not.toContain("usr_nusrat")
    await decide(s, approval.id, "farzana")
    expect((await s.db.purchaseOrders.get(po.id))?.status).toBe("issued")
    expect(await s.db.events.where("type").equals("PurchaseOrderApproved").count()).toBeGreaterThan(0)
    await run(s, sendPo, { poId: po.id, idempotencyKey: "s1" }, "nusrat")
    expect((await s.db.purchaseOrders.get(po.id))?.sentAt).toBeDefined()
  })

  it("the planted pending PO is issued when Farzana approves it; a rejected PO is cancelled", async () => {
    await decide(s, PLANT.pendingPoApproval, "farzana")
    expect((await s.db.purchaseOrders.get(PLANT.pendingPo))?.status).toBe("issued")
    const out = await run(s, issuePo, { locationId: LOC.CST, orders: [{ vendorId: VND.metroChem, expectedDate: addDaysISO(s.today, 4), lines: [{ itemId: ITM.ipa, qty: 50, unitCostP: 2_800_00 }] }], idempotencyKey: "d2" }, "nusrat")
    const po = (await s.db.purchaseOrders.get(out.pos[0].id))!
    await decide(s, po.approvalId!, "farzana", "reject", "Too many")
    expect((await s.db.purchaseOrders.get(po.id))?.status).toBe("cancelled")
  })

  it("cancels an open PO with nothing received; Habib cannot", async () => {
    const out = await run(s, issuePo, { locationId: LOC.CST, orders: [{ vendorId: VND.bengalDetail, expectedDate: addDaysISO(s.today, 4), lines: [{ itemId: ITM.brush, qty: 2, unitCostP: 1_200_00 }] }], idempotencyKey: "d3" }, "nusrat")
    const po = (await s.db.purchaseOrders.get(out.pos[0].id))!
    await refused(s, cancelPo, { poId: po.id, expectedVersion: po.version, reason: "Wrong vendor" }, "habib", "DENIED")
    const res = await run(s, cancelPo, { poId: po.id, expectedVersion: po.version, reason: "Wrong vendor" }, "nusrat")
    expect(res.status).toBe("cancelled")
  })
})

describe("returns to vendor (R16, Mushak 6.8)", () => {
  it("an unbilled return credits GRNI at the PO cost, inventory at average, the difference to PPV", async () => {
    const out = await run(s, issuePo, { locationId: LOC.CST, orders: [{ vendorId: VND.bengalDetail, expectedDate: addDaysISO(s.today, 1), lines: [{ itemId: ITM.polishingPad, qty: 10, unitCostP: 900_00 }] }], idempotencyKey: "r1" }, "nusrat")
    const po = (await s.db.purchaseOrders.get(out.pos[0].id))!
    const [line] = await s.db.poLines.where("poId").equals(po.id).toArray()
    const grn = await run(s, receiveGoods, { poId: po.id, expectedVersion: po.version, lots: [{ poLineId: line.id, qtyAccepted: 10 }], idempotencyKey: "r1g" }, "habib")
    const [grnLine] = await s.db.grnLines.where("grnId").equals(grn.id).toArray()
    await refused(s, returnToVendor, { grnId: grn.id, reason: "Wrong size", lines: [{ grnLineId: grnLine.id, qty: 11 }], idempotencyKey: "r1x" }, "habib", "RETURN_TOO_MUCH")
    await refused(s, returnToVendor, { grnId: grn.id, reason: "Wrong size", lines: [{ grnLineId: grnLine.id, qty: 2 }], idempotencyKey: "r1y" }, "shahriar", "DENIED")
    const before = (await s.db.stockValues.get(stockValueId(ITM.polishingPad, LOC.CST)))!
    const ret = await run(s, returnToVendor, { grnId: grn.id, reason: "Wrong size", lines: [{ grnLineId: grnLine.id, qty: 2 }], idempotencyKey: "r1r" }, "habib")
    expect(ret.returnNo).toMatch(/^PRN-\d{4}-\d{4}$/)
    expect(ret.debitNoteNo).toMatch(/^DBN-\d{4}-\d{4}$/)
    const after = (await s.db.stockValues.get(stockValueId(ITM.polishingPad, LOC.CST)))!
    const stockOut = before.valueP - after.valueP
    const j = await expectBalanced(s, ret.journalId)
    expect(j.journal.rule).toBe("R16")
    expect(j.journal.voucherType).toBe("PJ")
    expect(j.byTag.get("GRNI")).toBe(2 * 900_00)
    expect(j.byTag.get("INV_CONSUMABLE")).toBe(-stockOut)
    expect(j.byTag.get("PPV") ?? 0).toBe(stockOut - 2 * 900_00)
    expect((await s.db.grnLines.get(grnLine.id))?.qtyReturned).toBe(2)
    expect((await s.db.poLines.get(line.id))?.qtyReturned).toBe(2)
    const dbn = (await s.db.debitNotes.get(ret.debitNoteId))!
    expect(dbn.netP).toBe(2 * 900_00)
    expect(dbn.purchaseReturnId).toBe(ret.id)
    expect(await s.db.events.where("type").equals("DebitNoteIssued").count()).toBe(1)
    await expectStockTies(s)
  })

  it("a billed return debits the bill (AP up to its open amount, the rest an advance) and reverses its input VAT", async () => {
    // A received and billed line: the bill is a fixture posted with the R13 rule (AP records bills).
    const out = await run(s, issuePo, { locationId: LOC.CST, orders: [{ vendorId: VND.bengalDetail, expectedDate: addDaysISO(s.today, 1), lines: [{ itemId: ITM.cuttingPad, qty: 6, unitCostP: 950_00 }] }], idempotencyKey: "r2p" }, "nusrat")
    const po = (await s.db.purchaseOrders.get(out.pos[0].id))!
    const [poLine] = await s.db.poLines.where("poId").equals(po.id).toArray()
    const grn = await run(s, receiveGoods, { poId: po.id, expectedVersion: po.version, lots: [{ poLineId: poLine.id, qtyAccepted: 6 }], idempotencyKey: "r2g" }, "habib")
    const [g] = await s.db.grnLines.where("grnId").equals(grn.id).toArray()
    const priceP = 1_000_00 // billed 5% above the PO price
    const netP = 6 * priceP
    const vatP = Math.round(netP * 0.15)
    const billId = await asSystem(s.db, async (tx) => {
      const bill = tx.insert("vendorBills", {
        billNo: "BL-TEST-00001",
        vendorRef: "BDS/TEST/1",
        partyId: VND.bengalDetail,
        locationId: LOC.CST,
        date: s.today,
        dueDate: addDaysISO(s.today, 15),
        kind: "goods",
        poId: po.id,
        grnIds: [grn.id],
        hasMushak63: true,
        subtotalP: netP,
        inputVatP: vatP,
        totalP: netP + vatP,
        paidP: 0,
        debitedP: 0,
        status: "posted",
        matchStatus: "matched",
        matchDiffs: [],
      })
      tx.insert("vendorBillLines", { billId: bill.id, lineNo: 1, poLineId: poLine.id, grnLineId: g.id, itemId: ITM.cuttingPad, description: "Cutting pad", qty: 6, unitPriceP: priceP, vatRatePct: 15, vatP, netP })
      await tx.update("grnLines", g.id, { qtyBilled: 6 })
      const journal = await postJournal(tx, {
        voucherType: "PJ",
        date: s.today,
        source: { app: "ap", docType: "vendorBills", docId: bill.id, docNo: bill.billNo },
        narration: "Test bill",
        lines: linesForGoodsBill({ partyId: VND.bengalDetail, locationId: LOC.CST, lines: [{ grniP: 6 * 950_00, ppvP: netP - 6 * 950_00, vatP }], hasMushak63: true }),
        rule: "R13",
      })
      await tx.update("vendorBills", bill.id, { journalId: journal.id })
      return bill.id
    })
    const bill = (await s.db.vendorBills.get(billId))!
    const before = (await s.db.stockValues.get(stockValueId(ITM.cuttingPad, LOC.CST)))!
    const ret = await run(s, returnToVendor, { grnId: grn.id, reason: "Damaged in storage, vendor credit", lines: [{ grnLineId: g.id, qty: 2 }], idempotencyKey: "r2" }, "nusrat")
    const after = (await s.db.stockValues.get(stockValueId(ITM.cuttingPad, LOC.CST)))!
    const j = await expectBalanced(s, ret.journalId)
    const price = 2 * priceP
    const vat = Math.round(price * 0.15)
    // Billed: the bill price plus its VAT against AP (open), the input VAT reversed, stock out at average, the rest PPV.
    expect(j.byTag.get("AP_CONTROL")).toBe(price + vat)
    expect(j.byTag.get("ADV_VENDOR") ?? 0).toBe(0)
    expect(j.byTag.get("GRNI") ?? 0).toBe(0)
    expect(j.byTag.get("VAT_CURRENT")).toBe(-vat)
    expect(j.byTag.get("INV_CONSUMABLE")).toBe(-(before.valueP - after.valueP))
    expect(j.byTag.get("PPV") ?? 0).toBe(before.valueP - after.valueP - price)
    expect((await s.db.vendorBills.get(bill.id))?.debitedP).toBe(price + vat)
    const dbn = (await s.db.debitNotes.get(ret.debitNoteId))!
    expect(dbn.billId).toBe(bill.id)
    expect(dbn.totalP).toBe(price + vat)
    await expectStockTies(s)
  })
})
