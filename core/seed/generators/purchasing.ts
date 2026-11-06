import type { Id, PurchaseOrderRow, VendorBillRow } from "@/core/db/schema"
import { linesForGoodsBill } from "@/core/ledger/rules"
import { percentOf } from "@/core/tax/vat"

import { ITEM_BY_ID } from "../content/catalogue"
import { VENDOR_BY_ID } from "../content/parties"
import { ITM, LOC, PLANT, USR, VND } from "../content/seed-refs"
import type { World } from "../engine/world"
import { dhakaAt, dhakaDate, isoAddDays, MINUTE } from "../time"
import { poLineId, type PlannedPo, type StockOut } from "./stock"

/**
 * PTL and AP for the itemised window (seed_data.md §7.4, §8): weekly
 * requisitions by Habib (approved by Nusrat, or Farzana above her limit),
 * POs by Nusrat (Farzana approves above ৳1,00,000), goods bills matched to
 * the GRNs (R13; 5% mismatched first and released by Farzana, the price
 * difference to PPV), the Bengal Detail partial PO, the bill on hold from
 * Dhaka Auto Chem (4% over the PO, pending today) and Nusrat's pending PO.
 */

export function seedPurchasing(w: World, stock: StockOut): { bills: VendorBillRow[] } {
  const { bag } = w.ctx
  const rng = w.rng("purchasing")
  const bills: VendorBillRow[] = []
  const prs = new Map<Id, PlannedPo[]>()
  for (const po of stock.pos) if (po.prId) prs.set(po.prId, [...(prs.get(po.prId) ?? []), po])

  // Requisitions from reorder suggestions (one per week), approved by Nusrat or, above ৳1,00,000, Farzana.
  for (const [prId, pos] of prs) {
    const at = pos[0].orderAt - 5 * 60 * MINUTE
    const date = dhakaDate(at)
    let total = 0
    const pr = bag.put("purchaseRequisitions", prId, at, {
      prNo: "",
      locationId: LOC.CST,
      requestedBy: USR.habib,
      reason: "reorder",
      status: "ordered",
      totalP: 0,
      date,
      note: "Weekly replenishment from reorder suggestions",
    }, USR.habib)
    w.number("PR", { date }, at, (no) => {
      pr.prNo = no
    })
    for (const po of pos) {
      for (const l of po.lines) {
        const est = ITEM_BY_ID.get(l.itemId)!.cost * 100
        total += l.units * est
        bag.put("prLines", w.ctx.seq("prl"), at, { prId, itemId: l.itemId, qty: l.units, estUnitCostP: est, suggestedVendorId: po.vendorId }, USR.habib)
      }
    }
    pr.totalP = total
    const approver = total <= w.limitOf(USR.nusrat, "purchase") ? USR.nusrat : total <= w.limitOf(USR.farzana, "purchase") ? USR.farzana : USR.rashed
    pr.approvalId = w.approval({
      kind: "purchase",
      docType: "purchaseRequisitions",
      docId: prId,
      docNo: () => pr.prNo,
      locationId: LOC.CST,
      amountP: total,
      requestedBy: USR.habib,
      requestedAt: at,
      status: "approved",
      decidedBy: approver,
      decidedAt: at + 90 * MINUTE,
      reason: "Weekly replenishment",
    }).id
  }

  for (const po of stock.pos) {
    const row = writePo(w, po)
    if (!po.grnAt || !po.grnId) continue
    if (po.kind === "bengal-partial") continue
    if (po.kind === "held-bill") {
      bills.push(writeHeldBill(w, po, row))
      continue
    }
    const billDay = isoAddDays(dhakaDate(po.grnAt), rng.int(0, 3))
    if (billDay >= w.cal.today) continue
    const mismatch = rng.bool(0.05) && isoAddDays(billDay, 1) < w.cal.today
    bills.push(writeGoodsBill(w, po, row, billDay, mismatch))
  }

  writePendingPo(w)
  return { bills }
}

function writePo(w: World, po: PlannedPo): PurchaseOrderRow {
  const { bag } = w.ctx
  const date = dhakaDate(po.orderAt)
  let subtotal = 0
  let vat = 0
  for (const l of po.lines) {
    const net = Math.round(l.units * l.unitCostP)
    subtotal += net
    vat += percentOf(net, 15)
  }
  const total = subtotal + vat
  const received = po.lines.every((l) => l.received >= l.units)
  const any = po.lines.some((l) => l.received > 0)
  const row = bag.put("purchaseOrders", po.id, po.orderAt, {
    poNo: "",
    vendorId: po.vendorId,
    locationId: LOC.CST,
    prId: po.prId,
    status: received ? "received" : any ? "partial" : "issued",
    orderDate: date,
    expectedDate: isoAddDays(date, 3),
    subtotalP: subtotal,
    vatP: vat,
    totalP: total,
    sentAt: po.orderAt + 10 * MINUTE,
    buyerId: USR.nusrat,
  }, USR.nusrat)
  w.number("PO", { date }, po.orderAt, (no) => {
    row.poNo = no
  })
  if (po.grnAt) row.updatedAt = po.grnAt
  // A PO above Nusrat's own limit is approved by Farzana (or Rashed above hers).
  if (total > w.limitOf(USR.nusrat, "purchase")) {
    const approver = total <= w.limitOf(USR.farzana, "purchase") ? USR.farzana : USR.rashed
    row.approvalId = w.approval({
      kind: "purchase",
      docType: "purchaseOrders",
      docId: po.id,
      docNo: () => row.poNo,
      locationId: LOC.CST,
      amountP: total,
      requestedBy: USR.nusrat,
      requestedAt: po.orderAt - 40 * MINUTE,
      status: "approved",
      decidedBy: approver,
      decidedAt: po.orderAt - 10 * MINUTE,
      reason: "Replenishment above my limit",
    }).id
  }
  po.lines.forEach((l, i) => {
    bag.put("poLines", poLineId(po.id, i), po.orderAt, {
      poId: po.id,
      lineNo: i + 1,
      itemId: l.itemId,
      qty: l.units,
      unitCostP: l.unitCostP,
      vatRatePct: 15,
      qtyReceived: l.received,
      qtyRejected: l.rejected,
      qtyReturned: 0,
      qtyBilled: 0,
    }, USR.nusrat)
  })
  return row
}

/** Bill lines from the GRN's accepted, not yet billed quantity; `pricePct` above the PO price. */
function billLines(w: World, po: PlannedPo, pricePct: number) {
  const { bag } = w.ctx
  const grnLines = bag.all("grnLines").filter((g) => g.grnId === po.grnId)
  return grnLines
    .filter((g) => g.qtyAccepted - g.qtyBilled > 0)
    .map((g) => {
      const qty = g.qtyAccepted - g.qtyBilled
      const price = pricePct ? g.unitCostP + percentOf(g.unitCostP, pricePct) : g.unitCostP
      const net = Math.round(qty * price)
      const grni = Math.round(qty * g.unitCostP)
      return { g, qty, price, net, grni, vat: percentOf(net, 15) }
    })
}

function putBill(w: World, po: PlannedPo, id: Id, day: string, at: number, lines: ReturnType<typeof billLines>, extra: Partial<VendorBillRow>): VendorBillRow {
  const { bag } = w.ctx
  const rng = w.rng("purchasing")
  const vendor = VENDOR_BY_ID.get(po.vendorId)!
  const subtotal = lines.reduce((s, l) => s + l.net, 0)
  const vat = lines.reduce((s, l) => s + l.vat, 0)
  const bill = bag.put("vendorBills", id, at, {
    billNo: "",
    vendorRef: `${vendor.nameEn.split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "")}/${day.slice(2, 4)}${day.slice(5, 7)}/${rng.int(1000, 9999)}`,
    partyId: po.vendorId,
    locationId: LOC.CST,
    date: day,
    dueDate: isoAddDays(day, vendor.terms),
    kind: "goods",
    poId: po.id,
    grnIds: [po.grnId!],
    hasMushak63: true,
    subtotalP: subtotal,
    inputVatP: vat,
    totalP: subtotal + vat,
    paidP: 0,
    debitedP: 0,
    status: "posted",
    matchStatus: "matched",
    matchDiffs: [],
    ...extra,
  }, USR.mahbub)
  w.number("BL", { date: day }, at, (no) => {
    bill.billNo = no
  })
  lines.forEach((l, i) => {
    bag.put("vendorBillLines", w.ctx.seq("bll"), at, {
      billId: id,
      lineNo: i + 1,
      poLineId: l.g.poLineId,
      grnLineId: l.g.id,
      itemId: l.g.itemId,
      description: ITEM_BY_ID.get(l.g.itemId)!.nameEn,
      qty: l.qty,
      unitPriceP: l.price,
      vatRatePct: 15,
      vatP: l.vat,
      netP: l.net,
    }, USR.mahbub)
  })
  return bill
}

function postGoodsBill(w: World, po: PlannedPo, bill: VendorBillRow, lines: ReturnType<typeof billLines>, at: number, approvalId?: Id) {
  const { bag } = w.ctx
  const journal = w.ledger.post({
    rule: "R13",
    date: dhakaDate(at),
    at,
    lines: linesForGoodsBill({
      partyId: po.vendorId,
      locationId: LOC.CST,
      lines: lines.map((l) => ({ grniP: l.grni, ppvP: l.net - l.grni, vatP: l.vat })),
      hasMushak63: true,
    }),
    narration: () => `Vendor bill ${bill.billNo}`,
    source: { app: "ap", docType: "vendorBills", docId: bill.id, docNo: () => bill.billNo },
    preparedBy: USR.mahbub,
    postedBy: approvalId ? USR.farzana : USR.mahbub,
    approvalId,
  })
  bill.journalId = journal.id
  for (const l of lines) {
    l.g.qtyBilled += l.qty
    l.g.updatedAt = at
    const pol = bag.get("poLines", l.g.poLineId)
    pol.qtyBilled += l.qty
  }
}

function writeGoodsBill(w: World, po: PlannedPo, row: PurchaseOrderRow, day: string, mismatch: boolean): VendorBillRow {
  const lines = billLines(w, po, mismatch ? 5 : 0)
  const at = dhakaAt(day, "14:00")
  const id = w.ctx.seq("bl")
  if (!mismatch) {
    const bill = putBill(w, po, id, day, at, lines, {})
    postGoodsBill(w, po, bill, lines, at)
    return bill
  }
  // Price 5% over the PO: held, then released by Farzana the next day (the difference to PPV).
  const releaseAt = dhakaAt(isoAddDays(day, 1), "11:30")
  const bill = putBill(w, po, id, day, at, lines, {
    matchStatus: "mismatch",
    matchDiffs: lines.map((l) => ({ poLineId: l.g.poLineId, itemId: l.g.itemId, field: "price" as const, expected: l.g.unitCostP, actual: l.price, diffPct: 5 })),
  })
  const approval = w.approval({
    kind: "purchase",
    docType: "vendorBills",
    docId: id,
    docNo: () => bill.billNo,
    locationId: LOC.CST,
    amountP: bill.totalP,
    requestedBy: USR.mahbub,
    requestedAt: at,
    status: "approved",
    decidedBy: USR.farzana,
    decidedAt: releaseAt,
    reason: "Unit price above the PO",
    decisionReason: "Vendor price increase confirmed by Nusrat",
  })
  bill.holdApprovalId = approval.id
  bill.updatedAt = releaseAt
  postGoodsBill(w, po, bill, lines, releaseAt, approval.id)
  void row
  return bill
}

/** §8: Dhaka Auto Chem's bill, unit price 4% over the PO: on hold today, pending Farzana's release. */
function writeHeldBill(w: World, po: PlannedPo, row: PurchaseOrderRow): VendorBillRow {
  const lines = billLines(w, po, 4)
  const at = dhakaAt(w.cal.today, "09:40")
  const bill = putBill(w, po, PLANT.heldBill, w.cal.today, at, lines, {
    status: "on-hold",
    matchStatus: "mismatch",
    matchDiffs: lines.map((l) => ({ poLineId: l.g.poLineId, itemId: l.g.itemId, field: "price" as const, expected: l.g.unitCostP, actual: l.price, diffPct: 4 })),
  })
  bill.holdApprovalId = w.approval({
    id: PLANT.heldBillApproval,
    kind: "purchase",
    docType: "vendorBills",
    docId: bill.id,
    docNo: () => bill.billNo,
    locationId: LOC.CST,
    amountP: bill.totalP,
    requestedBy: USR.mahbub,
    requestedAt: at,
    status: "pending",
    reason: "Unit price 4% above the PO",
  }).id
  void row
  return bill
}

/** §8: Nusrat's PO of ৳1,48,000 (above her ৳1,00,000), pending Farzana or Rashed today. */
function writePendingPo(w: World) {
  const { bag } = w.ctx
  const at = dhakaAt(w.cal.today, "10:05")
  const lines: { itemId: Id; units: number; unitCostP: number }[] = [
    { itemId: ITM.ipa20l, units: 6, unitCostP: 10_400_00 },
    { itemId: ITM.ironRemover, units: 6, unitCostP: 7_500_00 },
    { itemId: ITM.clayLube, units: 6, unitCostP: 3_200_00 },
  ]
  // The last line's price makes the total exactly ৳1,48,000 (VAT 15% per line, half up).
  const target = 1_48_000_00
  const fixed = lines.reduce((s, l) => s + l.units * l.unitCostP + percentOf(l.units * l.unitCostP, 15), 0)
  let net = Math.floor((target - fixed) / 1.15)
  while (net + percentOf(net, 15) < target - fixed) net += 1
  while (net + percentOf(net, 15) > target - fixed) net -= 1
  lines.push({ itemId: ITM.tarRemover, units: 1, unitCostP: net })
  let subtotal = 0
  let vat = 0
  for (const l of lines) {
    subtotal += l.units * l.unitCostP
    vat += percentOf(l.units * l.unitCostP, 15)
  }
  const date = w.cal.today
  const po = bag.put("purchaseOrders", PLANT.pendingPo, at, {
    poNo: "",
    vendorId: VND.metroChem,
    locationId: LOC.CST,
    status: "pending-approval",
    orderDate: date,
    expectedDate: isoAddDays(date, 4),
    subtotalP: subtotal,
    vatP: vat,
    totalP: subtotal + vat,
    buyerId: USR.nusrat,
  }, USR.nusrat)
  w.number("PO", { date }, at, (no) => {
    po.poNo = no
  })
  lines.forEach((l, i) => {
    bag.put("poLines", poLineId(PLANT.pendingPo, i), at, { poId: PLANT.pendingPo, lineNo: i + 1, itemId: l.itemId, qty: l.units, unitCostP: l.unitCostP, vatRatePct: 15, qtyReceived: 0, qtyRejected: 0, qtyReturned: 0, qtyBilled: 0 }, USR.nusrat)
  })
  po.approvalId = w.approval({
    id: PLANT.pendingPoApproval,
    kind: "purchase",
    docType: "purchaseOrders",
    docId: PLANT.pendingPo,
    docNo: () => po.poNo,
    locationId: LOC.CST,
    amountP: subtotal + vat,
    requestedBy: USR.nusrat,
    requestedAt: at,
    status: "pending",
    reason: "Bulk solvents ahead of the coating season",
  }).id
}
