import type { BatchRow, ISODate, Id, StockBalanceRow } from "@/core/db/schema"

import { roundQty } from "./value"

/**
 * FEFO allocation (plan §3.5): first expiry, first out, over usable stock
 * only: batch status ok, not expired on the day, never the quarantined part.
 * A preferred batch is taken first. Pure.
 */

export type BalanceWithBatch = { balance: StockBalanceRow; batch?: BatchRow }

export type Allocation = { balanceId: Id; batchId?: Id; qty: number }

export function isUsable(entry: BalanceWithBatch, on: ISODate): boolean {
  if (entry.balance.qtyBase <= 0) return false
  if (!entry.batch) return true
  if (entry.batch.status !== "ok") return false
  return !entry.batch.expiry || entry.batch.expiry >= on
}

/** Usable balances in FEFO order (earliest expiry first; no expiry last; then oldest receipt). */
export function fefoOrder(entries: BalanceWithBatch[], on: ISODate, preferBatchId?: Id): BalanceWithBatch[] {
  return entries
    .filter((e) => isUsable(e, on))
    .sort((a, b) => {
      if (preferBatchId) {
        if (a.batch?.id === preferBatchId && b.batch?.id !== preferBatchId) return -1
        if (b.batch?.id === preferBatchId && a.batch?.id !== preferBatchId) return 1
      }
      const ea = a.batch?.expiry ?? "9999-12-31"
      const eb = b.batch?.expiry ?? "9999-12-31"
      if (ea !== eb) return ea < eb ? -1 : 1
      return (a.batch?.receivedAt ?? 0) - (b.batch?.receivedAt ?? 0)
    })
}

/** Allocate `qty` over usable balances in FEFO order; `short` is what could not be covered. */
export function allocateFefo(
  entries: BalanceWithBatch[],
  qty: number,
  on: ISODate,
  preferBatchId?: Id
): { allocations: Allocation[]; short: number } {
  let left = qty
  const allocations: Allocation[] = []
  for (const entry of fefoOrder(entries, on, preferBatchId)) {
    if (left <= 1e-9) break
    const take = roundQty(Math.min(left, entry.balance.qtyBase))
    if (take <= 0) continue
    allocations.push({ balanceId: entry.balance.id, batchId: entry.balance.batchId, qty: take })
    left = roundQty(left - take)
  }
  return { allocations, short: Math.max(0, left) }
}
