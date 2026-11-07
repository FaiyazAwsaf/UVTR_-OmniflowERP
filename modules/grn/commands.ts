import { z } from "zod"

import { newId } from "@/core/db/ids"
import type { GrnLineRow, Id, InventoryTag, PoLineRow, PurchaseOrderRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { NewRow, Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForGoodsAccepted, RULE_VOUCHER } from "@/core/ledger/rules"
import { acceptQuarantined, quarantineLot, receiveStock, returnQuarantined } from "@/core/stock/moves"
import { receiptValue, roundQty } from "@/core/stock/value"
import { byItem, linkMoves, tagOfItem } from "@/modules/ic/stock-helpers"

/**
 * GRN Goods Receive Note commands (plan §6.2): receive against a PO with
 * lots (batch, expiry), accepted and rejected quantities with a QC reason
 * and quarantine; accepted stock comes in at the PO cost with R12 (Dr
 * inventory, Cr GRNI) in the same commit; quarantined lots carry no value
 * until accepted (R12 then) or returned to the vendor (nothing posts).
 */

/** Quantities of a PO line (purchase units): accepted, held in quarantine, still open. */
export function poLineProgress(line: PoLineRow, heldQty: number) {
  const accepted = roundQty(line.qtyReceived - line.qtyRejected)
  return {
    accepted,
    held: heldQty,
    /** Ordered but not accepted (includes what quarantine still holds) */
    pending: Math.max(0, roundQty(line.qty - accepted)),
    /** What can still be delivered: not accepted and not held */
    open: Math.max(0, roundQty(line.qty - accepted - heldQty)),
  }
}

/** Purchase units held in quarantine per PO line. */
export async function heldByPoLine(tx: Tx, poLineIds: Id[]): Promise<Map<Id, number>> {
  const out = new Map<Id, number>()
  for (const id of poLineIds) {
    const lines = await tx.list("grnLines", "poLineId", id)
    out.set(
      id,
      lines.filter((l) => l.quarantineStatus === "held").reduce((s, l) => s + l.qtyRejected, 0)
    )
  }
  return out
}

/** A PO's status from its lines: received when every line is fully accepted. */
async function refreshPoStatus(tx: Tx, po: PurchaseOrderRow): Promise<PurchaseOrderRow["status"]> {
  const lines = await tx.list("poLines", "poId", po.id)
  const done = lines.every((l) => roundQty(l.qtyReceived - l.qtyRejected) >= l.qty - 1e-9)
  const any = lines.some((l) => l.qtyReceived > 0)
  const status = done ? "received" : any ? "partial" : po.status
  if (status !== po.status) await tx.update("purchaseOrders", po.id, { status })
  return status
}

const lotInput = z.object({
  poLineId: z.string(),
  qtyAccepted: z.number().nonnegative(),
  qtyRejected: z.number().nonnegative().default(0),
  rejectReason: z.enum(["damaged", "short-expiry", "wrong-item", "other"]).optional(),
  quarantine: z.boolean().default(true),
  batchNo: z.string().trim().optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/**
 * `grn.receive` (grn.receive.create): a GRN against an issued or partly
 * received PO. One GRN line per lot; accepted stock received at the PO cost
 * (average updated) with R12; rejected lots held in quarantine without value
 * (or refused at the door); the PO becomes partial or received →
 * GoodsReceived, LotQuarantined.
 */
export const receiveGoods = defineCommand({
  name: "grn.receive",
  permission: "grn.receive.create",
  input: z.object({
    poId: z.string(),
    expectedVersion: z.number().int(),
    vendorChallanNo: z.string().trim().optional(),
    note: z.string().trim().optional(),
    lots: z.array(lotInput).min(1),
    idempotencyKey: z.string(),
  }),
  async run(tx, input) {
    const po = await tx.get("purchaseOrders", input.poId, { expectedVersion: input.expectedVersion })
    tx.requireLocation(po.locationId)
    if (po.status !== "issued" && po.status !== "partial") tx.reject("PO_NOT_OPEN", { no: po.poNo })
    const today = tx.today()
    const poLines = await tx.list("poLines", "poId", po.id)
    const held = await heldByPoLine(tx, poLines.map((l) => l.id))

    const lots = input.lots.filter((l) => l.qtyAccepted > 0 || l.qtyRejected > 0)
    if (!lots.length) tx.reject("GRN_EMPTY")

    // Quantities per PO line never exceed what is still open.
    const asked = new Map<Id, number>()
    for (const lot of lots) asked.set(lot.poLineId, roundQty((asked.get(lot.poLineId) ?? 0) + lot.qtyAccepted + lot.qtyRejected))
    for (const [poLineId, qty] of asked) {
      const line = poLines.find((l) => l.id === poLineId)
      if (!line) return tx.reject("GRN_WRONG_LINE")
      const item = await tx.get("items", line.itemId)
      const open = poLineProgress(line, held.get(line.id) ?? 0).open
      if (qty > open + 1e-9) tx.reject("OVER_RECEIPT", { item: item.sku, open, received: qty })
    }

    const grnId = newId("grn")
    const grnNo = await nextDocNo(tx, "GRN", { location: po.locationId, date: today })
    const ref = { docType: "grns", docId: grnId, docNo: grnNo }
    const valued: { itemId: Id; tag: InventoryTag; valueP: number }[] = []
    const moveIds: Id[] = []
    const rows: (NewRow<"grnLines"> & { id: Id })[] = []
    let acceptedUnits = 0

    for (const lot of lots) {
      const poLine = poLines.find((l) => l.id === lot.poLineId)!
      const item = await tx.get("items", poLine.itemId)
      if (lot.qtyRejected > 0 && !lot.rejectReason) tx.reject("REJECT_REASON_REQUIRED", { item: item.sku })
      const batchNo = lot.batchNo?.toUpperCase()
      if (item.trackBatch && !batchNo) tx.reject("BATCH_REQUIRED", { item: item.sku })
      if (item.trackBatch && item.shelfLifeDays && !lot.expiry) tx.reject("EXPIRY_REQUIRED", { item: item.sku })
      if (lot.qtyAccepted > 0 && lot.expiry && lot.expiry < today) tx.reject("EXPIRY_PAST", { item: item.sku, date: lot.expiry })

      const lineId = newId("grnl")
      let batchId: Id | undefined
      if (lot.qtyAccepted > 0) {
        const valueP = receiptValue(lot.qtyAccepted, poLine.unitCostP)
        const out = await receiveStock(tx, {
          itemId: item.id,
          locationId: po.locationId,
          qtyBase: roundQty(lot.qtyAccepted * item.purchaseFactor),
          valueP,
          type: "grn",
          ref,
          date: today,
          batch: batchNo ? { batchNo, expiry: lot.expiry, grnLineId: lineId } : undefined,
        })
        batchId = out.batchId
        moveIds.push(...out.moves.map((m) => m.moveId))
        valued.push({ itemId: item.id, tag: await tagOfItem(tx, item.id), valueP })
        acceptedUnits += lot.qtyAccepted
      }
      const quarantine = lot.qtyRejected > 0 && lot.quarantine
      if (quarantine) {
        const q = await quarantineLot(tx, {
          itemId: item.id,
          locationId: po.locationId,
          qtyBase: roundQty(lot.qtyRejected * item.purchaseFactor),
          batch: { batchNo: `${batchNo ? `${batchNo}-` : ""}QC-${grnNo.split("-").pop()}-${rows.length + 1}`, expiry: lot.expiry, grnLineId: lineId },
          ref,
          date: today,
        })
        batchId = batchId ?? q.batchId
        tx.emit("LotQuarantined", {
          refs: { grnId, poId: po.id, itemId: item.id, batchId: q.batchId },
          params: { no: grnNo, sku: item.sku, qty: lot.qtyRejected },
          locationId: po.locationId,
        })
      }
      rows.push({
        id: lineId,
        grnId,
        poLineId: poLine.id,
        itemId: item.id,
        batchNo,
        expiry: lot.expiry,
        qtyReceived: roundQty(lot.qtyAccepted + lot.qtyRejected),
        qtyAccepted: lot.qtyAccepted,
        qtyRejected: lot.qtyRejected,
        qtyReturned: 0,
        qtyBilled: 0,
        rejectReason: lot.qtyRejected > 0 ? lot.rejectReason : undefined,
        quarantine,
        quarantineStatus: quarantine ? "held" : undefined,
        batchId,
        unitCostP: poLine.unitCostP,
      })
      await tx.update("poLines", poLine.id, {
        qtyReceived: roundQty(poLine.qtyReceived + lot.qtyAccepted + lot.qtyRejected),
        qtyRejected: roundQty(poLine.qtyRejected + lot.qtyRejected),
      })
      poLine.qtyReceived = roundQty(poLine.qtyReceived + lot.qtyAccepted + lot.qtyRejected)
      poLine.qtyRejected = roundQty(poLine.qtyRejected + lot.qtyRejected)
    }

    let journalId: Id | undefined
    if (valued.length) {
      const journal = await postJournal(tx, {
        voucherType: RULE_VOUCHER.R12,
        date: today,
        source: { app: "grn", docType: "grns", docId: grnId, docNo: grnNo },
        narration: `Goods received, ${grnNo} (${po.poNo})`,
        lines: linesForGoodsAccepted({ partyId: po.vendorId, locationId: po.locationId, lines: byItem(valued) }),
        rule: "R12",
      })
      journalId = journal.id
      await linkMoves(tx, moveIds, journal.id)
    }
    tx.insert("grns", {
      id: grnId,
      grnNo,
      poId: po.id,
      vendorId: po.vendorId,
      locationId: po.locationId,
      vendorChallanNo: input.vendorChallanNo || undefined,
      receivedBy: tx.actor.userId,
      receivedAt: tx.now(),
      date: today,
      note: input.note || undefined,
      journalId,
    })
    for (const row of rows) tx.insert("grnLines", row)
    const status = await refreshPoStatus(tx, po)
    tx.emit("GoodsReceived", {
      refs: { grnId, poId: po.id, partyId: po.vendorId, journalId },
      params: { no: grnNo, accepted: acceptedUnits },
      locationId: po.locationId,
    })
    return { id: grnId, grnNo, journalId, poStatus: status }
  },
})

/** The quarantine batch of a held GRN line. */
async function quarantineBatch(tx: Tx, line: GrnLineRow): Promise<Id> {
  const batches = await tx.list("batches", "itemId", line.itemId)
  const batch = batches.find((b) => b.grnLineId === line.id && b.status === "quarantine")
  if (!batch) tx.reject("QUARANTINE_NOT_HELD")
  return batch.id
}

async function heldLine(tx: Tx, grnLineId: Id, expectedVersion?: number) {
  const line = await tx.get("grnLines", grnLineId, { expectedVersion })
  if (line.quarantineStatus !== "held") tx.reject("QUARANTINE_NOT_HELD")
  const grn = await tx.get("grns", line.grnId)
  tx.requireLocation(grn.locationId)
  const item = await tx.get("items", line.itemId)
  return { line, grn, item, batchId: await quarantineBatch(tx, line) }
}

/**
 * `grn.acceptQuarantine` (grn.quarantine.decide): a held lot passes QC after
 * all: it enters usable stock at the PO cost with R12 and counts as accepted
 * on the GRN and the PO → QuarantineAccepted.
 */
export const acceptQuarantine = defineCommand({
  name: "grn.acceptQuarantine",
  permission: "grn.quarantine.decide",
  input: z.object({ grnLineId: z.string(), expectedVersion: z.number().int().optional(), note: z.string().trim().optional() }),
  async run(tx, input) {
    const { line, grn, item, batchId } = await heldLine(tx, input.grnLineId, input.expectedVersion)
    const today = tx.today()
    const batch = await tx.get("batches", batchId)
    if (batch.expiry && batch.expiry < today) tx.reject("EXPIRY_PAST", { item: item.sku, date: batch.expiry })
    const valueP = receiptValue(line.qtyRejected, line.unitCostP)
    const ref = { docType: "grns", docId: grn.id, docNo: grn.grnNo }
    const out = await acceptQuarantined(tx, {
      itemId: item.id,
      locationId: grn.locationId,
      batchId,
      qtyBase: roundQty(line.qtyRejected * item.purchaseFactor),
      valueP,
      ref,
      date: today,
    })
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R12,
      date: today,
      source: { app: "grn", docType: "grns", docId: grn.id, docNo: grn.grnNo },
      narration: `Quarantine accepted, ${grn.grnNo} (${item.sku})`,
      lines: linesForGoodsAccepted({
        partyId: grn.vendorId,
        locationId: grn.locationId,
        lines: [{ itemId: item.id, tag: await tagOfItem(tx, item.id), valueP }],
      }),
      rule: "R12",
    })
    await linkMoves(tx, out.moves.map((m) => m.moveId), journal.id)
    await tx.update("grnLines", line.id, {
      qtyAccepted: roundQty(line.qtyAccepted + line.qtyRejected),
      quarantineStatus: "accepted",
    })
    const poLine = await tx.get("poLines", line.poLineId)
    await tx.update("poLines", poLine.id, { qtyRejected: Math.max(0, roundQty(poLine.qtyRejected - line.qtyRejected)) })
    await refreshPoStatus(tx, await tx.get("purchaseOrders", grn.poId))
    if (input.note) tx.auditContext({ reason: input.note })
    tx.emit("QuarantineAccepted", {
      refs: { grnId: grn.id, poId: grn.poId, itemId: item.id, batchId, journalId: journal.id },
      params: { no: grn.grnNo, sku: item.sku, qty: line.qtyRejected },
      locationId: grn.locationId,
    })
    return { journalId: journal.id }
  },
})

/**
 * `grn.returnRejected` (grn.quarantine.decide): a held lot goes back to the
 * vendor; the held quantity clears and nothing posts → QuarantineReturned.
 */
export const returnRejected = defineCommand({
  name: "grn.returnRejected",
  permission: "grn.quarantine.decide",
  input: z.object({ grnLineId: z.string(), expectedVersion: z.number().int().optional(), note: z.string().trim().optional() }),
  async run(tx, input) {
    const { line, grn, item, batchId } = await heldLine(tx, input.grnLineId, input.expectedVersion)
    await returnQuarantined(tx, {
      itemId: item.id,
      locationId: grn.locationId,
      batchId,
      qtyBase: roundQty(line.qtyRejected * item.purchaseFactor),
      ref: { docType: "grns", docId: grn.id, docNo: grn.grnNo },
      date: tx.today(),
    })
    await tx.update("grnLines", line.id, { quarantineStatus: "returned" })
    if (input.note) tx.auditContext({ reason: input.note })
    tx.emit("QuarantineReturned", {
      refs: { grnId: grn.id, poId: grn.poId, itemId: item.id, batchId },
      params: { no: grn.grnNo, sku: item.sku, qty: line.qtyRejected },
      locationId: grn.locationId,
    })
    return { ok: true }
  },
})
