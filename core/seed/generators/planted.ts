import { issueValue } from "@/core/stock/value"

import { CBA, ITM, LOC, PLANT, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { dhakaAt } from "../time"

/**
 * Today's pending approvals that are not purchasing (seed_data.md §8): a
 * petty cash voucher of ৳3,500 by Tania at Gulshan (above her ৳1,000, for
 * Shahriar) and a stock adjustment at Uttara by Habib (a damaged 1 L bottle
 * of finishing polish, about ৳3,400, above his ৳1,000, for Arif). Both are
 * dated today, so last month's close is never blocked.
 */
export function seedPlantedApprovals(w: World): void {
  const { bag } = w.ctx
  const today = w.cal.today

  const pcvAt = dhakaAt(today, "09:50")
  const pcv = bag.put("pettyCashVouchers", PLANT.pendingPettyCash, pcvAt, {
    voucherNo: "",
    cashBankAccountId: CBA.PETTY_GUL,
    locationId: LOC.GUL,
    date: today,
    expenseTag: "REPAIRS",
    amountP: 3_500_00,
    payee: "Hardware shop",
    description: "Two replacement trigger guns for the wash bay hoses",
    status: "pending-approval",
    preparedBy: USR.tania,
  }, USR.tania)
  w.number("PCV", { location: LOC.GUL, date: today }, pcvAt, (no) => {
    pcv.voucherNo = no
  })
  pcv.approvalId = w.approval({
    id: PLANT.pendingPettyCashApproval,
    kind: "petty-cash",
    docType: "pettyCashVouchers",
    docId: pcv.id,
    docNo: () => pcv.voucherNo,
    locationId: LOC.GUL,
    amountP: pcv.amountP,
    requestedBy: USR.tania,
    requestedAt: pcvAt,
    status: "pending",
    reason: "Both trigger guns leaking; bought this morning",
  }).id

  const adjAt = dhakaAt(today, "10:12")
  const onHand = w.stock.onHand(ITM.polish, LOC.UTT)
  const value = issueValue(1000, onHand.qtyBase, onHand.valueP)
  const adj = bag.put("stockAdjustments", PLANT.pendingAdjustment, adjAt, {
    adjustmentNo: "",
    locationId: LOC.UTT,
    date: today,
    reason: "damage",
    note: "One 1 L bottle of finishing polish dropped and broken while unpacking",
    lines: [{ itemId: ITM.polish, qtyBase: -1000, valueP: -value }],
    status: "pending-approval",
    preparedBy: USR.habib,
  }, USR.habib)
  w.number("ADJ", { location: LOC.UTT, date: today }, adjAt, (no) => {
    adj.adjustmentNo = no
  })
  adj.approvalId = w.approval({
    id: PLANT.pendingAdjustmentApproval,
    kind: "stock-adjust",
    docType: "stockAdjustments",
    docId: adj.id,
    docNo: () => adj.adjustmentNo,
    locationId: LOC.UTT,
    amountP: value,
    requestedBy: USR.habib,
    requestedAt: adjAt,
    status: "pending",
    reason: "Damaged in handling",
  }).id
}
