import { z } from "zod"

import { requireApproval } from "@/core/approvals/approvals"
import type { CountLine, Id, InventoryTag, StockCountRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForStockAdjustment, RULE_VOUCHER } from "@/core/ledger/rules"
import { roundQty } from "@/core/stock/value"
import { writeDraftRequisition } from "@/modules/ptl/commands"

import { adjustLine, linkMoves, previewValues, tagOfItem } from "./stock-helpers"

/**
 * IC Inventory Control commands (plan §6.2): physical counts (snapshot,
 * counted quantities, variance review, posting within the poster's
 * `stock-adjust` limit or queued for ic.count.approve, R22), requisitions
 * from reorder suggestions, and the expiry watch's system command.
 */

/** `ic.openCount` (ic.count.create): snapshot the expected usable quantity per item and batch → CountOpened. */
export const openCount = defineCommand({
  name: "ic.openCount",
  permission: "ic.count.create",
  input: z.object({
    locationId: z.string(),
    categoryIds: z.array(z.string()).optional(),
    itemIds: z.array(z.string()).optional(),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const location = await tx.get("locations", input.locationId)
    if (!location.isStockLocation) tx.reject("NOT_STOCK_LOCATION", { location: location.id })
    tx.requireLocation(location.id)
    const balances = await tx.list("stockBalances", "locationId", location.id)
    const items = new Map((await tx.all("items")).map((i) => [i.id, i]))
    const categories = input.categoryIds?.length ? new Set(input.categoryIds) : null
    const only = input.itemIds?.length ? new Set(input.itemIds) : null
    const lines: CountLine[] = balances
      .filter((b) => b.qtyBase > 0)
      .filter((b) => {
        const item = items.get(b.itemId)
        if (!item) return false
        if (categories && !categories.has(item.categoryId)) return false
        return !only || only.has(item.id)
      })
      .sort((a, b) => (items.get(a.itemId)!.sku < items.get(b.itemId)!.sku ? -1 : items.get(a.itemId)!.sku > items.get(b.itemId)!.sku ? 1 : (a.batchId ?? "").localeCompare(b.batchId ?? "")))
      .map((b) => ({ itemId: b.itemId, batchId: b.batchId, expectedQty: roundQty(b.qtyBase), varianceQty: 0, varianceValueP: 0 }))
    if (!lines.length) tx.reject("COUNT_EMPTY")
    const count = tx.insert("stockCounts", {
      countNo: await nextDocNo(tx, "CNT", { location: location.id }),
      locationId: location.id,
      scope: categories ? [...categories] : "all",
      status: "open",
      snapshotAt: tx.now(),
      date: tx.today(),
      lines,
      openedBy: tx.actor.userId,
    })
    tx.emit("CountOpened", { refs: { countId: count.id }, params: { no: count.countNo, lines: lines.length }, locationId: location.id })
    return { id: count.id, countNo: count.countNo }
  },
})

/** Variance quantities and their value at today's average cost (R22's basis). */
async function valueVariances(tx: Tx, count: Pick<StockCountRow, "locationId" | "lines">): Promise<CountLine[]> {
  const lines = count.lines.map((l) => ({
    ...l,
    varianceQty: l.countedQty === undefined ? 0 : roundQty(l.countedQty - l.expectedQty),
  }))
  const values = await previewValues(
    tx,
    count.locationId,
    lines.filter((l) => l.varianceQty !== 0).map((l) => ({ itemId: l.itemId, qtyBase: l.varianceQty }))
  )
  let i = 0
  return lines.map((l) => ({ ...l, varianceValueP: l.varianceQty !== 0 ? values[i++] : 0 }))
}

/** `ic.recordCounts` (ic.count.create): counted quantities by line; the count becomes `counted` when every line has one. */
export const recordCounts = defineCommand({
  name: "ic.recordCounts",
  permission: "ic.count.create",
  input: z.object({
    countId: z.string(),
    expectedVersion: z.number().int(),
    counts: z.array(z.object({ index: z.number().int().nonnegative(), countedQty: z.number().nonnegative().nullable() })),
  }),
  async run(tx, input) {
    const count = await tx.get("stockCounts", input.countId, { expectedVersion: input.expectedVersion })
    tx.requireLocation(count.locationId)
    if (count.status !== "open" && count.status !== "counted") tx.reject("COUNT_NOT_OPEN", { no: count.countNo })
    const lines = count.lines.map((l) => ({ ...l }))
    for (const c of input.counts) {
      const line = lines[c.index]
      if (!line) tx.reject("COUNT_LINE_UNKNOWN")
      line.countedQty = c.countedQty === null ? undefined : roundQty(c.countedQty)
    }
    const valued = await valueVariances(tx, { locationId: count.locationId, lines })
    const status = valued.every((l) => l.countedQty !== undefined) ? "counted" : "open"
    await tx.update("stockCounts", count.id, { lines: valued, status })
    return { status }
  },
})

/** Post a count's variances now (count-variance moves and R22); used by the poster and the approval handler. */
export async function postCountVariances(
  tx: Tx,
  count: StockCountRow,
  opts: { preparedBy: Id; approvalId?: Id }
): Promise<{ journalId?: Id; lines: CountLine[] }> {
  const today = tx.today()
  const ref = { docType: "stockCounts", docId: count.id, docNo: count.countNo }
  const lines: CountLine[] = []
  const ruleLines: { itemId: Id; tag: InventoryTag; valueP: number }[] = []
  const moveIds: Id[] = []
  for (const line of count.lines) {
    const varianceQty = line.countedQty === undefined ? 0 : roundQty(line.countedQty - line.expectedQty)
    if (varianceQty === 0) {
      lines.push({ ...line, varianceQty: 0, varianceValueP: 0 })
      continue
    }
    const out = await adjustLine(tx, {
      itemId: line.itemId,
      locationId: count.locationId,
      batchId: line.batchId,
      qtyBase: varianceQty,
      type: "count-variance",
      ref,
      date: today,
    })
    moveIds.push(...out.moveIds)
    lines.push({ ...line, varianceQty, varianceValueP: out.signedValueP })
    ruleLines.push({ itemId: line.itemId, tag: await tagOfItem(tx, line.itemId), valueP: out.signedValueP })
  }
  let journalId: Id | undefined
  if (ruleLines.some((l) => l.valueP !== 0)) {
    const journal = await postJournal(tx, {
      voucherType: RULE_VOUCHER.R22,
      date: today,
      source: { app: "ic", docType: "stockCounts", docId: count.id, docNo: count.countNo },
      narration: `Stock count variance ${count.countNo}`,
      lines: linesForStockAdjustment({ locationId: count.locationId, lines: ruleLines }),
      rule: "R22",
      preparedBy: opts.preparedBy,
      approvalId: opts.approvalId,
    })
    journalId = journal.id
    await linkMoves(tx, moveIds, journal.id)
  }
  tx.emit("CountPosted", {
    refs: { countId: count.id, journalId, approvalId: opts.approvalId },
    params: { no: count.countNo, variances: ruleLines.length },
    locationId: count.locationId,
  })
  return { journalId, lines }
}

/**
 * `ic.postCount` (ic.count.create): when Σ|variance value| is within the
 * poster's `stock-adjust` limit the variances post at once (count-variance
 * moves and R22), else the count waits for ic.count.approve → CountPosted.
 */
export const postCount = defineCommand({
  name: "ic.postCount",
  permission: "ic.count.create",
  input: z.object({ countId: z.string(), expectedVersion: z.number().int(), idempotencyKey: z.string() }),
  async run(tx, input) {
    const count = await tx.get("stockCounts", input.countId, { expectedVersion: input.expectedVersion })
    tx.requireLocation(count.locationId)
    if (count.status !== "counted") tx.reject("COUNT_NOT_COUNTED", { no: count.countNo })
    const valued = await valueVariances(tx, count)
    const amountP = valued.reduce((s, l) => s + Math.abs(l.varianceValueP), 0)
    const outcome = await requireApproval(tx, {
      kind: "stock-adjust",
      docType: "stockCounts",
      docId: count.id,
      docNo: count.countNo,
      locationId: count.locationId,
      amountP,
    })
    if (outcome.status === "pending") {
      await tx.update("stockCounts", count.id, { lines: valued, status: "pending-approval", approvalId: outcome.approvalId })
      return { status: "pending-approval" as const, amountP }
    }
    const posted = await postCountVariances(tx, count, { preparedBy: tx.actor.userId })
    await tx.update("stockCounts", count.id, { lines: posted.lines, status: "posted", journalId: posted.journalId })
    return { status: "posted" as const, amountP, journalId: posted.journalId }
  },
})

/** `ic.cancelCount` (ic.count.create): drop an open or counted count (nothing posts). */
export const cancelCount = defineCommand({
  name: "ic.cancelCount",
  permission: "ic.count.create",
  input: z.object({ countId: z.string(), expectedVersion: z.number().int(), reason: z.string().trim().min(3) }),
  async run(tx, input) {
    const count = await tx.get("stockCounts", input.countId, { expectedVersion: input.expectedVersion })
    tx.requireLocation(count.locationId)
    if (count.status !== "open" && count.status !== "counted") tx.reject("COUNT_NOT_OPEN", { no: count.countNo })
    await tx.update("stockCounts", count.id, { status: "cancelled" })
    tx.auditContext({ reason: input.reason })
    return { ok: true }
  },
})

/**
 * `ic.raiseReorderPr` (ptl.pr.create): a draft requisition from reorder
 * suggestions; the requester reviews and submits it in PTL
 * (RequisitionSubmitted then).
 */
export const raiseReorderPr = defineCommand({
  name: "ic.raiseReorderPr",
  permission: "ptl.pr.create",
  input: z.object({
    locationId: z.string(),
    note: z.string().trim().optional(),
    lines: z
      .array(
        z.object({
          itemId: z.string(),
          qty: z.number().positive(),
          estUnitCostP: z.number().int().nonnegative(),
          suggestedVendorId: z.string().optional(),
        })
      )
      .min(1),
    idempotencyKey: z.string(),
  }),
  async run(tx, input) {
    const pr = await writeDraftRequisition(tx, {
      locationId: input.locationId,
      reason: "reorder",
      note: input.note,
      lines: input.lines,
    })
    return { id: pr.id, prNo: pr.prNo }
  },
})

/**
 * `ic.markExpiry` (system, the expiry watch): batches expiring within the
 * warning days raise ExpiryAlert once (`expiryAlertAt`); expired batches
 * become unusable (status expired).
 */
export const markExpiry = defineCommand({
  name: "ic.markExpiry",
  permission: "system",
  input: z.object({ alert: z.array(z.string()), expire: z.array(z.string()) }),
  async run(tx, input) {
    const today = tx.today()
    for (const id of input.alert) {
      const batch = await tx.get("batches", id)
      if (batch.expiryAlertAt || !batch.expiry) continue
      const item = await tx.get("items", batch.itemId)
      await tx.update("batches", id, { expiryAlertAt: tx.now() })
      const days = Math.round((Date.parse(batch.expiry) - Date.parse(today)) / 86_400_000)
      tx.emit("ExpiryAlert", {
        refs: { itemId: item.id, batchId: id },
        params: { batch: batch.batchNo, sku: item.sku, days: Math.max(0, days) },
        locationId: null,
      })
    }
    for (const id of input.expire) {
      const batch = await tx.get("batches", id)
      if (batch.status === "ok" && batch.expiry && batch.expiry < today) await tx.update("batches", id, { status: "expired" })
    }
    return { alerted: input.alert.length, expired: input.expire.length }
  },
})
