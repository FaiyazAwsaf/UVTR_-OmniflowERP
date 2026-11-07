import type {
  DocRef,
  ISODate,
  Id,
  InventoryTag,
  ItemRow,
  Poisha,
  StockBalanceRow,
  StockMoveType,
} from "@/core/db/schema"
import { stockBalanceId, stockValueId } from "@/core/db/tables"
import type { Tx } from "@/core/engine/types"

import { allocateFefo, type BalanceWithBatch } from "./fefo"
import { issueValue, roundQty, standardValue } from "./value"

/**
 * Stock helpers (plan §3.5). Each writes `stockBalances` (quantities per
 * item, location and batch, for FEFO), `stockValues` (the authoritative value
 * per item and location) and `stockMoves`, and returns the value moved, which
 * the caller passes to its posting rule (R4, R5, R12, R16, R20 to R22).
 */

export type MoveResult = {
  /** Total value moved (always positive) */
  valueP: Poisha
  moves: { moveId: Id; batchId?: Id; qtyBase: number; valueP: Poisha }[]
}

/** The inventory GL tag of an item (its category's tag). */
export async function inventoryTagOf(tx: Tx, item: ItemRow): Promise<InventoryTag> {
  const category = await tx.get("itemCategories", item.categoryId)
  return category.inventoryTag
}

async function valueRow(tx: Tx, itemId: Id, locationId: Id) {
  return tx.find("stockValues", stockValueId(itemId, locationId))
}

async function setValue(tx: Tx, itemId: Id, locationId: Id, qtyBase: number, valueP: Poisha) {
  await tx.upsert("stockValues", { id: stockValueId(itemId, locationId), itemId, locationId, qtyBase: roundQty(qtyBase), valueP })
}

async function bumpBalance(
  tx: Tx,
  itemId: Id,
  locationId: Id,
  batchId: Id | undefined,
  delta: { qty?: number; quarantined?: number }
): Promise<StockBalanceRow> {
  const id = stockBalanceId(itemId, locationId, batchId)
  const current = await tx.find("stockBalances", id)
  const qtyBase = roundQty((current?.qtyBase ?? 0) + (delta.qty ?? 0))
  const quarantinedQty = roundQty((current?.quarantinedQty ?? 0) + (delta.quarantined ?? 0))
  return tx.upsert("stockBalances", {
    id,
    itemId,
    locationId,
    batchId,
    qtyBase,
    quarantinedQty,
  })
}

function move(
  tx: Tx,
  m: { itemId: Id; locationId: Id; batchId?: Id; type: StockMoveType; qtyBase: number; valueP: Poisha; ref: DocRef; date: ISODate }
) {
  return tx.insert("stockMoves", { ...m, qtyBase: roundQty(m.qtyBase), at: tx.now() })
}

/** Usable (and other) balances of an item at a location, with their batches. */
export async function balancesAt(tx: Tx, itemId: Id, locationId: Id): Promise<BalanceWithBatch[]> {
  const balances = await tx.list("stockBalances", "[itemId+locationId]", [itemId, locationId])
  const out: BalanceWithBatch[] = []
  for (const balance of balances) {
    out.push({ balance, batch: balance.batchId ? await tx.find("batches", balance.batchId) : undefined })
  }
  return out
}

export type BatchInput = { batchNo: string; expiry?: ISODate; grnLineId?: Id }

/** Find or create the batch row for an item and batch number. */
export async function ensureBatch(tx: Tx, itemId: Id, batch: BatchInput, status: "ok" | "quarantine" = "ok"): Promise<Id> {
  const [existing] = await tx.list("batches", "[itemId+batchNo]", [itemId, batch.batchNo])
  if (existing) return existing.id
  return tx.insert("batches", {
    itemId,
    batchNo: batch.batchNo,
    expiry: batch.expiry,
    receivedAt: tx.now(),
    grnLineId: batch.grnLineId,
    status,
  }).id
}

/**
 * Receive usable stock: adds its quantity and its value (accepted qty × unit
 * cost, or the value it carries for transfers in and customer returns).
 */
export async function receiveStock(
  tx: Tx,
  input: {
    itemId: Id
    locationId: Id
    qtyBase: number
    valueP: Poisha
    type: StockMoveType
    ref: DocRef
    date?: ISODate
    batchId?: Id
    batch?: BatchInput
  }
): Promise<MoveResult & { batchId?: Id }> {
  const batchId = input.batchId ?? (input.batch ? await ensureBatch(tx, input.itemId, input.batch) : undefined)
  await bumpBalance(tx, input.itemId, input.locationId, batchId, { qty: input.qtyBase })
  const current = await valueRow(tx, input.itemId, input.locationId)
  await setValue(tx, input.itemId, input.locationId, (current?.qtyBase ?? 0) + input.qtyBase, (current?.valueP ?? 0) + input.valueP)
  const row = move(tx, {
    itemId: input.itemId,
    locationId: input.locationId,
    batchId,
    type: input.type,
    qtyBase: input.qtyBase,
    valueP: input.valueP,
    ref: input.ref,
    date: input.date ?? tx.today(),
  })
  return { valueP: input.valueP, batchId, moves: [{ moveId: row.id, batchId, qtyBase: input.qtyBase, valueP: input.valueP }] }
}

/**
 * Issue `qtyBase` FEFO over usable batches (or a preferred batch first) at
 * the location's average cost; the issue that empties the location takes
 * exactly the remaining value. Refuses STOCK_NEGATIVE when short.
 */
export async function issueStock(
  tx: Tx,
  input: {
    itemId: Id
    locationId: Id
    qtyBase: number
    type: StockMoveType
    ref: DocRef
    date?: ISODate
    preferBatchId?: Id
    /** Issue only from this batch (quarantine returns, adjustments of a batch) */
    onlyBatchId?: Id
  }
): Promise<MoveResult> {
  const date = input.date ?? tx.today()
  const item = await tx.get("items", input.itemId)
  let entries = await balancesAt(tx, input.itemId, input.locationId)
  if (input.onlyBatchId) entries = entries.filter((e) => e.balance.batchId === input.onlyBatchId)
  const { allocations, short } = allocateFefo(entries, input.qtyBase, date, input.preferBatchId)
  if (short > 1e-9) {
    const available = roundQty(input.qtyBase - short)
    tx.reject("STOCK_NEGATIVE", {
      item: item.sku,
      location: input.locationId,
      available,
      needed: input.qtyBase,
    })
  }
  const current = await valueRow(tx, input.itemId, input.locationId)
  const onHandQty = current?.qtyBase ?? 0
  const onHandValue = current?.valueP ?? 0
  const total = issueValue(input.qtyBase, onHandQty, onHandValue)
  await setValue(tx, input.itemId, input.locationId, onHandQty - input.qtyBase, onHandValue - total)

  const out: MoveResult = { valueP: total, moves: [] }
  let used = 0
  for (const [i, alloc] of allocations.entries()) {
    const last = i === allocations.length - 1
    const share = last ? total - used : Math.round((alloc.qty * total) / input.qtyBase)
    used += share
    await bumpBalance(tx, input.itemId, input.locationId, alloc.batchId, { qty: -alloc.qty })
    const row = move(tx, {
      itemId: input.itemId,
      locationId: input.locationId,
      batchId: alloc.batchId,
      type: input.type,
      qtyBase: -alloc.qty,
      valueP: -share,
      ref: input.ref,
      date,
    })
    out.moves.push({ moveId: row.id, batchId: alloc.batchId, qtyBase: alloc.qty, valueP: share })
  }
  await watchReorder(tx, item, input.locationId, onHandQty, onHandQty - input.qtyBase)
  return out
}

/** Transfer out: issue at the source's average cost (R20 takes the value). */
export function transferOut(
  tx: Tx,
  input: { itemId: Id; locationId: Id; qtyBase: number; ref: DocRef; date?: ISODate; preferBatchId?: Id }
): Promise<MoveResult> {
  return issueStock(tx, { ...input, type: "transfer-out" })
}

/** Transfer in: receive at the value the transfer carried (R21). */
export function transferIn(
  tx: Tx,
  input: { itemId: Id; locationId: Id; qtyBase: number; valueP: Poisha; ref: DocRef; date?: ISODate; batchId?: Id }
): Promise<MoveResult> {
  return receiveStock(tx, { ...input, type: "transfer-in" })
}

/**
 * Adjust stock by a signed quantity (damage, loss, found, count variance,
 * internal use): a loss issues FEFO at average cost; a gain receives at the
 * current average, or at standard cost when the location holds none (R22).
 * Returns the signed value (+ gain, − loss).
 */
export async function adjustStock(
  tx: Tx,
  input: {
    itemId: Id
    locationId: Id
    qtyBase: number
    type: "adjust" | "count-variance" | "internal-use"
    ref: DocRef
    date?: ISODate
    batchId?: Id
  }
): Promise<{ signedValueP: Poisha; moves: MoveResult["moves"] }> {
  if (input.qtyBase < 0) {
    const out = await issueStock(tx, {
      itemId: input.itemId,
      locationId: input.locationId,
      qtyBase: -input.qtyBase,
      type: input.type,
      ref: input.ref,
      date: input.date,
      onlyBatchId: input.batchId,
    })
    return { signedValueP: -out.valueP, moves: out.moves }
  }
  const item = await tx.get("items", input.itemId)
  const current = await valueRow(tx, input.itemId, input.locationId)
  const valueP =
    current && current.qtyBase > 0
      ? Math.round((input.qtyBase * current.valueP) / current.qtyBase)
      : standardValue(item, input.qtyBase)
  const out = await receiveStock(tx, { ...input, valueP, type: input.type })
  return { signedValueP: valueP, moves: out.moves }
}

/** Hold a received lot in quarantine: quantity held, no value until accepted (R12 waits). */
export async function quarantineLot(
  tx: Tx,
  input: { itemId: Id; locationId: Id; qtyBase: number; batch: BatchInput; ref: DocRef; date?: ISODate }
): Promise<{ batchId: Id; moveId: Id }> {
  const batchId = await ensureBatch(tx, input.itemId, input.batch, "quarantine")
  await bumpBalance(tx, input.itemId, input.locationId, batchId, { quarantined: input.qtyBase })
  const row = move(tx, {
    itemId: input.itemId,
    locationId: input.locationId,
    batchId,
    type: "quarantine",
    qtyBase: input.qtyBase,
    valueP: 0,
    ref: input.ref,
    date: input.date ?? tx.today(),
  })
  return { batchId, moveId: row.id }
}

/** Accept a quarantined lot into usable stock at its PO cost (R12). */
export async function acceptQuarantined(
  tx: Tx,
  input: { itemId: Id; locationId: Id; batchId: Id; qtyBase: number; valueP: Poisha; ref: DocRef; date?: ISODate }
): Promise<MoveResult> {
  await bumpBalance(tx, input.itemId, input.locationId, input.batchId, { quarantined: -input.qtyBase })
  await tx.update("batches", input.batchId, { status: "ok" })
  return receiveStock(tx, {
    itemId: input.itemId,
    locationId: input.locationId,
    batchId: input.batchId,
    qtyBase: input.qtyBase,
    valueP: input.valueP,
    type: "quarantine-accept",
    ref: input.ref,
    date: input.date,
  })
}

/** Return a quarantined lot to the vendor: the held quantity clears, nothing posts. */
export async function returnQuarantined(
  tx: Tx,
  input: { itemId: Id; locationId: Id; batchId: Id; qtyBase: number; ref: DocRef; date?: ISODate }
): Promise<{ moveId: Id }> {
  await bumpBalance(tx, input.itemId, input.locationId, input.batchId, { quarantined: -input.qtyBase })
  const row = move(tx, {
    itemId: input.itemId,
    locationId: input.locationId,
    batchId: input.batchId,
    type: "quarantine-return",
    qtyBase: -input.qtyBase,
    valueP: 0,
    ref: input.ref,
    date: input.date ?? tx.today(),
  })
  return { moveId: row.id }
}

/**
 * `StockBelowReorder` when a commit takes on-hand to or below the location's
 * minimum (plan §3.5): only on the crossing, not on every issue below it.
 */
export async function watchReorder(tx: Tx, item: ItemRow, locationId: Id, before: number, after: number): Promise<void> {
  const [rule] = await tx.list("reorderRules", "[itemId+locationId]", [item.id, locationId])
  if (!rule) return
  if (before > rule.minQty && after <= rule.minQty) {
    const location = await tx.find("locations", locationId)
    tx.emit("StockBelowReorder", {
      refs: { itemId: item.id, locationId },
      params: { sku: item.sku, location: location?.code ?? locationId, qty: roundQty(after), min: rule.minQty },
      locationId,
    })
  }
}

/** On-hand usable quantity and value of an item at a location. */
export async function onHand(tx: Tx, itemId: Id, locationId: Id): Promise<{ qtyBase: number; valueP: Poisha }> {
  const row = await valueRow(tx, itemId, locationId)
  return { qtyBase: row?.qtyBase ?? 0, valueP: row?.valueP ?? 0 }
}
