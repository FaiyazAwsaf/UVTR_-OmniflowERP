import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { OmniflowDb } from "@/core/db/database"
import { BAY, ITM, PTY, SVC, USR, VEH, LOC } from "@/core/seed/content/seed-refs"
import {
  acceptQuotation,
  cancelOrder,
  createOrder,
  finishTask,
  qcCheck,
  quickAddCustomer,
  recordConsumption,
  saveQuotation,
  scheduleOrder,
  sendQuotation,
  startTask,
} from "@/modules/stl/commands"

import { actors, balance, booksTie, inventoryTies, journalsOf, key, refusal, run, seededDb, todayAt } from "./helpers"

/**
 * STL lifecycle on the small seed (plan §6.1, J1 to J3 and E1 in miniature):
 * quotation priced from the list, discount within and above the advisor's
 * limit (inline approval), acceptance with a bKash deposit (R3), scheduling
 * without double booking, tasks with recipe consumption (R4), extra and
 * returned consumables, QC fail and pass, cancellation.
 */

let db: OmniflowDb
let as: ReturnType<typeof actors>
beforeAll(async () => {
  db = await seededDb("stl")
  as = actors(db)
}, 120_000)
afterAll(async () => {
  await db.delete()
})

const QUOTE = {
  partyId: PTY.shahedKabir,
  vehicleId: VEH.corollaCross7731,
  requests: [
    { kind: "service" as const, serviceId: SVC.PRT_CC2 },
    { kind: "service" as const, serviceId: SVC.INT_DEEP },
  ],
}

let quotationId = ""
let orderId = ""

describe("quotations", () => {
  it("prices services by the vehicle's class on the party's list (VAT 15% per line)", async () => {
    const nayeem = await as("nayeem")
    const out = await run(db, nayeem, saveQuotation, { ...QUOTE, inspectionNotes: "Swirl marks on the bonnet" })
    const q = await db.quotations.get(out.quotationId)
    expect(q?.quoteNo).toMatch(/^QT-GUL-\d{4}-\d{5}$/)
    // SUV: ceramic 2-year 36,000 + interior deep 6,500; VAT 15%.
    expect(q?.subtotalP).toBe(42_500_00)
    expect(q?.vatP).toBe(6_375_00)
    expect(q?.totalP).toBe(48_875_00)
    expect(q?.status).toBe("draft")
    const lines = await db.quotationLines.where("quotationId").equals(out.quotationId).toArray()
    expect(lines.map((l) => l.revenueTag).sort()).toEqual(["REV_INTERIOR", "REV_PROTECTION"])
    quotationId = out.quotationId
  })

  it("refuses a discount above the advisor's 5% without an approver, and records an inline approval", async () => {
    const nayeem = await as("nayeem")
    expect(await refusal(db, nayeem, saveQuotation, { ...QUOTE, discountPct: 12 })).toBe("APPROVAL_LIMIT")
    expect(
      await refusal(db, nayeem, saveQuotation, { ...QUOTE, discountPct: 12, inline: { approverId: USR.shahriar, pin: "0000", reason: "Loyal customer" } })
    ).toBe("BAD_PIN")
    const ok = await run(db, nayeem, saveQuotation, {
      ...QUOTE,
      discountPct: 12,
      inline: { approverId: USR.shahriar, pin: "1234", reason: "Loyal customer" },
    })
    const q = await db.quotations.get(ok.quotationId)
    expect(q?.discountApprovalId).toBeTruthy()
    const approval = await db.approvals.get(q!.discountApprovalId!)
    expect(approval).toMatchObject({ kind: "discount-pct", status: "approved", inline: true, decidedBy: USR.shahriar, pct: 12 })
    expect(q?.discountP).toBe(5_100_00)
    // Within 5% needs no approval.
    const within = await run(db, nayeem, saveQuotation, { ...QUOTE, discountPct: 5 })
    expect((await db.quotations.get(within.quotationId))?.discountApprovalId).toBeUndefined()
  })

  it("is refused for roles without stl.quote.create and out of scope for another studio's advisor", async () => {
    expect(await refusal(db, await as("rakib"), saveQuotation, QUOTE)).toBe("denied")
    expect(await refusal(db, await as("tania"), saveQuotation, QUOTE)).toBe("denied")
    expect(await refusal(db, await as("shuvo"), sendQuotation, { quotationId, channel: "sms" })).toBe("OUT_OF_SCOPE")
  })

  it("sends by SMS with only the number, amount and validity", async () => {
    await run(db, await as("nayeem"), sendQuotation, { quotationId, channel: "sms" })
    const q = await db.quotations.get(quotationId)
    expect(q?.status).toBe("sent")
    const sms = (await db.sms.where("partyId").equals(PTY.shahedKabir).toArray()).find((s) => s.templateId === "quotation-sent")
    expect(sms?.text).toContain(q!.quoteNo)
    expect(sms?.text).not.toContain("Swirl")
  })
})

describe("booking with a bKash deposit (R3)", () => {
  it("accepts the quotation into a booked order with the deposit held as customer advance", async () => {
    const advanceBefore = await balance(db, "CUSTOMER_ADVANCE", { partyId: PTY.shahedKabir })
    const out = await run(db, await as("nayeem"), acceptQuotation, {
      quotationId,
      deposit: { method: "bkash", amountP: 10_000_00, ref: "BK12345678", confirmed: true },
      idempotencyKey: key("accept"),
    })
    orderId = out.orderId
    const order = await db.salesOrders.get(orderId)
    expect(order).toMatchObject({ status: "booked", advanceP: 10_000_00, quotationId, totalP: 48_875_00, kind: "service" })
    expect((await db.quotations.get(quotationId))?.status).toBe("accepted")
    const receipts = await db.receipts.where("orderId").equals(orderId).toArray()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ status: "posted", method: "bkash", advanceP: 10_000_00 })
    const [journal] = await journalsOf(db, receipts[0].id)
    expect(journal).toMatchObject({ rule: "R3", voucherType: "RV" })
    expect(await balance(db, "CUSTOMER_ADVANCE", { partyId: PTY.shahedKabir })).toBe(advanceBefore - 10_000_00)
    const sms = (await db.sms.where("partyId").equals(PTY.shahedKabir).toArray()).find((s) => s.templateId === "booking-confirmed")
    expect(sms?.text).toContain(order!.orderNo)
  })

  it("refuses an unconfirmed MFS deposit and accepting twice", async () => {
    const nayeem = await as("nayeem")
    const other = await run(db, nayeem, saveQuotation, QUOTE)
    expect(
      await refusal(db, nayeem, acceptQuotation, {
        quotationId: other.quotationId,
        deposit: { method: "nagad", amountP: 1_000_00, confirmed: false },
        idempotencyKey: key("unconfirmed"),
      })
    ).toBe("STL_DEPOSIT_NOT_CONFIRMED")
    expect(await refusal(db, nayeem, acceptQuotation, { quotationId, idempotencyKey: key("again") })).toBe("STL_QUOTE_CLOSED")
  })
})

describe("scheduling (no double booking)", () => {
  it("creates one task per service line in bay C1 with Rakib from 11:00", async () => {
    const lines = await db.salesOrderLines.where("orderId").equals(orderId).sortBy("lineNo")
    const out = await run(db, await as("nayeem"), scheduleOrder, {
      orderId,
      bayId: BAY.GUL_C1,
      start: todayAt("11:00"),
      assignments: lines.map((l) => ({ orderLineId: l.id, technicianId: USR.rakib })),
    })
    const tasks = await db.jobTasks.where("orderId").equals(orderId).toArray()
    expect(tasks).toHaveLength(2)
    expect(tasks.every((t) => t.technicianId === USR.rakib && t.bayId === BAY.GUL_C1 && t.status === "queued")).toBe(true)
    const order = await db.salesOrders.get(orderId)
    expect(order?.bayId).toBe(BAY.GUL_C1)
    expect(order?.promisedAt).toBe(out.promisedAt)
  })

  it("refuses the same bay or the same technician at an overlapping time", async () => {
    const nayeem = await as("nayeem")
    const booked = await run(db, nayeem, createOrder, {
      partyId: PTY.shahedKabir,
      vehicleId: VEH.corollaCross7731,
      requests: [{ kind: "service", serviceId: SVC.WSH_EXP }],
      idempotencyKey: key("other"),
    })
    const [line] = await db.salesOrderLines.where("orderId").equals(booked.orderId).toArray()
    expect(
      await refusal(db, nayeem, scheduleOrder, { orderId: booked.orderId, bayId: BAY.GUL_C1, start: todayAt("11:30"), assignments: [{ orderLineId: line.id, technicianId: USR.faruk }] })
    ).toBe("BAY_BUSY")
    expect(
      await refusal(db, nayeem, scheduleOrder, { orderId: booked.orderId, bayId: BAY.GUL_W1, start: todayAt("11:30"), assignments: [{ orderLineId: line.id, technicianId: USR.rakib }] })
    ).toBe("TECHNICIAN_BUSY")
    expect(
      await refusal(db, nayeem, scheduleOrder, { orderId: booked.orderId, bayId: BAY.UTT_C1, start: todayAt("11:30"), assignments: [{ orderLineId: line.id, technicianId: USR.faruk }] })
    ).toBe("STL_BAY_LOCATION")
    expect(
      await refusal(db, nayeem, scheduleOrder, { orderId: booked.orderId, bayId: BAY.GUL_W2, start: todayAt("19:30"), assignments: [{ orderLineId: line.id, technicianId: USR.jewel }] })
    ).toBe("STL_NOT_TECHNICIAN")
    expect(await refusal(db, await as("tania"), scheduleOrder, { orderId: booked.orderId, bayId: BAY.GUL_W2, start: todayAt("19:30"), assignments: [{ orderLineId: line.id, technicianId: USR.faruk }] })).toBe(
      "denied"
    )
    // Cancel it with a reason (manager only).
    expect(await refusal(db, nayeem, cancelOrder, { orderId: booked.orderId, reason: "Customer changed plans" })).toBe("denied")
    await run(db, await as("shahriar"), cancelOrder, { orderId: booked.orderId, reason: "Customer changed plans" })
    expect((await db.salesOrders.get(booked.orderId))?.status).toBe("cancelled")
  })
})

describe("tasks and consumption (R4)", () => {
  it("lets only the assigned technician (or the manager) start a task", async () => {
    const [task] = await db.jobTasks.where("orderId").equals(orderId).sortBy("plannedStart")
    expect(await refusal(db, await as("sajib"), startTask, { taskId: task.id })).toBe("STL_NOT_YOUR_TASK")
    expect(await refusal(db, await as("nayeem"), startTask, { taskId: task.id })).toBe("denied")
    await run(db, await as("rakib"), startTask, { taskId: task.id })
    expect((await db.salesOrders.get(orderId))?.status).toBe("in-progress")
  })

  it("finishing issues the recipe FEFO at the studio's average cost with R4", async () => {
    const [task] = await db.jobTasks.where("orderId").equals(orderId).sortBy("plannedStart")
    const before = await db.stockValues.get(`sv:${ITM.cc2Kit}:${LOC.GUL}`)
    const usedBefore = await balance(db, "CONSUMABLES_USED", { locationId: LOC.GUL })
    const out = await run(db, await as("rakib"), finishTask, { taskId: task.id })
    expect(out.valueP).toBeGreaterThan(0)
    const after = await db.stockValues.get(`sv:${ITM.cc2Kit}:${LOC.GUL}`)
    // Ceramic 2-year: 30 ml for a sedan x 1.25 for an SUV = 38 ml.
    expect(Math.round((before!.qtyBase - after!.qtyBase) * 1000) / 1000).toBe(38)
    const consumptions = await db.jobConsumptions.where("orderId").equals(orderId).toArray()
    expect(consumptions.find((c) => c.itemId === ITM.cc2Kit)).toMatchObject({ kind: "recipe", standardQty: 38, actualQty: 38 })
    const journals = (await journalsOf(db, orderId)).filter((j) => j.rule === "R4")
    expect(journals).toHaveLength(1)
    expect(journals[0].totalP).toBe(out.valueP)
    expect(await balance(db, "CONSUMABLES_USED", { locationId: LOC.GUL })).toBe(usedBefore + out.valueP)
    const tie = await inventoryTies(db, LOC.GUL)
    expect(tie.gl).toBe(tie.stock)
  })

  it("records extra consumables and returns unused stock at the value it carried", async () => {
    const rakib = await as("rakib")
    const before = await db.stockValues.get(`sv:${ITM.microfiber}:${LOC.GUL}`)
    await run(db, rakib, recordConsumption, { orderId, itemId: ITM.microfiber, qtyBase: 2, kind: "extra" })
    await run(db, rakib, recordConsumption, { orderId, itemId: ITM.microfiber, qtyBase: 1, kind: "return" })
    const after = await db.stockValues.get(`sv:${ITM.microfiber}:${LOC.GUL}`)
    expect(Math.round((before!.qtyBase - after!.qtyBase) * 1000) / 1000).toBe(1)
    const rows = (await db.jobConsumptions.where("orderId").equals(orderId).toArray()).filter((c) => c.itemId === ITM.microfiber)
    expect(rows.map((r) => r.kind).sort()).toEqual(["extra", "recipe", "return"])
    expect(await refusal(db, rakib, recordConsumption, { orderId, itemId: ITM.compound, qtyBase: 5, kind: "return" })).toBe("STL_RETURN_EXCEEDS")
    const tie = await inventoryTies(db, LOC.GUL)
    expect(tie.gl).toBe(tie.stock)
  })

  it("sends the order to QC when every task is done", async () => {
    const tasks = await db.jobTasks.where("orderId").equals(orderId).sortBy("plannedStart")
    const rakib = await as("rakib")
    await run(db, rakib, startTask, { taskId: tasks[1].id })
    const out = await run(db, rakib, finishTask, { taskId: tasks[1].id })
    expect(out.toQc).toBe(true)
    expect((await db.salesOrders.get(orderId))?.status).toBe("qc")
  })
})

describe("QC", () => {
  it("fails back to in progress, then passes to ready with the vehicle-ready SMS", async () => {
    const shahriar = await as("shahriar")
    const items = ["finish", "interior", "glass", "wheels"].map((k) => ({ key: k, ok: true }))
    expect(await refusal(db, await as("nayeem"), qcCheck, { orderId, items })).toBe("denied")
    const fail = await run(db, shahriar, qcCheck, { orderId, items: items.map((i) => (i.key === "finish" ? { ...i, ok: false, note: "High spot on bonnet" } : i)) })
    expect(fail.result).toBe("fail")
    expect((await db.salesOrders.get(orderId))?.status).toBe("in-progress")
    const pass = await run(db, shahriar, qcCheck, { orderId, items })
    expect(pass.result).toBe("pass")
    const order = await db.salesOrders.get(orderId)
    expect(order?.status).toBe("ready")
    const sms = (await db.sms.where("partyId").equals(PTY.shahedKabir).toArray()).find((s) => s.templateId === "vehicle-ready")
    expect(sms?.text).toContain(order!.orderNo)
    expect(sms?.text).not.toContain("High spot")
    expect(await db.qcChecks.where("orderId").equals(orderId).count()).toBe(2)
  })
})

describe("quick add and the books", () => {
  it("adds a customer with a vehicle (unique registration and phone)", async () => {
    const nayeem = await as("nayeem")
    const out = await run(db, nayeem, quickAddCustomer, {
      nameEn: "Test Walk Customer",
      phone: "01700-123987",
      vehicle: { regNo: "DHAKA METRO-GA 11-2233", make: "Toyota", model: "Axio", vehicleClass: "SD" },
    })
    const party = await db.parties.get(out.partyId)
    expect(party?.code).toMatch(/^C-\d{6}$/)
    expect(
      await refusal(db, nayeem, quickAddCustomer, { nameEn: "Again", phone: "01700-123987" })
    ).toBe("STL_PHONE_TAKEN")
    expect(await refusal(db, await as("rakib"), quickAddCustomer, { nameEn: "No", phone: "01700-000111" })).toBe("denied")
  })

  it("keeps every journal balanced", async () => {
    const tie = await booksTie(db)
    expect(tie.unbalanced).toEqual([])
    expect(tie.debit).toBe(tie.credit)
  })
})
