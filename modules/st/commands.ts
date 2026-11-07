import { z } from "zod"

import { requireApproval } from "@/core/approvals/approvals"
import { newId } from "@/core/db/ids"
import type { ExpenseTag, Id, InventoryTag, StockAdjustmentRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForStockAdjustment, linesForTransferDispatch, linesForTransferReceipt, RULE_VOUCHER } from "@/core/ledger/rules"
import { transferIn, transferOut } from "@/core/stock/moves"
import { roundQty } from "@/core/stock/value"
import { adjustLine, byItem, linkMoves, previewValues, tagOfItem } from "@/modules/ic/stock-helpers"

/**
 * ST Stock Transactions commands (plan §6.2): transfers between the Central
 * Store and the studios (request → dispatch with the Mushak 6.5 challan into
 * transit, R20 → receive with discrepancies, R21), stock adjustments and
 * internal use (R22) within the maker's `stock-adjust` limit or queued for
 * st.adjust.approve.
 */

async function stockLocation(tx: Tx, id: Id) {
  const location = await tx.get("locations", id)
  if (!location.isStockLocation) tx.reject("NOT_STOCK_LOCATION", { location: id })
  return location
}

/* ------------------------------------------------------------------ *
 * Transfers
 * ------------------------------------------------------------------ */

/** `st.requestTransfer` (st.transfer.request, scope: the destination) → TransferRequested. */
export const requestTransfer = defineCommand({
  name: "st.requestTransfer",
  permission: "st.transfer.request",
  input: z.object({
    fromLocationId: z.string(),
    toLocationId: z.string(),
    note: z.string().trim().optional(),
    lines: z.array(z.object({ itemId: z.string(), qtyBase: z.number().positive() })).min(1),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    if (input.fromLocationId === input.toLocationId) tx.reject("TRANSFER_SAME_LOCATION")
    await stockLocation(tx, input.fromLocationId)
    await stockLocation(tx, input.toLocationId)
    tx.requireLocation(input.toLocationId)
    const items = new Set<Id>()
    for (const line of input.lines) {
      if (items.has(line.itemId)) tx.reject("TRANSFER_DUPLICATE_ITEM")
      items.add(line.itemId)
      const item = await tx.get("items", line.itemId)
      if (item.status !== "active") tx.reject("ITEM_INACTIVE", { item: item.sku })
    }
    const transfer = tx.insert("transfers", {
      transferNo: await nextDocNo(tx, "TRF"),
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      status: "requested",
      requestedBy: tx.actor.userId,
      requestedAt: tx.now(),
      note: input.note || undefined,
    })
    for (const line of input.lines) {
      tx.insert("transferLines", {
        transferId: transfer.id,
        itemId: line.itemId,
        qtyRequested: roundQty(line.qtyBase),
        qtySent: 0,
        qtyReceived: 0,
        unitCostP: 0,
        valueP: 0,
      })
    }
    tx.emit("TransferRequested", {
      refs: { transferId: transfer.id },
      params: { no: transfer.transferNo, lines: input.lines.length },
      locationId: input.toLocationId,
    })
    return { id: transfer.id, transferNo: transfer.transferNo }
  },
})

/**
 * `st.dispatchTransfer` (st.transfer.dispatch, scope: the source): stock
 * leaves the source FEFO at its average cost into transit (R20); the value
 * is stored on the transfer lines, one per batch → TransferDispatched.
 */
export const dispatchTransfer = defineCommand({
  name: "st.dispatchTransfer",
  permission: "st.transfer.dispatch",
  input: z.object({
    transferId: z.string(),
    expectedVersion: z.number().int(),
    vehicleNo: z.string().trim().optional(),
    lines: z.array(z.object({ lineId: z.string(), qtySent: z.number().nonnegative() })),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const transfer = await tx.get("transfers", input.transferId, { expectedVersion: input.expectedVersion })
    if (transfer.status !== "requested") tx.reject("TRANSFER_NOT_REQUESTED", { no: transfer.transferNo })
    tx.requireLocation(transfer.fromLocationId)
    const today = tx.today()
    const ref = { docType: "transfers", docId: transfer.id, docNo: transfer.transferNo }
    const lines = await tx.list("transferLines", "transferId", transfer.id)
    const sent = new Map(input.lines.map((l) => [l.lineId, l.qtySent]))
    const valued: { itemId: Id; tag: InventoryTag; valueP: number }[] = []
    const moveIds: Id[] = []

    for (const line of lines) {
      const qty = roundQty(sent.get(line.id) ?? line.qtyRequested)
      if (qty <= 0) continue
      const out = await transferOut(tx, { itemId: line.itemId, locationId: transfer.fromLocationId, qtyBase: qty, ref, date: today })
      valued.push({ itemId: line.itemId, tag: await tagOfItem(tx, line.itemId), valueP: out.valueP })
      // One transfer line per batch: the first allocation keeps the requested line.
      for (const [i, m] of out.moves.entries()) {
        moveIds.push(m.moveId)
        const fields = {
          batchId: m.batchId,
          qtySent: m.qtyBase,
          unitCostP: m.qtyBase > 0 ? m.valueP / m.qtyBase : 0,
          valueP: m.valueP,
        }
        if (i === 0) await tx.update("transferLines", line.id, fields)
        else tx.insert("transferLines", { transferId: transfer.id, itemId: line.itemId, qtyRequested: 0, qtyReceived: 0, ...fields })
      }
    }
    if (!valued.length) tx.reject("TRANSFER_NOTHING_SENT", { no: transfer.transferNo })

    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R20,
      date: today,
      source: { app: "st", docType: "transfers", docId: transfer.id, docNo: transfer.transferNo },
      narration: `Transfer dispatched, ${transfer.transferNo}`,
      lines: linesForTransferDispatch({
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        lines: byItem(valued),
      }),
      rule: "R20",
    })
    await linkMoves(tx, moveIds, journal.id)
    await tx.update("transfers", transfer.id, {
      status: "dispatched",
      dispatchedBy: tx.actor.userId,
      dispatchedAt: tx.now(),
      vehicleNo: input.vehicleNo || undefined,
      dispatchJournalId: journal.id,
    })
    tx.emit("TransferDispatched", {
      refs: { transferId: transfer.id, journalId: journal.id },
      params: { no: transfer.transferNo },
      locationId: transfer.fromLocationId,
    })
    return { journalId: journal.id }
  },
})

/**
 * `st.receiveTransfer` (st.transfer.receive, scope: the destination): what
 * arrived goes on the shelf at the value it carried (R21); a shortfall's
 * share of the value goes to inventory loss → TransferReceived.
 */
export const receiveTransfer = defineCommand({
  name: "st.receiveTransfer",
  permission: "st.transfer.receive",
  input: z.object({
    transferId: z.string(),
    expectedVersion: z.number().int(),
    lines: z.array(
      z.object({ lineId: z.string(), qtyReceived: z.number().nonnegative(), note: z.string().trim().optional() })
    ),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const transfer = await tx.get("transfers", input.transferId, { expectedVersion: input.expectedVersion })
    if (transfer.status !== "dispatched") tx.reject("TRANSFER_NOT_DISPATCHED", { no: transfer.transferNo })
    tx.requireLocation(transfer.toLocationId)
    const today = tx.today()
    const ref = { docType: "transfers", docId: transfer.id, docNo: transfer.transferNo }
    const lines = await tx.list("transferLines", "transferId", transfer.id)
    const given = new Map(input.lines.map((l) => [l.lineId, l]))
    const perItem = new Map<Id, { itemId: Id; tag: InventoryTag; receivedValueP: number; shortfallValueP: number }>()
    const moveIds: Id[] = []

    for (const line of lines) {
      if (line.qtySent <= 0) continue
      const entry = given.get(line.id)
      const received = roundQty(entry?.qtyReceived ?? line.qtySent)
      const item = await tx.get("items", line.itemId)
      if (received > line.qtySent + 1e-9) tx.reject("TRANSFER_OVER_RECEIPT", { item: item.sku, sent: line.qtySent, received })
      const receivedValueP = received >= line.qtySent ? line.valueP : Math.round((line.valueP * received) / line.qtySent)
      if (received > 0) {
        const out = await transferIn(tx, {
          itemId: line.itemId,
          locationId: transfer.toLocationId,
          qtyBase: received,
          valueP: receivedValueP,
          ref,
          date: today,
          batchId: line.batchId,
        })
        moveIds.push(...out.moves.map((m) => m.moveId))
      }
      const short = roundQty(line.qtySent - received)
      await tx.update("transferLines", line.id, {
        qtyReceived: received,
        discrepancyNote: short > 0 ? entry?.note || undefined : undefined,
      })
      const agg = perItem.get(line.itemId) ?? { itemId: line.itemId, tag: await tagOfItem(tx, line.itemId), receivedValueP: 0, shortfallValueP: 0 }
      agg.receivedValueP += receivedValueP
      agg.shortfallValueP += line.valueP - receivedValueP
      perItem.set(line.itemId, agg)
    }

    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R21,
      date: today,
      source: { app: "st", docType: "transfers", docId: transfer.id, docNo: transfer.transferNo },
      narration: `Transfer received, ${transfer.transferNo}`,
      lines: linesForTransferReceipt({ toLocationId: transfer.toLocationId, lines: [...perItem.values()] }),
      rule: "R21",
    })
    await linkMoves(tx, moveIds, journal.id)
    await tx.update("transfers", transfer.id, {
      status: "received",
      receivedBy: tx.actor.userId,
      receivedAt: tx.now(),
      receiveJournalId: journal.id,
    })
    const shortfalls = [...perItem.values()].filter((p) => p.shortfallValueP > 0).length
    tx.emit("TransferReceived", {
      refs: { transferId: transfer.id, journalId: journal.id },
      params: { no: transfer.transferNo, short: shortfalls },
      locationId: transfer.toLocationId,
    })
    return { journalId: journal.id }
  },
})

/** `st.cancelTransfer` (st.transfer.request or st.transfer.dispatch): withdraw a request not yet dispatched. */
export const cancelTransfer = defineCommand({
  name: "st.cancelTransfer",
  permission: ["st.transfer.request", "st.transfer.dispatch"],
  input: z.object({ transferId: z.string(), expectedVersion: z.number().int(), reason: z.string().trim().min(3) }),
  async run(tx, input) {
    const transfer = await tx.get("transfers", input.transferId, { expectedVersion: input.expectedVersion })
    if (transfer.status !== "requested") tx.reject("TRANSFER_NOT_REQUESTED", { no: transfer.transferNo })
    const allowed =
      tx.can("st.transfer.request", transfer.toLocationId) || tx.can("st.transfer.dispatch", transfer.fromLocationId)
    if (!allowed) tx.reject("OUT_OF_SCOPE", { location: transfer.toLocationId }, { audit: true })
    await tx.update("transfers", transfer.id, { status: "cancelled", note: [transfer.note, input.reason].filter(Boolean).join(" · ") })
    tx.auditContext({ reason: input.reason })
    return { ok: true }
  },
})

/* ------------------------------------------------------------------ *
 * Adjustments and internal use (R22)
 * ------------------------------------------------------------------ */

const ADJUST_REASONS = ["damage", "expiry", "loss", "found", "correction"] as const
export const ISSUE_TAGS = ["OFFICE", "WELFARE", "REPAIRS", "MARKETING", "CONSUMABLES_USED", "CONVEYANCE", "SECURITY"] as const
export type IssueTag = (typeof ISSUE_TAGS)[number]

/**
 * Post an adjustment (or internal use) now: the stock moves at today's
 * average cost and R22 in the same commit. Used by the maker's command
 * within limit and by the approval handler (same effects).
 */
export async function postAdjustment(
  tx: Tx,
  adj: Pick<StockAdjustmentRow, "id" | "adjustmentNo" | "locationId" | "reason" | "expenseTag" | "lines" | "note">,
  opts: { preparedBy: Id; approvalId?: Id }
): Promise<{ journalId: Id; lines: StockAdjustmentRow["lines"] }> {
  const today = tx.today()
  const ref = { docType: "stockAdjustments", docId: adj.id, docNo: adj.adjustmentNo }
  const internal = adj.reason === "internal-use"
  const lines: StockAdjustmentRow["lines"] = []
  const ruleLines: { itemId: Id; tag: InventoryTag; valueP: number }[] = []
  const moveIds: Id[] = []
  for (const line of adj.lines) {
    const out = await adjustLine(tx, {
      itemId: line.itemId,
      locationId: adj.locationId,
      batchId: line.batchId,
      qtyBase: line.qtyBase,
      type: internal ? "internal-use" : "adjust",
      ref,
      date: today,
    })
    moveIds.push(...out.moveIds)
    lines.push({ ...line, valueP: out.signedValueP })
    ruleLines.push({ itemId: line.itemId, tag: await tagOfItem(tx, line.itemId), valueP: out.signedValueP })
  }
  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER.R22,
    date: today,
    source: { app: "st", docType: "stockAdjustments", docId: adj.id, docNo: adj.adjustmentNo },
    narration: `${internal ? "Internal use" : "Stock adjustment"} ${adj.adjustmentNo}${adj.note ? `: ${adj.note}` : ""}`,
    lines: linesForStockAdjustment({
      locationId: adj.locationId,
      lines: ruleLines,
      internalUseTag: internal ? (adj.expenseTag ?? "CONSUMABLES_USED") : undefined,
    }),
    rule: "R22",
    preparedBy: opts.preparedBy,
    approvalId: opts.approvalId,
  })
  await linkMoves(tx, moveIds, journal.id)
  tx.emit(internal ? "StockIssued" : "AdjustmentPosted", {
    refs: { adjustmentId: adj.id, journalId: journal.id, approvalId: opts.approvalId },
    params: { no: adj.adjustmentNo, lines: lines.length },
    locationId: adj.locationId,
  })
  return { journalId: journal.id, lines }
}

const adjustmentLine = z.object({
  itemId: z.string(),
  batchId: z.string().optional(),
  qtyBase: z.number().refine((n) => n !== 0, "non-zero"),
})

/** Create an adjustment document: posted within the maker's limit, else pending for st.adjust.approve. */
async function submitAdjustment(
  tx: Tx,
  input: {
    locationId: Id
    reason: StockAdjustmentRow["reason"]
    expenseTag?: ExpenseTag
    note?: string
    lines: { itemId: Id; batchId?: Id; qtyBase: number }[]
  }
) {
  await stockLocation(tx, input.locationId)
  tx.requireLocation(input.locationId)
  const today = tx.today()
  const id = newId("adj")
  const adjustmentNo = await nextDocNo(tx, "ADJ", { location: input.locationId, date: today })
  const values = await previewValues(tx, input.locationId, input.lines)
  const amountP = values.reduce((s, v) => s + Math.abs(v), 0)
  const lines = input.lines.map((l, i) => ({ itemId: l.itemId, batchId: l.batchId || undefined, qtyBase: roundQty(l.qtyBase), valueP: values[i] }))
  const base = {
    id,
    adjustmentNo,
    locationId: input.locationId,
    date: today,
    reason: input.reason,
    expenseTag: input.expenseTag,
    note: input.note || undefined,
    preparedBy: tx.actor.userId,
  }
  const outcome = await requireApproval(tx, {
    kind: "stock-adjust",
    docType: "stockAdjustments",
    docId: id,
    docNo: adjustmentNo,
    locationId: input.locationId,
    amountP,
    reason: input.note,
  })
  if (outcome.status === "pending") {
    tx.insert("stockAdjustments", { ...base, lines, status: "pending-approval", approvalId: outcome.approvalId })
    tx.emit("AdjustmentSubmitted", {
      refs: { adjustmentId: id, approvalId: outcome.approvalId },
      params: { no: adjustmentNo, lines: lines.length },
      locationId: input.locationId,
    })
    return { id, adjustmentNo, status: "pending-approval" as const, amountP }
  }
  const posted = await postAdjustment(tx, { ...base, lines }, { preparedBy: tx.actor.userId })
  tx.insert("stockAdjustments", { ...base, lines: posted.lines, status: "posted", journalId: posted.journalId })
  return { id, adjustmentNo, status: "posted" as const, amountP, journalId: posted.journalId }
}

/**
 * `st.saveAdjustment` (st.adjust.create): damage, expiry and loss take stock
 * out, found brings it in, a correction may do either. Within the maker's
 * `stock-adjust` limit it posts R22 at once, else it waits for
 * st.adjust.approve → AdjustmentSubmitted / AdjustmentPosted.
 */
export const saveAdjustment = defineCommand({
  name: "st.saveAdjustment",
  permission: "st.adjust.create",
  input: z.object({
    locationId: z.string(),
    reason: z.enum(ADJUST_REASONS),
    note: z.string().trim().min(3),
    lines: z.array(adjustmentLine).min(1),
    idempotencyKey: z.string(),
  }),
  async run(tx, input) {
    for (const line of input.lines) {
      if ((input.reason === "damage" || input.reason === "expiry" || input.reason === "loss") && line.qtyBase > 0) {
        tx.reject("ADJUSTMENT_SIGN", { reason: input.reason })
      }
      if (input.reason === "found" && line.qtyBase < 0) tx.reject("ADJUSTMENT_SIGN", { reason: input.reason })
    }
    return submitAdjustment(tx, input)
  },
})

/**
 * `st.recordIssue` (st.adjust.create): internal use at a location (an
 * adjustment of reason internal-use with its expense tag): R22 debits the
 * expense → StockIssued (or AdjustmentSubmitted above the limit).
 */
export const recordIssue = defineCommand({
  name: "st.recordIssue",
  permission: "st.adjust.create",
  input: z.object({
    locationId: z.string(),
    expenseTag: z.enum(ISSUE_TAGS),
    note: z.string().trim().min(3),
    lines: z.array(z.object({ itemId: z.string(), qtyBase: z.number().positive() })).min(1),
    idempotencyKey: z.string(),
  }),
  async run(tx, input) {
    return submitAdjustment(tx, {
      locationId: input.locationId,
      reason: "internal-use",
      expenseTag: input.expenseTag,
      note: input.note,
      lines: input.lines.map((l) => ({ itemId: l.itemId, qtyBase: -l.qtyBase })),
    })
  },
})
