import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { OmniflowDb } from "@/core/db/database"
import { BAY, ITM, LOC, PTY, SVC, USR, VEH } from "@/core/seed/content/seed-refs"
import { deliverGoods, handover } from "@/modules/sd/commands"
import { createOrder } from "@/modules/stl/commands"

import { orderThrough } from "../stl/flow"
import { actors, booksTie, inventoryTies, journalsOf, key, refusal, run, seededDb, todayAt } from "../stl/helpers"

/**
 * SD on the small seed: vehicle handover after QC (retail item lines issued
 * FEFO with R5, gate pass) and goods delivery with a challan for a product
 * order, partial then complete.
 */

let db: OmniflowDb
let as: ReturnType<typeof actors>
beforeAll(async () => {
  db = await seededDb("sd")
  as = actors(db)
}, 120_000)
afterAll(async () => {
  await db.delete()
})

const CHECKLIST = ["exterior", "interior", "glass", "wheels", "belongings"].map((k) => ({ key: k, ok: true }))

describe("vehicle handover", () => {
  it("needs QC passed, a complete checklist and the right permission; issues retail lines with R5", async () => {
    const orderId = await orderThrough(db, as, {
      partyId: PTY.shahedKabir,
      vehicleId: VEH.corollaCross7731,
      requests: [
        { kind: "service", serviceId: SVC.WSH_EXP },
        { kind: "item", itemId: ITM.rtAfrOcean, qty: 2 },
      ],
      bayId: BAY.GUL_C1,
      start: todayAt("11:00"),
      technician: "rakib",
      technicianId: USR.rakib,
      until: "ready",
    })
    const shahriar = await as("shahriar")
    const sign = { orderId, checklist: CHECKLIST, signatureName: "Shahed Kabir", signatureSvg: "M1 1 L20 20" }
    expect(await refusal(db, await as("rakib"), handover, sign)).toBe("denied")
    expect(await refusal(db, shahriar, handover, { ...sign, checklist: CHECKLIST.map((c, i) => (i === 0 ? { ...c, ok: false } : c)) })).toBe("SD_CHECKLIST")
    const before = await db.stockValues.get(`sv:${ITM.rtAfrOcean}:${LOC.GUL}`)
    const out = await run(db, shahriar, handover, sign)
    expect(out.deliveryNo).toMatch(/^DN-GUL-\d{4}-\d{5}$/)
    expect(out.gatePassNo).toMatch(/^GP-GUL-\d{4}-\d{5}$/)
    const order = await db.salesOrders.get(orderId)
    expect(order?.status).toBe("delivered")
    const after = await db.stockValues.get(`sv:${ITM.rtAfrOcean}:${LOC.GUL}`)
    expect(before!.qtyBase - after!.qtyBase).toBe(2)
    const [journal] = await journalsOf(db, out.deliveryId)
    expect(journal).toMatchObject({ rule: "R5", voucherType: "IV" })
    expect((await db.deliveries.get(out.deliveryId))?.journalId).toBe(journal.id)
    expect(await db.deliveryLines.where("deliveryId").equals(out.deliveryId).count()).toBeGreaterThan(0)
    expect(await refusal(db, shahriar, handover, sign)).toBe("SD_NOT_READY")
  })
})

describe("goods delivery (challan)", () => {
  it("delivers a product order partially, then completely", async () => {
    const nayeem = await as("nayeem")
    const { orderId } = await run(db, nayeem, createOrder, {
      partyId: PTY.primeAuto,
      requests: [{ kind: "item", itemId: ITM.rtShampoo, qty: 6 }],
      idempotencyKey: key("goods"),
    })
    const order = await db.salesOrders.get(orderId)
    expect(order?.kind).toBe("product")
    const [line] = await db.salesOrderLines.where("orderId").equals(orderId).toArray()
    expect(await refusal(db, nayeem, deliverGoods, { orderId, lines: [{ orderLineId: line.id, qty: 7 }] })).toBe("SD_OVER_DELIVERY")
    const first = await run(db, nayeem, deliverGoods, { orderId, lines: [{ orderLineId: line.id, qty: 4 }] })
    expect(first.complete).toBe(false)
    expect((await db.salesOrders.get(orderId))?.status).toBe("booked")
    const second = await run(db, nayeem, deliverGoods, { orderId, lines: [{ orderLineId: line.id, qty: 2 }] })
    expect(second.complete).toBe(true)
    expect((await db.salesOrders.get(orderId))?.status).toBe("delivered")
    expect((await journalsOf(db, second.deliveryId))[0]?.rule).toBe("R5")
    const tie = await inventoryTies(db, LOC.GUL)
    expect(tie.gl).toBe(tie.stock)
    expect((await booksTie(db)).unbalanced).toEqual([])
  })
})
