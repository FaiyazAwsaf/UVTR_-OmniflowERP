import { z } from "zod"

import type { DeliveryRow, Id, SalesOrderLineRow, SalesOrderRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForRetailGoodsOut, RULE_VOUCHER } from "@/core/ledger/rules"
import { issueStock } from "@/core/stock/moves"
import { roundQty } from "@/core/stock/value"

/**
 * SD Sale Delivery commands (plan §6.2): vehicle handover after QC (retail
 * item lines issued FEFO with R5, gate pass) and goods delivery with a
 * delivery challan for product and B2B orders (partial supported).
 */

/** Handover checklist keys (labels in sd.checklist). */
export const HANDOVER_KEYS = ["exterior", "interior", "glass", "wheels", "belongings"] as const

type GoodsLine = { line: SalesOrderLineRow; qty: number }

/**
 * Issue goods lines FEFO at the order's studio and post R5 (Dr COGS, Cr
 * retail inventory at average cost); delivery lines and the order lines'
 * delivered quantities follow.
 */
async function issueGoods(tx: Tx, order: SalesOrderRow, delivery: DeliveryRow, goods: GoodsLine[]): Promise<Id | undefined> {
  const ref = { docType: "deliveries", docId: delivery.id, docNo: delivery.deliveryNo }
  const valued: { itemId: Id; valueP: number }[] = []
  const moveIds: Id[] = []
  for (const { line, qty } of goods) {
    if (qty <= 0) continue
    const item = await tx.get("items", line.refId)
    const qtyBase = roundQty(qty * (item.salesFactor ?? 1))
    const out = await issueStock(tx, { itemId: item.id, locationId: order.locationId, qtyBase, type: "sale-delivery", ref })
    valued.push({ itemId: item.id, valueP: out.valueP })
    for (const m of out.moves) {
      moveIds.push(m.moveId)
      tx.insert("deliveryLines", { deliveryId: delivery.id, orderLineId: line.id, itemId: item.id, qtyBase: m.qtyBase, batchId: m.batchId, stockMoveId: m.moveId })
    }
    const delivered = roundQty(line.qtyDelivered + qty)
    await tx.update("salesOrderLines", line.id, { qtyDelivered: delivered, status: delivered >= line.qty ? "done" : line.status })
  }
  const total = valued.reduce((s, v) => s + v.valueP, 0)
  if (total <= 0) return undefined
  const journal = await postJournal(tx, {
    voucherType: RULE_VOUCHER.R5,
    date: tx.today(),
    source: { app: "sd", ...ref },
    narration: `Goods delivered, ${delivery.deliveryNo} (${order.orderNo})`,
    lines: linesForRetailGoodsOut({ locationId: order.locationId, lines: valued.filter((v) => v.valueP > 0) }),
    rule: "R5",
  })
  for (const id of moveIds) await tx.update("stockMoves", id, { journalId: journal.id })
  await tx.update("deliveries", delivery.id, { journalId: journal.id })
  return journal.id
}

/**
 * Vehicle handover (plan §6.2): QC must have passed (order ready); the
 * checklist is complete and the customer signed on screen; a gate pass is
 * numbered; retail item lines are issued FEFO with R5; the order is
 * delivered.
 */
export const handover = defineCommand({
  name: "sd.handover",
  permission: "sd.delivery.handover",
  input: z.object({
    orderId: z.string(),
    expectedVersion: z.number().optional(),
    checklist: z.array(z.object({ key: z.string(), ok: z.boolean(), note: z.string().optional() })).min(1),
    signatureName: z.string().trim().min(2),
    /** SVG path data from the on-screen pad (core/connectors/capture.ts) */
    signatureSvg: z.string().min(3),
    photoCount: z.number().int().min(0).max(12).default(4),
  }),
  async run(tx, input) {
    const order = await tx.get("salesOrders", input.orderId, { expectedVersion: input.expectedVersion })
    tx.requireLocation(order.locationId)
    if (order.status !== "ready") tx.reject("SD_NOT_READY", { no: order.orderNo })
    if (!input.checklist.every((c) => c.ok)) tx.reject("SD_CHECKLIST")
    const date = tx.today()
    const deliveryNo = await nextDocNo(tx, "DN", { location: order.locationId, date })
    const gatePassNo = await nextDocNo(tx, "GP", { location: order.locationId, date })
    const now = tx.now()
    const delivery = tx.insert("deliveries", {
      deliveryNo,
      orderId: order.id,
      kind: "vehicle-handover",
      locationId: order.locationId,
      status: "delivered",
      checklist: input.checklist.map((c) => ({ key: c.key, ok: c.ok, note: c.note?.trim() || undefined })),
      signatureName: input.signatureName,
      signatureSvg: input.signatureSvg,
      signedAt: now,
      gatePassNo,
      deliveredBy: tx.actor.userId,
      deliveredAt: now,
    })
    const lines = (await tx.list("salesOrderLines", "orderId", order.id)).filter((l) => l.status !== "cancelled")
    const goods = lines.filter((l) => l.kind === "item").map((line) => ({ line, qty: roundQty(line.qty - line.qtyDelivered) }))
    await issueGoods(tx, order, delivery, goods)
    for (const line of lines) {
      if (line.kind !== "item") await tx.update("salesOrderLines", line.id, { qtyDelivered: line.qty })
    }
    await tx.update("salesOrders", order.id, { status: "delivered", deliveredAt: now, photoCount: Math.max(order.photoCount, input.photoCount) })
    tx.emit("VehicleHandedOver", {
      refs: { orderId: order.id, deliveryId: delivery.id, partyId: order.partyId, vehicleId: order.vehicleId },
      params: { no: order.orderNo, gatePass: gatePassNo },
      locationId: order.locationId,
    })
    return { deliveryId: delivery.id, deliveryNo, gatePassNo }
  },
})

/**
 * Goods delivery with a delivery challan for product and B2B orders: stock
 * leaves the studio FEFO (R5); partial delivery is allowed; the order is
 * delivered once every goods line is.
 */
export const deliverGoods = defineCommand({
  name: "sd.deliverGoods",
  permission: "sd.delivery.goods",
  input: z.object({
    orderId: z.string(),
    expectedVersion: z.number().optional(),
    lines: z.array(z.object({ orderLineId: z.string(), qty: z.number().positive() })).min(1),
  }),
  async run(tx, input) {
    const order = await tx.get("salesOrders", input.orderId, { expectedVersion: input.expectedVersion })
    tx.requireLocation(order.locationId)
    const all = (await tx.list("salesOrderLines", "orderId", order.id)).filter((l) => l.status !== "cancelled")
    const goodsOnly = all.length > 0 && all.every((l) => l.kind === "item")
    if (!goodsOnly || order.status !== "booked") tx.reject("SD_NOT_GOODS_ORDER", { no: order.orderNo })
    const goods: GoodsLine[] = []
    for (const want of input.lines) {
      const line = all.find((l) => l.id === want.orderLineId) ?? tx.reject("SD_NOT_GOODS_ORDER", { no: order.orderNo })
      const open = roundQty(line.qty - line.qtyDelivered)
      if (want.qty > open + 1e-9) tx.reject("SD_OVER_DELIVERY", { item: line.descriptionEn, open })
      goods.push({ line, qty: want.qty })
    }
    const date = tx.today()
    const deliveryNo = await nextDocNo(tx, "DN", { location: order.locationId, date })
    const now = tx.now()
    const delivery = tx.insert("deliveries", {
      deliveryNo,
      orderId: order.id,
      kind: "goods",
      locationId: order.locationId,
      status: "delivered",
      checklist: [],
      deliveredBy: tx.actor.userId,
      deliveredAt: now,
    })
    await issueGoods(tx, order, delivery, goods)
    const after = (await tx.list("salesOrderLines", "orderId", order.id)).filter((l) => l.status !== "cancelled")
    const complete = after.every((l) => l.qtyDelivered >= l.qty - 1e-9)
    if (complete) await tx.update("salesOrders", order.id, { status: "delivered", deliveredAt: now })
    tx.emit("GoodsDelivered", {
      refs: { orderId: order.id, deliveryId: delivery.id, partyId: order.partyId },
      params: { no: deliveryNo, order: order.orderNo },
      locationId: order.locationId,
    })
    return { deliveryId: delivery.id, deliveryNo, complete }
  },
})
