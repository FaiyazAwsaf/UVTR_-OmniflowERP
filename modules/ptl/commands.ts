import { z } from "zod"

import { requireApproval } from "@/core/approvals/approvals"
import { queueEmail } from "@/core/connectors/email"
import { newId } from "@/core/db/ids"
import { getSetting } from "@/core/db/settings"
import type { Id, InventoryTag, PurchaseOrderRow, PurchaseRequisitionRow, VendorBillLineRow, VendorBillRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForPurchaseReturn, RULE_VOUCHER, type LineInput } from "@/core/ledger/rules"
import { issueStock } from "@/core/stock/moves"
import { roundQty } from "@/core/stock/value"
import { percentOf, vatRateOf } from "@/core/tax/vat"
import { linkMoves, tagOfItem } from "@/modules/ic/stock-helpers"

/**
 * PTL Purchase Transactions (Local) commands (plan §6.2, §3.7):
 * requisitions with approval by value, purchase orders (one per vendor;
 * from an approved requisition or direct), sending a PO by simulated email,
 * cancelling, and returns to the vendor with a Mushak 6.8 debit note (R16).
 */

const prLineInput = z.object({
  itemId: z.string(),
  qty: z.number().positive(),
  estUnitCostP: z.number().int().nonnegative(),
  suggestedVendorId: z.string().optional(),
})

const draftInput = z.object({
  prId: z.string().optional(),
  expectedVersion: z.number().int().optional(),
  locationId: z.string(),
  reason: z.enum(["reorder", "job-demand", "manual"]).default("manual"),
  note: z.string().trim().optional(),
  lines: z.array(prLineInput).min(1),
})

/** Create or rewrite a draft requisition (shared by save, submit and IC's reorder PR). */
export async function writeDraftRequisition(
  tx: Tx,
  input: z.output<typeof draftInput>
): Promise<PurchaseRequisitionRow> {
  tx.requireLocation(input.locationId)
  const location = await tx.get("locations", input.locationId)
  if (!location.isStockLocation) tx.reject("NOT_STOCK_LOCATION", { location: location.id })
  for (const line of input.lines) {
    const item = await tx.get("items", line.itemId)
    if (item.status !== "active") tx.reject("ITEM_INACTIVE", { item: item.sku })
  }
  const totalP = input.lines.reduce((s, l) => s + Math.round(l.qty * l.estUnitCostP), 0)
  let pr: PurchaseRequisitionRow
  if (input.prId) {
    const current = await tx.get("purchaseRequisitions", input.prId, { expectedVersion: input.expectedVersion })
    if (current.status !== "draft" && current.status !== "rejected") tx.reject("PR_NOT_DRAFT", { no: current.prNo })
    for (const line of await tx.list("prLines", "prId", current.id)) await tx.remove("prLines", line.id)
    pr = await tx.update("purchaseRequisitions", current.id, {
      locationId: input.locationId,
      reason: input.reason,
      note: input.note || undefined,
      totalP,
      status: "draft",
      approvalId: undefined,
    })
  } else {
    pr = tx.insert("purchaseRequisitions", {
      prNo: await nextDocNo(tx, "PR"),
      locationId: input.locationId,
      requestedBy: tx.actor.userId,
      reason: input.reason,
      status: "draft",
      totalP,
      note: input.note || undefined,
      date: tx.today(),
    })
  }
  for (const line of input.lines) {
    tx.insert("prLines", {
      prId: pr.id,
      itemId: line.itemId,
      qty: line.qty,
      estUnitCostP: line.estUnitCostP,
      suggestedVendorId: line.suggestedVendorId || undefined,
    })
  }
  return pr
}

/** `ptl.saveRequisition` (ptl.pr.create): a draft requisition (new or edited). */
export const saveRequisition = defineCommand({
  name: "ptl.saveRequisition",
  permission: "ptl.pr.create",
  input: draftInput,
  async run(tx, input) {
    const pr = await writeDraftRequisition(tx, input)
    return { id: pr.id, prNo: pr.prNo }
  },
})

/**
 * `ptl.submitRequisition` (ptl.pr.create): within the requester's own
 * `purchase` limit the requisition is approved at once; above it, it waits for
 * an approver holding ptl.pr.approve (never the requester) →
 * RequisitionSubmitted, RequisitionApproved.
 */
export const submitRequisition = defineCommand({
  name: "ptl.submitRequisition",
  permission: "ptl.pr.create",
  input: draftInput.partial({ lines: true, locationId: true }).extend({ idempotencyKey: z.string().optional() }),
  async run(tx, input) {
    let pr: PurchaseRequisitionRow
    if (input.lines && input.locationId) {
      pr = await writeDraftRequisition(tx, { ...input, lines: input.lines, locationId: input.locationId })
    } else {
      if (!input.prId) return tx.reject("PR_NOT_FOUND")
      pr = await tx.get("purchaseRequisitions", input.prId, { expectedVersion: input.expectedVersion })
      tx.requireLocation(pr.locationId)
      if (pr.status !== "draft" && pr.status !== "rejected") tx.reject("PR_NOT_DRAFT", { no: pr.prNo })
    }
    if (!(await tx.list("prLines", "prId", pr.id)).length) tx.reject("PR_EMPTY", { no: pr.prNo })
    const outcome = await requireApproval(tx, {
      kind: "purchase",
      docType: "purchaseRequisitions",
      docId: pr.id,
      docNo: pr.prNo,
      locationId: pr.locationId,
      amountP: pr.totalP,
      reason: pr.note,
    })
    tx.emit("RequisitionSubmitted", { refs: { prId: pr.id }, params: { no: pr.prNo }, locationId: pr.locationId })
    if (outcome.status === "pending") {
      await tx.update("purchaseRequisitions", pr.id, { status: "pending-approval", approvalId: outcome.approvalId })
      return { id: pr.id, prNo: pr.prNo, status: "pending-approval" as const }
    }
    await tx.update("purchaseRequisitions", pr.id, { status: "approved", approvalId: undefined })
    tx.emit("RequisitionApproved", { refs: { prId: pr.id }, params: { no: pr.prNo }, locationId: pr.locationId })
    return { id: pr.id, prNo: pr.prNo, status: "approved" as const }
  },
})

/* ------------------------------------------------------------------ *
 * Purchase orders
 * ------------------------------------------------------------------ */

const poLineInput = z.object({
  itemId: z.string(),
  qty: z.number().positive(),
  unitCostP: z.number().int().nonnegative(),
})

/** The vendor's email for the simulated outbox. */
function vendorEmail(vendor: { email?: string; contacts: { email?: string }[]; code: string }): string {
  return vendor.email ?? vendor.contacts.find((c) => c.email)?.email ?? vendor.code
}

/** Send a PO by simulated email (attachment named, not generated). */
async function sendPoEmail(tx: Tx, po: PurchaseOrderRow): Promise<void> {
  const vendor = await tx.get("parties", po.vendorId)
  queueEmail(tx, {
    to: [vendorEmail(vendor)],
    subjectKey: "ptl.email.poSubject",
    params: { no: po.poNo },
    attachments: [`${po.poNo}.pdf`],
    refs: { poId: po.id, partyId: vendor.id },
  })
  await tx.update("purchaseOrders", po.id, { sentAt: tx.now() })
}

/**
 * `ptl.issuePo` (ptl.po.create): one PO per vendor. From an approved
 * requisition no second approval is needed while the POs' value (VAT
 * exclusive) stays within the requisition's total; a direct PO above the
 * buyer's `purchase` limit waits for ptl.po.approve → PurchaseOrderIssued.
 */
export const issuePo = defineCommand({
  name: "ptl.issuePo",
  permission: "ptl.po.create",
  input: z.object({
    prId: z.string().optional(),
    locationId: z.string(),
    orders: z
      .array(
        z.object({
          vendorId: z.string(),
          expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          lines: z.array(poLineInput).min(1),
        })
      )
      .min(1),
    send: z.boolean().default(false),
    idempotencyKey: z.string(),
  }),
  async run(tx, input) {
    tx.requireLocation(input.locationId)
    const location = await tx.get("locations", input.locationId)
    if (!location.isStockLocation) tx.reject("NOT_STOCK_LOCATION", { location: location.id })
    const tax = await getSetting(tx, "tax")
    const today = tx.today()
    const vendors = new Set<Id>()

    let pr: PurchaseRequisitionRow | undefined
    let headroomP = Infinity
    if (input.prId) {
      pr = await tx.get("purchaseRequisitions", input.prId)
      if (pr.status !== "approved" && pr.status !== "ordered") tx.reject("PR_NOT_APPROVED", { no: pr.prNo })
      const earlier = (await tx.list("purchaseOrders", "prId", pr.id)).filter((p) => p.status !== "cancelled")
      headroomP = pr.totalP - earlier.reduce((s, p) => s + p.subtotalP, 0)
    }

    const created: { id: Id; poNo: string; status: PurchaseOrderRow["status"] }[] = []
    for (const order of input.orders) {
      if (vendors.has(order.vendorId)) tx.reject("PO_ONE_PER_VENDOR")
      vendors.add(order.vendorId)
      const vendor = await tx.get("parties", order.vendorId)
      if (!vendor.isVendor) tx.reject("NOT_A_VENDOR", { party: vendor.nameEn })
      if (vendor.status === "blocked") tx.reject("VENDOR_BLOCKED", { party: vendor.nameEn })
      if (order.expectedDate < today) tx.reject("EXPECTED_DATE_PAST", { date: order.expectedDate })

      const lines = []
      for (const line of order.lines) {
        const item = await tx.get("items", line.itemId)
        if (item.status !== "active") tx.reject("ITEM_INACTIVE", { item: item.sku })
        const netP = Math.round(line.qty * line.unitCostP)
        const vatRatePct = vatRateOf(item.vatCategory, tax)
        lines.push({ ...line, netP, vatRatePct, vatP: percentOf(netP, vatRatePct) })
      }
      const subtotalP = lines.reduce((s, l) => s + l.netP, 0)
      const vatP = lines.reduce((s, l) => s + l.vatP, 0)
      const totalP = subtotalP + vatP
      const poId = newId("po")
      const poNo = await nextDocNo(tx, "PO")

      // A PO within its approved requisition needs no second approval (plan §3.7).
      let status: PurchaseOrderRow["status"] = "issued"
      let approvalId: Id | undefined
      if (pr && subtotalP <= headroomP) {
        headroomP -= subtotalP
      } else {
        const outcome = await requireApproval(tx, {
          kind: "purchase",
          docType: "purchaseOrders",
          docId: poId,
          docNo: poNo,
          locationId: input.locationId,
          amountP: totalP,
          reason: pr ? pr.prNo : undefined,
        })
        if (outcome.status === "pending") {
          status = "pending-approval"
          approvalId = outcome.approvalId
        }
      }
      const po = tx.insert("purchaseOrders", {
        id: poId,
        poNo,
        vendorId: vendor.id,
        locationId: input.locationId,
        prId: pr?.id,
        status,
        orderDate: today,
        expectedDate: order.expectedDate,
        subtotalP,
        vatP,
        totalP,
        approvalId,
        buyerId: tx.actor.userId,
      })
      lines.forEach((l, i) =>
        tx.insert("poLines", {
          poId,
          lineNo: i + 1,
          itemId: l.itemId,
          qty: l.qty,
          unitCostP: l.unitCostP,
          vatRatePct: l.vatRatePct,
          qtyReceived: 0,
          qtyRejected: 0,
          qtyReturned: 0,
          qtyBilled: 0,
        })
      )
      if (status === "issued") {
        tx.emit("PurchaseOrderIssued", { refs: { poId, partyId: vendor.id, prId: pr?.id }, params: { no: poNo, lines: lines.length }, locationId: input.locationId })
        if (input.send) await sendPoEmail(tx, po)
      }
      created.push({ id: poId, poNo, status })
    }
    if (pr) await tx.update("purchaseRequisitions", pr.id, { status: "ordered" })
    return { pos: created }
  },
})

/** `ptl.sendPo` (ptl.po.create): email an issued PO to the vendor (simulated). */
export const sendPo = defineCommand({
  name: "ptl.sendPo",
  permission: "ptl.po.create",
  input: z.object({ poId: z.string(), idempotencyKey: z.string() }),
  async run(tx, input) {
    const po = await tx.get("purchaseOrders", input.poId)
    tx.requireLocation(po.locationId)
    if (po.status !== "issued" && po.status !== "partial") tx.reject("PO_NOT_OPEN", { no: po.poNo })
    await sendPoEmail(tx, po)
    return { sentAt: tx.now() }
  },
})

/**
 * `ptl.cancelPo` (ptl.po.cancel): a PO with nothing received is cancelled (its
 * pending approval withdrawn); a partly received one is closed, its
 * remaining quantities cancelled → PurchaseOrderCancelled.
 */
export const cancelPo = defineCommand({
  name: "ptl.cancelPo",
  permission: "ptl.po.cancel",
  input: z.object({ poId: z.string(), expectedVersion: z.number().int(), reason: z.string().trim().min(3) }),
  async run(tx, input) {
    const po = await tx.get("purchaseOrders", input.poId, { expectedVersion: input.expectedVersion })
    tx.requireLocation(po.locationId)
    if (!["draft", "pending-approval", "issued", "partial"].includes(po.status)) tx.reject("PO_NOT_OPEN", { no: po.poNo })
    const lines = await tx.list("poLines", "poId", po.id)
    const anyReceived = lines.some((l) => l.qtyReceived > 0)
    if (po.status === "pending-approval" && po.approvalId) {
      const approval = await tx.find("approvals", po.approvalId)
      if (approval?.status === "pending") {
        await tx.update("approvals", approval.id, { status: "cancelled", decisionReason: input.reason })
      }
    }
    const status = anyReceived ? "closed" : "cancelled"
    await tx.update("purchaseOrders", po.id, { status, cancelReason: input.reason })
    tx.auditContext({ reason: input.reason })
    tx.emit("PurchaseOrderCancelled", { refs: { poId: po.id, partyId: po.vendorId }, params: { no: po.poNo }, locationId: po.locationId })
    return { status }
  },
})

/** Issue an approved PO (approval handler; the maker's command within limit does the same). */
export async function issueApprovedPo(tx: Tx, po: PurchaseOrderRow, approvalId: Id): Promise<void> {
  await tx.update("purchaseOrders", po.id, { status: "issued", approvalId })
  tx.emit("PurchaseOrderApproved", { refs: { poId: po.id }, params: { no: po.poNo }, locationId: po.locationId })
  const lines = await tx.list("poLines", "poId", po.id)
  tx.emit("PurchaseOrderIssued", { refs: { poId: po.id, partyId: po.vendorId }, params: { no: po.poNo, lines: lines.length }, locationId: po.locationId })
}

/* ------------------------------------------------------------------ *
 * Returns to vendor (R16, Mushak 6.8)
 * ------------------------------------------------------------------ */

type ReturnPart = {
  itemId: Id
  tag: InventoryTag
  stockValueP: number
  priceValueP: number
  vatP: number
}

/**
 * `ptl.returnToVendor` (ptl.return.create): goods accepted on a GRN go back
 * to the vendor. Stock leaves the location at its average cost; the not yet
 * billed part is credited to GRNI at the PO cost, the billed part at the bill
 * price plus its VAT against the bill (AP up to its open amount, the rest an
 * advance to the vendor); the difference goes to PPV (R16). A Mushak 6.8
 * debit note is issued in the same commit → PurchaseReturned, DebitNoteIssued.
 */
export const returnToVendor = defineCommand({
  name: "ptl.returnToVendor",
  permission: "ptl.return.create",
  input: z.object({
    grnId: z.string(),
    reason: z.string().trim().min(3),
    lines: z.array(z.object({ grnLineId: z.string(), qty: z.number().positive() })).min(1),
    idempotencyKey: z.string(),
  }),
  async run(tx, input) {
    const grn = await tx.get("grns", input.grnId)
    tx.requireLocation(grn.locationId)
    const today = tx.today()
    const returnId = newId("prn")
    const returnNo = await nextDocNo(tx, "PRN", { date: today })
    const debitNoteId = newId("dbn")
    const debitNoteNo = await nextDocNo(tx, "DBN", { date: today })
    const ref = { docType: "purchaseReturns", docId: returnId, docNo: returnNo }

    const unbilled: ReturnPart[] = []
    const billed: ReturnPart[] = []
    let unbilledVatP = 0
    let bill: VendorBillRow | undefined
    const moveIds: Id[] = []
    const returnLines = []

    for (const req of input.lines) {
      const line = await tx.get("grnLines", req.grnLineId)
      if (line.grnId !== grn.id) tx.reject("RETURN_WRONG_GRN")
      const item = await tx.get("items", line.itemId)
      const poLine = await tx.get("poLines", line.poLineId)
      const returnable = roundQty(line.qtyAccepted - line.qtyReturned)
      if (req.qty > returnable + 1e-9) tx.reject("RETURN_TOO_MUCH", { item: item.sku, available: returnable, needed: req.qty })
      const tag = await tagOfItem(tx, item.id)

      const qtyBase = roundQty(req.qty * item.purchaseFactor)
      const out = await issueStock(tx, {
        itemId: item.id,
        locationId: grn.locationId,
        qtyBase,
        type: "return-vendor",
        ref,
        date: today,
        preferBatchId: line.batchId,
      })
      moveIds.push(...out.moves.map((m) => m.moveId))

      // The not yet billed part goes first (accepted − billed − returned).
      const unbilledAvail = Math.max(0, roundQty(line.qtyAccepted - line.qtyBilled - line.qtyReturned))
      const u = Math.min(req.qty, unbilledAvail)
      let b = roundQty(req.qty - u)
      let billLine: VendorBillLineRow | undefined
      if (b > 0) {
        // The newest posted bill that billed this GRN line.
        let lineBill: VendorBillRow | undefined
        for (const candidate of await tx.list("vendorBillLines", "grnLineId", line.id)) {
          const candidateBill = await tx.get("vendorBills", candidate.billId)
          if (candidateBill.status === "on-hold") continue
          if (!lineBill || candidateBill.date > lineBill.date) {
            lineBill = candidateBill
            billLine = candidate
          }
        }
        if (!lineBill) b = 0
        else if (bill && bill.id !== lineBill.id) tx.reject("RETURN_MULTIPLE_BILLS")
        else bill = lineBill
      }
      const uQty = roundQty(req.qty - b)
      const stockU = b > 0 ? Math.round((out.valueP * uQty) / req.qty) : out.valueP
      if (uQty > 0) {
        const priceValueP = Math.round(uQty * line.unitCostP)
        unbilled.push({ itemId: item.id, tag, stockValueP: stockU, priceValueP, vatP: 0 })
        unbilledVatP += percentOf(priceValueP, poLine.vatRatePct)
      }
      if (b > 0 && billLine) {
        const priceValueP = Math.round(b * billLine.unitPriceP)
        billed.push({ itemId: item.id, tag, stockValueP: out.valueP - stockU, priceValueP, vatP: percentOf(priceValueP, billLine.vatRatePct) })
      }

      await tx.update("grnLines", line.id, { qtyReturned: roundQty(line.qtyReturned + req.qty) })
      await tx.update("poLines", poLine.id, { qtyReturned: roundQty(poLine.qtyReturned + req.qty) })
      returnLines.push({ grnLineId: line.id, itemId: item.id, batchId: out.moves[0]?.batchId, qtyBase, valueP: out.valueP })
    }

    const lines: LineInput[] = []
    if (unbilled.length) {
      lines.push(...linesForPurchaseReturn({ partyId: grn.vendorId, locationId: grn.locationId, billed: false, lines: unbilled }))
    }
    let toApP = 0
    let billedVatP = 0
    if (billed.length && bill) {
      const apOpenP = bill.totalP - bill.paidP - bill.debitedP
      billedVatP = billed.reduce((s, l) => s + l.vatP, 0)
      const due = billed.reduce((s, l) => s + l.priceValueP, 0) + (bill.hasMushak63 ? billedVatP : 0)
      toApP = Math.min(due, Math.max(0, apOpenP))
      lines.push(
        ...linesForPurchaseReturn({
          partyId: grn.vendorId,
          locationId: grn.locationId,
          billed: true,
          lines: billed,
          apOpenP,
          vatClaimed: bill.hasMushak63,
        })
      )
    }
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R16,
      date: today,
      source: { app: "ptl", docType: "purchaseReturns", docId: returnId, docNo: returnNo },
      narration: `Purchase return ${returnNo} (${grn.grnNo}): ${input.reason}`,
      lines,
      rule: "R16",
    })
    await linkMoves(tx, moveIds, journal.id)
    if (bill && toApP > 0) {
      const debitedP = bill.debitedP + toApP
      await tx.update("vendorBills", bill.id, {
        debitedP,
        status: bill.paidP + debitedP >= bill.totalP ? "paid" : bill.status,
      })
    }

    const netP = [...unbilled, ...billed].reduce((s, l) => s + l.priceValueP, 0)
    const vatP = unbilledVatP + billedVatP
    tx.insert("debitNotes", {
      id: debitNoteId,
      debitNoteNo,
      billId: bill?.id,
      partyId: grn.vendorId,
      date: today,
      reason: input.reason,
      netP,
      vatP,
      totalP: netP + vatP,
      purchaseReturnId: returnId,
      journalId: journal.id,
    })
    tx.insert("purchaseReturns", {
      id: returnId,
      returnNo,
      vendorId: grn.vendorId,
      grnId: grn.id,
      locationId: grn.locationId,
      date: today,
      reason: input.reason,
      lines: returnLines,
      billId: bill?.id,
      debitNoteId,
      journalId: journal.id,
    })
    const refs = { purchaseReturnId: returnId, debitNoteId, grnId: grn.id, poId: grn.poId, partyId: grn.vendorId, journalId: journal.id }
    tx.emit("PurchaseReturned", { refs, params: { no: returnNo }, locationId: grn.locationId })
    tx.emit("DebitNoteIssued", { refs, params: { no: debitNoteNo }, locationId: grn.locationId })
    return { id: returnId, returnNo, debitNoteId, debitNoteNo, journalId: journal.id }
  },
})
