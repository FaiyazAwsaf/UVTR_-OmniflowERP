import type { OmniflowDb } from "@/core/db/database"
import type { GrnLineRow, GrnRow, Id, ItemRow, PoLineRow, PurchaseOrderRow, VendorBillRow } from "@/core/db/schema"

/**
 * AP read-side queries: the GRN lines a vendor's next bill may cover (with
 * the quantity still to bill), and the quantities held on bills on hold.
 */

/** Quantity per GRN line held on a vendor's bills that are on hold (a rejected release frees it). */
export async function heldByGrnLine(db: OmniflowDb, vendorId: Id, exceptBillId?: Id): Promise<Map<Id, number>> {
  const bills = (await db.vendorBills.where("partyId").equals(vendorId).toArray()).filter((b) => b.status === "on-hold" && b.id !== exceptBillId)
  const out = new Map<Id, number>()
  for (const bill of bills) {
    if (bill.holdApprovalId) {
      const approval = await db.approvals.get(bill.holdApprovalId)
      if (approval?.status === "rejected") continue
    }
    for (const l of await db.vendorBillLines.where("billId").equals(bill.id).toArray()) {
      if (l.grnLineId) out.set(l.grnLineId, (out.get(l.grnLineId) ?? 0) + l.qty)
    }
  }
  return out
}

export type BillableLine = {
  grnLine: GrnLineRow
  grn: GrnRow
  poLine: PoLineRow | undefined
  po: PurchaseOrderRow | undefined
  item: ItemRow | undefined
  heldQty: number
  /** Accepted − returned − billed − held (purchase units) */
  availableQty: number
}

/** GRN lines of a vendor with something accepted and not yet billed. */
export async function billableLines(db: OmniflowDb, vendorId: Id): Promise<BillableLine[]> {
  const grns = await db.grns.where("vendorId").equals(vendorId).toArray()
  const held = await heldByGrnLine(db, vendorId)
  const out: BillableLine[] = []
  for (const grn of grns.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const lines = await db.grnLines.where("grnId").equals(grn.id).toArray()
    for (const grnLine of lines) {
      const h = held.get(grnLine.id) ?? 0
      const availableQty = Math.max(0, grnLine.qtyAccepted - grnLine.qtyReturned - grnLine.qtyBilled - h)
      if (availableQty <= 0 && h <= 0) continue
      out.push({ grnLine, grn, poLine: undefined, po: undefined, item: undefined, heldQty: h, availableQty })
    }
  }
  const poLines = new Map((await db.poLines.bulkGet([...new Set(out.map((l) => l.grnLine.poLineId))])).filter(Boolean).map((p) => [p!.id, p!]))
  const pos = new Map((await db.purchaseOrders.bulkGet([...new Set(out.map((l) => l.grn.poId))])).filter(Boolean).map((p) => [p!.id, p!]))
  const items = new Map((await db.items.bulkGet([...new Set(out.map((l) => l.grnLine.itemId))])).filter(Boolean).map((i) => [i!.id, i!]))
  for (const l of out) {
    l.poLine = poLines.get(l.grnLine.poLineId)
    l.po = pos.get(l.grn.poId)
    l.item = items.get(l.grnLine.itemId)
  }
  return out
}

/** Amounts reserved per bill by payments waiting for approval. */
export async function reservedByBill(db: OmniflowDb, vendorId: Id): Promise<Map<Id, number>> {
  const pending = (await db.vendorPayments.where("partyId").equals(vendorId).toArray()).filter((p) => p.status === "pending-approval")
  const out = new Map<Id, number>()
  for (const p of pending) for (const a of p.allocations) out.set(a.billId, (out.get(a.billId) ?? 0) + a.amountP)
  return out
}

export type { VendorBillRow }
