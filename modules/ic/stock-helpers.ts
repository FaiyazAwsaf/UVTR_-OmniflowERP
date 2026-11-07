import type { DocRef, ISODate, Id, InventoryTag, Poisha } from "@/core/db/schema"
import { stockBalanceId, stockValueId } from "@/core/db/tables"
import type { Tx } from "@/core/engine/types"
import { adjustStock, inventoryTagOf, onHand, watchReorder } from "@/core/stock/moves"
import { issueValue, roundQty, standardValue } from "@/core/stock/value"

/**
 * Stock helpers shared by the SCM commands (ST adjustments and internal use,
 * IC counts, PTL returns). They only combine the core stock helpers
 * (core/stock/moves.ts); every write goes through the command's `tx`.
 */

/** The inventory GL tag of an item by id. */
export async function tagOfItem(tx: Tx, itemId: Id): Promise<InventoryTag> {
  return inventoryTagOf(tx, await tx.get("items", itemId))
}

/** Link the stock moves of a document to the journal it posted (`stockMoves.journalId` is mutable). */
export async function linkMoves(tx: Tx, moveIds: Id[], journalId: Id): Promise<void> {
  for (const id of moveIds) await tx.update("stockMoves", id, { journalId })
}

/** Whether a batch can be issued on a day (status ok and not expired). */
async function batchUsable(tx: Tx, batchId: Id, on: ISODate): Promise<boolean> {
  const batch = await tx.find("batches", batchId)
  if (!batch) return false
  return batch.status === "ok" && (!batch.expiry || batch.expiry >= on)
}

/**
 * Write off part of one batch whatever its status (an expired or blocked
 * batch, which FEFO would skip): the same math as `issueStock` (plan §3.5),
 * the issue that empties the location taking exactly the remaining value.
 * TODO(main): replace with an `includeUnusable` option on core `issueStock`.
 */
async function writeOffBatch(
  tx: Tx,
  input: { itemId: Id; locationId: Id; batchId: Id; qtyBase: number; type: "adjust" | "count-variance"; ref: DocRef; date: ISODate }
): Promise<{ valueP: Poisha; moveId: Id }> {
  const item = await tx.get("items", input.itemId)
  const balanceId = stockBalanceId(input.itemId, input.locationId, input.batchId)
  const balance = await tx.find("stockBalances", balanceId)
  if (!balance || balance.qtyBase + 1e-9 < input.qtyBase) {
    tx.reject("STOCK_NEGATIVE", {
      item: item.sku,
      location: input.locationId,
      available: roundQty(balance?.qtyBase ?? 0),
      needed: input.qtyBase,
    })
  }
  const valueId = stockValueId(input.itemId, input.locationId)
  const current = await tx.find("stockValues", valueId)
  const qty = current?.qtyBase ?? 0
  const value = current?.valueP ?? 0
  const taken = issueValue(input.qtyBase, qty, value)
  await tx.upsert("stockValues", {
    id: valueId,
    itemId: input.itemId,
    locationId: input.locationId,
    qtyBase: roundQty(qty - input.qtyBase),
    valueP: value - taken,
  })
  await tx.upsert("stockBalances", {
    id: balanceId,
    itemId: input.itemId,
    locationId: input.locationId,
    batchId: input.batchId,
    qtyBase: roundQty(balance.qtyBase - input.qtyBase),
    quarantinedQty: balance.quarantinedQty,
  })
  const move = tx.insert("stockMoves", {
    itemId: input.itemId,
    locationId: input.locationId,
    batchId: input.batchId,
    type: input.type,
    qtyBase: -roundQty(input.qtyBase),
    valueP: -taken,
    ref: input.ref,
    at: tx.now(),
    date: input.date,
  })
  await watchReorder(tx, item, input.locationId, qty, qty - input.qtyBase)
  return { valueP: taken, moveId: move.id }
}

/**
 * Adjust one line by a signed base quantity (R22 takes the returned signed
 * value): a loss of a named batch that FEFO cannot issue (expired) is written
 * off from that batch; everything else goes through core `adjustStock`.
 */
export async function adjustLine(
  tx: Tx,
  input: {
    itemId: Id
    locationId: Id
    batchId?: Id
    qtyBase: number
    type: "adjust" | "count-variance" | "internal-use"
    ref: DocRef
    date: ISODate
  }
): Promise<{ signedValueP: Poisha; moveIds: Id[] }> {
  if (input.qtyBase < 0 && input.batchId && input.type !== "internal-use" && !(await batchUsable(tx, input.batchId, input.date))) {
    const out = await writeOffBatch(tx, { ...input, batchId: input.batchId, qtyBase: -input.qtyBase, type: input.type })
    return { signedValueP: -out.valueP, moveIds: [out.moveId] }
  }
  const out = await adjustStock(tx, input)
  return { signedValueP: out.signedValueP, moveIds: out.moves.map((m) => m.moveId) }
}

/**
 * The value a set of signed adjustments would move now, line by line in
 * order (each line sees the previous ones): losses at the location's
 * average, gains at the average or at standard cost when the location holds
 * none (R22). Used for approval amounts and previews; posting recomputes.
 */
export async function previewValues(
  tx: Tx,
  locationId: Id,
  lines: { itemId: Id; qtyBase: number }[]
): Promise<Poisha[]> {
  const state = new Map<Id, { qty: number; value: number }>()
  const out: Poisha[] = []
  for (const line of lines) {
    if (!state.has(line.itemId)) {
      const held = await onHand(tx, line.itemId, locationId)
      state.set(line.itemId, { qty: held.qtyBase, value: held.valueP })
    }
    const s = state.get(line.itemId)!
    if (line.qtyBase < 0) {
      const taken = issueValue(-line.qtyBase, s.qty, s.value)
      s.qty -= -line.qtyBase
      s.value -= taken
      out.push(-taken)
    } else {
      const item = await tx.get("items", line.itemId)
      const added = s.qty > 0 ? Math.round((line.qtyBase * s.value) / s.qty) : standardValue(item, line.qtyBase)
      s.qty += line.qtyBase
      s.value += added
      out.push(added)
    }
  }
  return out
}

/** Sum valued lines by item (journal lines per item, as the seed posts them). */
export function byItem<T extends { itemId: Id; tag: InventoryTag; valueP: Poisha }>(lines: T[]): { itemId: Id; tag: InventoryTag; valueP: Poisha }[] {
  const out = new Map<Id, { itemId: Id; tag: InventoryTag; valueP: Poisha }>()
  for (const l of lines) {
    const row = out.get(l.itemId) ?? { itemId: l.itemId, tag: l.tag, valueP: 0 }
    row.valueP += l.valueP
    out.set(l.itemId, row)
  }
  return [...out.values()]
}
