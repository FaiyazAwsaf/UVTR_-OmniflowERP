import type { BatchRow, DocRef, ISODate, Id, Ms, StockBalanceRow, StockMoveRow, StockMoveType, StockValueRow } from "@/core/db/schema"
import { stockBalanceId, stockValueId } from "@/core/db/tables"
import { allocateFefo, type BalanceWithBatch } from "@/core/stock/fefo"
import { issueValue, roundQty } from "@/core/stock/value"

import type { World } from "./world"

/**
 * The seed's stock book: writes `stockBalances` (per item, location and
 * batch), `stockValues` (authoritative value per item and location) and
 * `stockMoves` exactly as `core/stock/moves.ts` does: receipts add their
 * quantity and value; an issue of q takes round(q × value / qty) half up
 * (the issue that empties a location takes the rest), FEFO over usable
 * batches, the value split over the batches pro rata with the last taking
 * the remainder; quarantined quantity carries no value and is never issued.
 */

export type RefLater = { docType: string; docId: Id; docNo: () => string }

export type IssueResult = {
  valueP: number
  moves: { moveId: Id; batchId?: Id; qtyBase: number; valueP: number }[]
}

export class SeedStock {
  private readonly balances = new Map<string, StockBalanceRow[]>()
  private readonly values = new Map<string, StockValueRow>()
  readonly batches = new Map<Id, BatchRow>()
  readonly moves: StockMoveRow[] = []
  private readonly moveById = new Map<Id, StockMoveRow>()

  constructor(private readonly world: World) {}

  private key(itemId: Id, locationId: Id) {
    return `${itemId}|${locationId}`
  }

  batch(input: { itemId: Id; batchNo: string; expiry?: ISODate; receivedAt: Ms; grnLineId?: Id; status?: BatchRow["status"] }): BatchRow {
    const id = this.world.ctx.seq("bat")
    const row = this.world.ctx.bag.put("batches", id, input.receivedAt, {
      itemId: input.itemId,
      batchNo: input.batchNo,
      expiry: input.expiry,
      receivedAt: input.receivedAt,
      grnLineId: input.grnLineId,
      status: input.status ?? "ok",
    })
    this.batches.set(id, row)
    return row
  }

  onHand(itemId: Id, locationId: Id): { qtyBase: number; valueP: number } {
    const v = this.values.get(this.key(itemId, locationId))
    return { qtyBase: v?.qtyBase ?? 0, valueP: v?.valueP ?? 0 }
  }

  /** Link moves to the journal that valued them. */
  linkJournal(moveIds: Id[], journalId: Id): void {
    for (const id of moveIds) {
      const m = this.moveById.get(id)
      if (m) m.journalId = journalId
    }
  }

  /** Every value row (item × location). */
  allValues(): StockValueRow[] {
    return [...this.values.values()]
  }

  allBalances(): StockBalanceRow[] {
    return [...this.balances.values()].flat()
  }

  private valueRow(itemId: Id, locationId: Id, at: Ms): StockValueRow {
    const k = this.key(itemId, locationId)
    let row = this.values.get(k)
    if (!row) {
      row = this.world.ctx.bag.put("stockValues", stockValueId(itemId, locationId), at, { itemId, locationId, qtyBase: 0, valueP: 0 })
      this.values.set(k, row)
    }
    return row
  }

  private balanceRow(itemId: Id, locationId: Id, batchId: Id | undefined, at: Ms): StockBalanceRow {
    const k = this.key(itemId, locationId)
    let list = this.balances.get(k)
    if (!list) {
      list = []
      this.balances.set(k, list)
    }
    let row = list.find((b) => b.batchId === batchId)
    if (!row) {
      row = this.world.ctx.bag.put("stockBalances", stockBalanceId(itemId, locationId, batchId), at, {
        itemId,
        locationId,
        batchId,
        qtyBase: 0,
        quarantinedQty: 0,
      })
      list.push(row)
    }
    return row
  }

  private move(m: {
    itemId: Id
    locationId: Id
    batchId?: Id
    type: StockMoveType
    qtyBase: number
    valueP: number
    ref: RefLater
    at: Ms
    date: ISODate
  }): StockMoveRow {
    const ref: DocRef = { docType: m.ref.docType, docId: m.ref.docId, docNo: "" }
    const row = this.world.ctx.bag.put("stockMoves", this.world.ctx.seq("mov"), m.at, {
      itemId: m.itemId,
      locationId: m.locationId,
      batchId: m.batchId,
      type: m.type,
      qtyBase: roundQty(m.qtyBase),
      valueP: m.valueP,
      ref,
      at: m.at,
      date: m.date,
    })
    const docNo = m.ref.docNo
    this.world.fix(() => {
      ref.docNo = docNo()
    })
    this.moves.push(row)
    this.moveById.set(row.id, row)
    return row
  }

  private touch(row: { updatedAt: Ms }, at: Ms) {
    if (at > row.updatedAt) row.updatedAt = at
  }

  /** Receive usable stock: quantity and value added (accepted qty × cost, or the value carried). */
  receive(input: {
    itemId: Id
    locationId: Id
    qtyBase: number
    valueP: number
    type: StockMoveType
    ref: RefLater
    at: Ms
    date: ISODate
    batchId?: Id
  }): IssueResult {
    const bal = this.balanceRow(input.itemId, input.locationId, input.batchId, input.at)
    bal.qtyBase = roundQty(bal.qtyBase + input.qtyBase)
    this.touch(bal, input.at)
    const val = this.valueRow(input.itemId, input.locationId, input.at)
    val.qtyBase = roundQty(val.qtyBase + input.qtyBase)
    val.valueP += input.valueP
    this.touch(val, input.at)
    const row = this.move({ ...input })
    return { valueP: input.valueP, moves: [{ moveId: row.id, batchId: input.batchId, qtyBase: input.qtyBase, valueP: input.valueP }] }
  }

  /** Usable entries at a location (FEFO input). */
  entries(itemId: Id, locationId: Id): BalanceWithBatch[] {
    return (this.balances.get(this.key(itemId, locationId)) ?? []).map((balance) => ({
      balance,
      batch: balance.batchId ? this.batches.get(balance.batchId) : undefined,
    }))
  }

  /** Issue FEFO at the location's average cost (core/stock/moves.ts issueStock). */
  issue(input: {
    itemId: Id
    locationId: Id
    qtyBase: number
    type: StockMoveType
    ref: RefLater
    at: Ms
    date: ISODate
  }): IssueResult {
    const { allocations, short } = allocateFefo(this.entries(input.itemId, input.locationId), input.qtyBase, input.date)
    if (short > 1e-9) {
      throw new Error(`seed: stock short ${input.itemId} at ${input.locationId} on ${input.date}: needed ${input.qtyBase}, short ${short}`)
    }
    const val = this.valueRow(input.itemId, input.locationId, input.at)
    const total = issueValue(input.qtyBase, val.qtyBase, val.valueP)
    val.qtyBase = roundQty(val.qtyBase - input.qtyBase)
    val.valueP -= total
    if (Math.abs(val.qtyBase) < 1e-9 && val.valueP !== 0) throw new Error(`seed: stock value residue ${input.itemId}`)
    this.touch(val, input.at)
    const out: IssueResult = { valueP: total, moves: [] }
    let used = 0
    for (const [i, alloc] of allocations.entries()) {
      const last = i === allocations.length - 1
      const share = last ? total - used : Math.round((alloc.qty * total) / input.qtyBase)
      used += share
      const bal = this.balanceRow(input.itemId, input.locationId, alloc.batchId, input.at)
      bal.qtyBase = roundQty(bal.qtyBase - alloc.qty)
      this.touch(bal, input.at)
      const row = this.move({
        itemId: input.itemId,
        locationId: input.locationId,
        batchId: alloc.batchId,
        type: input.type,
        qtyBase: -alloc.qty,
        valueP: -share,
        ref: input.ref,
        at: input.at,
        date: input.date,
      })
      out.moves.push({ moveId: row.id, batchId: alloc.batchId, qtyBase: alloc.qty, valueP: share })
    }
    return out
  }

  /** Hold a received lot in quarantine: quantity held, no value. */
  quarantine(input: { itemId: Id; locationId: Id; qtyBase: number; batchId: Id; ref: RefLater; at: Ms; date: ISODate }): StockMoveRow {
    const bal = this.balanceRow(input.itemId, input.locationId, input.batchId, input.at)
    bal.quarantinedQty = roundQty(bal.quarantinedQty + input.qtyBase)
    this.touch(bal, input.at)
    return this.move({ ...input, type: "quarantine", valueP: 0 })
  }

  /** Return a quarantined lot to the vendor: the held quantity clears, nothing posts. */
  returnQuarantined(input: { itemId: Id; locationId: Id; qtyBase: number; batchId: Id; ref: RefLater; at: Ms; date: ISODate }): StockMoveRow {
    const bal = this.balanceRow(input.itemId, input.locationId, input.batchId, input.at)
    bal.quarantinedQty = roundQty(bal.quarantinedQty - input.qtyBase)
    this.touch(bal, input.at)
    return this.move({ ...input, qtyBase: -input.qtyBase, type: "quarantine-return", valueP: 0 })
  }
}
