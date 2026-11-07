import { z } from "zod"

import { requireApproval } from "@/core/approvals/approvals"
import { queueSms } from "@/core/comms/sms"
import { addDaysISO } from "@/core/clock/dates"
import { queueEmail } from "@/core/connectors/email"
import type { Id, QcItem, SalesOrderRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import {
  addVehicleInput,
  addVehicleTx,
  createPartyTx,
  partyFields,
} from "@/modules/par/commands"
import { loadCatalogue } from "@/modules/pc/catalogue"
import { recipeFor, type PricedDraft } from "@/modules/pc/pricing"

import {
  assertFree,
  assertOwnTask,
  assertTechnician,
  DEPOSIT,
  INLINE,
  insertOrderLines,
  isTaskLine,
  issueToJob,
  LINE_REQUEST,
  lineMinutes,
  MINUTE,
  orderKindFor,
  priceForParty,
  QUOTE_VALIDITY_DAYS,
  returnFromJob,
  sendBookingSms,
  smsDate,
  smsMoney,
  takeDeposit,
} from "./orders"

/**
 * STL Sales Transaction Lifecycle commands (plan §6.1, §6.2). Each is one
 * atomic commit; stock and money move with their journals (R3 deposits, R4
 * consumption) in the same commit.
 */

const discountApproval = async (
  tx: Tx,
  input: {
    discountPct: number
    docType: "quotations" | "salesOrders"
    docId: Id
    docNo: string
    locationId: Id
    inline?: z.infer<typeof INLINE>
  }
) => {
  if (input.discountPct <= 0) return undefined
  const outcome = await requireApproval(tx, {
    kind: "discount-pct",
    docType: input.docType,
    docId: input.docId,
    docNo: input.docNo,
    locationId: input.locationId,
    pct: input.discountPct,
    inline: input.inline,
  })
  if (outcome.status === "approved") {
    tx.emit("DiscountApproved", {
      refs: { approvalId: outcome.approvalId },
      params: { pct: input.discountPct, no: input.docNo },
      locationId: input.locationId,
    })
    return outcome.approvalId
  }
  return undefined
}

/* ================================================================== *
 * Quotations
 * ================================================================== */

export const saveQuotation = defineCommand({
  name: "stl.saveQuotation",
  permission: "stl.quote.create",
  input: z.object({
    quotationId: z.string().optional(),
    expectedVersion: z.number().optional(),
    locationId: z.string().optional(),
    partyId: z.string(),
    vehicleId: z.string().optional(),
    requests: z.array(LINE_REQUEST).min(1),
    discountPct: z.number().min(0).max(100).default(0),
    promotionId: z.string().optional(),
    inspectionNotes: z.string().default(""),
    inline: INLINE.optional(),
  }),
  async run(tx, input) {
    const existing = input.quotationId
      ? await tx.get("quotations", input.quotationId, {
          expectedVersion: input.expectedVersion,
        })
      : undefined
    if (existing && existing.status !== "draft" && existing.status !== "sent")
      tx.reject("STL_QUOTE_CLOSED", { no: existing.quoteNo })
    const locationId =
      existing?.locationId ??
      input.locationId ??
      tx.actor.locationId ??
      tx.reject("STL_NO_LOCATION")
    tx.requireLocation(locationId)
    const priced = await priceForParty(tx, input)
    const today = tx.today()
    const quoteNo =
      existing?.quoteNo ??
      (await nextDocNo(tx, "QT", { location: locationId, date: today }))
    const fields = {
      locationId,
      partyId: priced.party.id,
      vehicleId: priced.vehicle?.id,
      advisorId: existing?.advisorId ?? tx.actor.userId,
      priceListId: priced.priceListId,
      promotionId: input.promotionId,
      discountPct: input.discountPct,
      validUntil: addDaysISO(today, QUOTE_VALIDITY_DAYS),
      inspectionNotes: input.inspectionNotes,
      subtotalP: priced.subtotalP,
      discountP: priced.discountP,
      vatP: priced.vatP,
      totalP: priced.totalP,
    }
    let quotation = existing
      ? await tx.update("quotations", existing.id, fields)
      : tx.insert("quotations", { quoteNo, status: "draft", ...fields })
    // Keep an earlier approval when the percent did not change.
    const keep =
      existing?.discountApprovalId && existing.discountPct === input.discountPct
    const approvalId = keep
      ? existing.discountApprovalId
      : await discountApproval(tx, {
          ...input,
          docType: "quotations",
          docId: quotation.id,
          docNo: quoteNo,
          locationId,
        })
    quotation = await tx.update("quotations", quotation.id, {
      discountApprovalId: input.discountPct > 0 ? approvalId : undefined,
    })
    if (existing)
      for (const old of await tx.list(
        "quotationLines",
        "quotationId",
        existing.id
      ))
        await tx.remove("quotationLines", old.id)
    priced.lines.forEach((l, i) =>
      tx.insert("quotationLines", {
        quotationId: quotation.id,
        lineNo: i + 1,
        ...lineFields(l),
      })
    )
    tx.emit("QuotationSaved", {
      refs: {
        quotationId: quotation.id,
        partyId: priced.party.id,
        vehicleId: priced.vehicle?.id,
      },
      params: { no: quoteNo },
      locationId,
    })
    return { quotationId: quotation.id, quoteNo }
  },
})

const lineFields = (l: PricedDraft) => ({
  kind: l.kind,
  refId: l.refId,
  packageId: l.packageId,
  vehicleClass: l.vehicleClass,
  descriptionEn: l.descriptionEn,
  descriptionBn: l.descriptionBn,
  qty: l.qty,
  unitPriceP: l.unitPriceP,
  discountP: l.discountP,
  vatRatePct: l.vatRatePct,
  vatP: l.vatP,
  netP: l.netP,
  revenueTag: l.revenueTag,
})

/** Send a quotation by SMS or email (simulated): number, amount and validity only. */
export const sendQuotation = defineCommand({
  name: "stl.sendQuotation",
  permission: "stl.quote.create",
  input: z.object({
    quotationId: z.string(),
    channel: z.enum(["sms", "email"]),
    expectedVersion: z.number().optional(),
  }),
  async run(tx, input) {
    const quotation = await tx.get("quotations", input.quotationId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(quotation.locationId)
    if (quotation.status !== "draft" && quotation.status !== "sent")
      tx.reject("STL_QUOTE_CLOSED", { no: quotation.quoteNo })
    const party = await tx.get("parties", quotation.partyId)
    if (input.channel === "sms") {
      if (!party.phone) tx.reject("STL_NO_PHONE")
      queueSms(tx, {
        to: party.phone,
        partyId: party.id,
        lang: "en",
        templateId: "quotation-sent",
        params: {
          quoteNo: quotation.quoteNo,
          amount: smsMoney(quotation.totalP),
          date: smsDate(quotation.validUntil),
        },
      })
    } else {
      const email = party.email ?? tx.reject("STL_NO_EMAIL")
      queueEmail(tx, {
        to: [email],
        subjectKey: "stl.email.quotation",
        params: { no: quotation.quoteNo },
        attachments: [`${quotation.quoteNo}.pdf`],
        refs: { quotationId: quotation.id, partyId: party.id },
      })
    }
    await tx.update("quotations", quotation.id, {
      status: "sent",
      sentAt: tx.now(),
    })
    tx.emit("QuotationSent", {
      refs: { quotationId: quotation.id, partyId: party.id },
      params: { no: quotation.quoteNo },
      locationId: quotation.locationId,
    })
    return { quoteNo: quotation.quoteNo }
  },
})

const SCHEDULE = {
  scheduledAt: z.number().optional(),
  promisedAt: z.number().optional(),
  conditionNotes: z.string().optional(),
  odometerKm: z.number().int().min(0).optional(),
  deposit: DEPOSIT.optional(),
  idempotencyKey: z.string().min(8),
}

/** Insert an order (booked) with its lines; deposit, promotion count, events and SMS. */
async function bookOrder(
  tx: Tx,
  input: {
    locationId: Id
    priced: Awaited<ReturnType<typeof priceForParty>>
    quotationId?: Id
    promotionId?: Id
    discountPct: number
    discountApprovalId?: Id
    advisorId: Id
    scheduledAt?: number
    promisedAt?: number
    conditionNotes?: string
    odometerKm?: number
    deposit?: z.infer<typeof DEPOSIT>
    idempotencyKey: string
    lines?: PricedDraft[]
  }
): Promise<SalesOrderRow> {
  const { priced } = input
  const lines = input.lines ?? priced.lines
  const today = tx.today()
  const orderNo = await nextDocNo(tx, "SO", {
    location: input.locationId,
    date: today,
  })
  const scheduledAt = input.scheduledAt ?? tx.now()
  const minutes = lines.reduce((s, l) => s + l.durationMin, 0)
  const totals = {
    subtotalP: lines.reduce((s, l) => s + l.grossP, 0),
    discountP: lines.reduce((s, l) => s + l.discountP, 0),
    vatP: lines.reduce((s, l) => s + l.vatP, 0),
  }
  let order = tx.insert("salesOrders", {
    orderNo,
    kind: orderKindFor(priced.party, lines),
    locationId: input.locationId,
    partyId: priced.party.id,
    vehicleId: priced.vehicle?.id,
    quotationId: input.quotationId,
    advisorId: input.advisorId,
    priceListId: priced.priceListId,
    promotionId: input.promotionId,
    status: "booked",
    bookedOn: today,
    scheduledAt,
    promisedAt: input.promisedAt ?? scheduledAt + (minutes + 30) * MINUTE,
    discountPct: input.discountPct,
    discountApprovalId: input.discountApprovalId,
    advanceP: 0,
    odometerKm: input.odometerKm,
    conditionNotes: input.conditionNotes,
    photoCount: 0,
    ...totals,
    totalP: totals.subtotalP - totals.discountP + totals.vatP,
  })
  insertOrderLines(tx, order.id, lines)
  if (input.promotionId) {
    const promo = await tx.find("promotions", input.promotionId)
    if (promo && lines.some((l) => l.discountP > 0))
      await tx.update("promotions", promo.id, {
        usedCount: promo.usedCount + 1,
      })
  }
  tx.emit("OrderBooked", {
    refs: {
      orderId: order.id,
      partyId: order.partyId,
      vehicleId: order.vehicleId,
      quotationId: input.quotationId,
    },
    params: { no: orderNo },
    locationId: input.locationId,
  })
  if (input.deposit) {
    await takeDeposit(tx, order, input.deposit, input.idempotencyKey)
    order = await tx.get("salesOrders", order.id)
  }
  await sendBookingSms(tx, order, input.deposit?.amountP ?? 0)
  return order
}

/** Accept a quotation: the order (booked) from its priced lines, with an optional deposit (R3). */
export const acceptQuotation = defineCommand({
  name: "stl.acceptQuotation",
  permission: "stl.order.create",
  input: z.object({
    quotationId: z.string(),
    expectedVersion: z.number().optional(),
    ...SCHEDULE,
  }),
  async run(tx, input) {
    const quotation = await tx.get("quotations", input.quotationId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(quotation.locationId)
    if (quotation.status !== "draft" && quotation.status !== "sent")
      tx.reject("STL_QUOTE_CLOSED", { no: quotation.quoteNo })
    if (quotation.validUntil < tx.today())
      tx.reject("STL_QUOTE_EXPIRED", {
        no: quotation.quoteNo,
        date: quotation.validUntil,
      })
    const party = await tx.get("parties", quotation.partyId)
    const vehicle = quotation.vehicleId
      ? await tx.get("vehicles", quotation.vehicleId)
      : undefined
    const catalogue = await loadCatalogue(tx)
    const qLines = (
      await tx.list("quotationLines", "quotationId", quotation.id)
    ).sort((a, b) => a.lineNo - b.lineNo)
    const lines: PricedDraft[] = qLines.map((l) => ({
      ...lineFields(l as unknown as PricedDraft),
      grossP: Math.round(l.qty * l.unitPriceP),
      totalP: l.netP + l.vatP,
      durationMin: lineMinutes(catalogue, l),
    }))
    const order = await bookOrder(tx, {
      locationId: quotation.locationId,
      priced: {
        party,
        vehicle,
        priceListId: quotation.priceListId,
        catalogue,
        list: undefined,
        lines,
        subtotalP: quotation.subtotalP,
        discountP: quotation.discountP,
        vatP: quotation.vatP,
        totalP: quotation.totalP,
        promotionP: 0,
        durationMin: 0,
        problems: [],
      },
      quotationId: quotation.id,
      promotionId: quotation.promotionId,
      discountPct: quotation.discountPct,
      discountApprovalId: quotation.discountApprovalId,
      advisorId: tx.actor.userId,
      scheduledAt: input.scheduledAt,
      promisedAt: input.promisedAt,
      conditionNotes:
        input.conditionNotes ?? (quotation.inspectionNotes || undefined),
      odometerKm: input.odometerKm,
      deposit: input.deposit,
      idempotencyKey: input.idempotencyKey,
    })
    await tx.update("quotations", quotation.id, {
      status: "accepted",
      orderId: order.id,
    })
    tx.emit("QuotationAccepted", {
      refs: { quotationId: quotation.id, orderId: order.id, partyId: party.id },
      params: { no: quotation.quoteNo },
      locationId: quotation.locationId,
    })
    return { orderId: order.id, orderNo: order.orderNo }
  },
})

/** Book an order directly (service, product or B2B), with an optional deposit (R3). */
export const createOrder = defineCommand({
  name: "stl.createOrder",
  permission: "stl.order.create",
  input: z.object({
    locationId: z.string().optional(),
    partyId: z.string(),
    vehicleId: z.string().optional(),
    requests: z.array(LINE_REQUEST).min(1),
    discountPct: z.number().min(0).max(100).default(0),
    promotionId: z.string().optional(),
    inline: INLINE.optional(),
    ...SCHEDULE,
  }),
  async run(tx, input) {
    const locationId =
      input.locationId ?? tx.actor.locationId ?? tx.reject("STL_NO_LOCATION")
    tx.requireLocation(locationId)
    const priced = await priceForParty(tx, input)
    const order = await bookOrder(tx, {
      locationId,
      priced,
      promotionId: input.promotionId,
      discountPct: input.discountPct,
      advisorId: tx.actor.userId,
      scheduledAt: input.scheduledAt,
      promisedAt: input.promisedAt,
      conditionNotes: input.conditionNotes,
      odometerKm: input.odometerKm,
      deposit: input.deposit,
      idempotencyKey: input.idempotencyKey,
    })
    const approvalId = await discountApproval(tx, {
      ...input,
      docType: "salesOrders",
      docId: order.id,
      docNo: order.orderNo,
      locationId,
    })
    if (approvalId)
      await tx.update("salesOrders", order.id, {
        discountApprovalId: approvalId,
      })
    return { orderId: order.id, orderNo: order.orderNo }
  },
})

/* ================================================================== *
 * Scheduling and updates
 * ================================================================== */

/**
 * Schedule an order into a bay from a start time: one task per service or
 * add-on line, in line order, each with its technician; no double booking
 * of the bay or a technician (plan §6.1). Queued tasks are moved;
 * started or finished ones stay.
 */
export const scheduleOrder = defineCommand({
  name: "stl.scheduleOrder",
  permission: "stl.order.edit",
  input: z.object({
    orderId: z.string(),
    expectedVersion: z.number().optional(),
    bayId: z.string(),
    start: z.number(),
    assignments: z
      .array(z.object({ orderLineId: z.string(), technicianId: z.string() }))
      .min(1),
  }),
  async run(tx, input) {
    const order = await tx.get("salesOrders", input.orderId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(order.locationId)
    if (order.status !== "booked" && order.status !== "in-progress")
      tx.reject("STL_ORDER_STATUS", { no: order.orderNo })
    const bay = await tx.get("bays", input.bayId)
    if (bay.locationId !== order.locationId || !bay.active)
      tx.reject("STL_BAY_LOCATION", { bay: bay.code })
    const catalogue = await loadCatalogue(tx)
    const lines = (await tx.list("salesOrderLines", "orderId", order.id))
      .filter(isTaskLine)
      .sort((a, b) => a.lineNo - b.lineNo)
    const tasks = await tx.list("jobTasks", "orderId", order.id)
    const techOf = new Map(
      input.assignments.map((a) => [a.orderLineId, a.technicianId])
    )
    let cursor = input.start
    let scheduled = 0
    for (const line of lines) {
      const task = tasks.find((t) => t.orderLineId === line.id)
      if (task && task.status !== "queued") continue
      if (line.status === "done") continue
      const technicianId =
        techOf.get(line.id) ??
        task?.technicianId ??
        tx.reject("STL_NO_TECHNICIAN", { line: line.descriptionEn })
      await assertTechnician(tx, technicianId, order.locationId)
      const minutes = lineMinutes(catalogue, line)
      const end = cursor + minutes * MINUTE
      await assertFree(tx, {
        orderId: order.id,
        bayId: bay.id,
        technicianId,
        start: cursor,
        end,
      })
      const fields = {
        bayId: bay.id,
        technicianId,
        plannedStart: cursor,
        plannedMinutes: minutes,
      }
      if (task) await tx.update("jobTasks", task.id, fields)
      else
        tx.insert("jobTasks", {
          orderId: order.id,
          orderLineId: line.id,
          locationId: order.locationId,
          serviceId: line.kind === "service" ? line.refId : undefined,
          status: "queued",
          ...fields,
        })
      cursor = end
      scheduled += 1
    }
    if (!scheduled) tx.reject("STL_NOTHING_TO_SCHEDULE", { no: order.orderNo })
    await tx.update("salesOrders", order.id, {
      bayId: bay.id,
      scheduledAt: input.start,
      promisedAt: cursor + 30 * MINUTE,
    })
    tx.emit("JobScheduled", {
      refs: { orderId: order.id },
      params: { no: order.orderNo, bay: bay.code },
      locationId: order.locationId,
    })
    return { orderId: order.id, promisedAt: cursor + 30 * MINUTE }
  },
})

/** Update an order's details (promised time, notes, odometer, photos, complaint). */
export const updateOrder = defineCommand({
  name: "stl.updateOrder",
  permission: "stl.order.edit",
  input: z.object({
    orderId: z.string(),
    expectedVersion: z.number().optional(),
    promisedAt: z.number().optional(),
    conditionNotes: z.string().optional(),
    odometerKm: z.number().int().min(0).optional(),
    photoCount: z.number().int().min(0).max(40).optional(),
    complaintNote: z.string().optional(),
  }),
  async run(tx, input) {
    const order = await tx.get("salesOrders", input.orderId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(order.locationId)
    if (order.status === "cancelled")
      tx.reject("STL_ORDER_STATUS", { no: order.orderNo })
    const patch: Partial<SalesOrderRow> = {}
    if (input.promisedAt !== undefined) patch.promisedAt = input.promisedAt
    if (input.conditionNotes !== undefined)
      patch.conditionNotes = input.conditionNotes
    if (input.odometerKm !== undefined) patch.odometerKm = input.odometerKm
    if (input.photoCount !== undefined) patch.photoCount = input.photoCount
    if (input.complaintNote !== undefined)
      patch.complaintNote = input.complaintNote
    await tx.update("salesOrders", order.id, patch)
    return { orderId: order.id }
  },
})

/** Cancel an order with a reason: consumables stay consumed, any deposit stays as customer advance. */
export const cancelOrder = defineCommand({
  name: "stl.cancelOrder",
  permission: "stl.order.cancel",
  input: z.object({
    orderId: z.string(),
    reason: z.string().trim().min(3),
    expectedVersion: z.number().optional(),
  }),
  async run(tx, input) {
    const order = await tx.get("salesOrders", input.orderId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(order.locationId)
    if (!["booked", "in-progress", "qc"].includes(order.status))
      tx.reject("STL_ORDER_STATUS", { no: order.orderNo })
    for (const line of await tx.list("salesOrderLines", "orderId", order.id)) {
      if (line.status === "open" && line.qtyDelivered === 0)
        await tx.update("salesOrderLines", line.id, { status: "cancelled" })
    }
    await tx.update("salesOrders", order.id, {
      status: "cancelled",
      cancelReason: input.reason,
      cancelledAt: tx.now(),
    })
    tx.auditContext({ reason: input.reason })
    tx.emit("OrderCancelled", {
      refs: { orderId: order.id, partyId: order.partyId },
      params: { no: order.orderNo },
      locationId: order.locationId,
    })
    return { orderId: order.id }
  },
})

/* ================================================================== *
 * Tasks and consumption
 * ================================================================== */

export const startTask = defineCommand({
  name: "stl.startTask",
  permission: "stl.job.work",
  input: z.object({
    taskId: z.string(),
    expectedVersion: z.number().optional(),
  }),
  async run(tx, input) {
    const task = await tx.get("jobTasks", input.taskId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(task.locationId)
    assertOwnTask(tx, task)
    if (task.status !== "queued") tx.reject("STL_TASK_STATUS")
    const order = await tx.get("salesOrders", task.orderId)
    if (order.status !== "booked" && order.status !== "in-progress")
      tx.reject("STL_ORDER_STATUS", { no: order.orderNo })
    await tx.update("jobTasks", task.id, {
      status: "in-progress",
      startedAt: tx.now(),
    })
    if (order.status === "booked")
      await tx.update("salesOrders", order.id, {
        status: "in-progress",
        startedAt: tx.now(),
      })
    tx.emit("TaskStarted", {
      refs: { orderId: order.id, taskId: task.id },
      params: { no: order.orderNo },
      locationId: order.locationId,
    })
    return { orderId: order.id }
  },
})

/**
 * Finish a task: the line's recipe is issued FEFO at the studio with R4 in
 * the same commit (once per line: rework after a failed QC issues nothing
 * new); the order goes to QC when every task line is done.
 */
export const finishTask = defineCommand({
  name: "stl.finishTask",
  permission: "stl.job.work",
  input: z.object({
    taskId: z.string(),
    expectedVersion: z.number().optional(),
  }),
  async run(tx, input) {
    const task = await tx.get("jobTasks", input.taskId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(task.locationId)
    assertOwnTask(tx, task)
    if (task.status !== "in-progress") tx.reject("STL_TASK_STATUS")
    const order = await tx.get("salesOrders", task.orderId)
    if (order.status !== "in-progress")
      tx.reject("STL_ORDER_STATUS", { no: order.orderNo })
    const line = await tx.get("salesOrderLines", task.orderLineId)
    const now = tx.now()
    await tx.update("jobTasks", task.id, {
      status: "done",
      finishedAt: now,
      minutes: Math.max(
        1,
        Math.round((now - (task.startedAt ?? now)) / MINUTE)
      ),
    })
    await tx.update("salesOrderLines", line.id, { status: "done" })

    let valueP = 0
    const consumed = (
      await tx.list("jobConsumptions", "orderId", order.id)
    ).some((c) => c.orderLineId === line.id && c.kind === "recipe")
    if (line.kind === "service" && !consumed) {
      const catalogue = await loadCatalogue(tx)
      const recipe = recipeFor(catalogue, line.refId, line.vehicleClass ?? "SD")
      valueP = await issueToJob(tx, {
        order,
        orderLineId: line.id,
        taskId: task.id,
        locationId: task.locationId,
        lines: recipe.map((r) => ({
          itemId: r.itemId,
          qtyBase: r.qtyBase,
          standardQty: r.qtyBase,
        })),
        kind: "recipe",
        by: task.technicianId,
        narration: `Consumables used, ${order.orderNo}`,
      })
      if (recipe.length) {
        tx.emit("ConsumablesIssued", {
          refs: { orderId: order.id, taskId: task.id },
          params: { no: order.orderNo },
          locationId: order.locationId,
        })
      }
    }
    tx.emit("TaskFinished", {
      refs: { orderId: order.id, taskId: task.id },
      params: { no: order.orderNo },
      locationId: order.locationId,
    })

    const lines = (
      await tx.list("salesOrderLines", "orderId", order.id)
    ).filter(isTaskLine)
    const allDone = lines.every((l) => l.status === "done")
    if (allDone)
      await tx.update("salesOrders", order.id, { status: "qc", qcAt: now })
    return { orderId: order.id, valueP, toQc: allDone }
  },
})

/** Extra consumables issued to a job (R4) or unused stock returned from it (R4 reversed). */
export const recordConsumption = defineCommand({
  name: "stl.recordConsumption",
  permission: "stl.job.work",
  input: z.object({
    orderId: z.string(),
    taskId: z.string().optional(),
    itemId: z.string(),
    qtyBase: z.number().positive(),
    kind: z.enum(["extra", "return"]),
  }),
  async run(tx, input) {
    const order = await tx.get("salesOrders", input.orderId)
    tx.requireLocation(order.locationId)
    if (!["booked", "in-progress", "qc"].includes(order.status))
      tx.reject("STL_ORDER_STATUS", { no: order.orderNo })
    const tasks = await tx.list("jobTasks", "orderId", order.id)
    const task = input.taskId
      ? tasks.find((t) => t.id === input.taskId)
      : tasks.find((t) => t.technicianId === tx.actor.userId)
    if (input.taskId && !task) tx.reject("STL_TASK_STATUS")
    if (task) assertOwnTask(tx, task)
    else if (!tx.can("stl.order.edit", order.locationId))
      tx.reject("STL_NOT_YOUR_TASK", {}, { audit: true })
    const item = await tx.get("items", input.itemId)
    if (item.kind === "retail")
      tx.reject("PC_RECIPE_RETAIL", { item: item.sku })
    const by = task?.technicianId ?? tx.actor.userId
    if (input.kind === "extra") {
      await issueToJob(tx, {
        order,
        orderLineId: task?.orderLineId,
        taskId: task?.id,
        locationId: order.locationId,
        lines: [{ itemId: item.id, qtyBase: input.qtyBase, standardQty: 0 }],
        kind: "extra",
        by,
        narration: `Extra consumables, ${order.orderNo}`,
      })
    } else {
      await returnFromJob(tx, {
        order,
        orderLineId: task?.orderLineId,
        taskId: task?.id,
        locationId: order.locationId,
        item,
        qtyBase: input.qtyBase,
        by,
        narration: `Unused consumables returned, ${order.orderNo}`,
      })
    }
    tx.emit("ConsumablesIssued", {
      refs: { orderId: order.id, itemId: item.id },
      params: { no: order.orderNo },
      locationId: order.locationId,
    })
    return { orderId: order.id }
  },
})

/* ================================================================== *
 * QC
 * ================================================================== */

/** QC keys checked before a vehicle is ready (labels in stl.qc.items). */
export const QC_KEYS = ["finish", "interior", "glass", "wheels"] as const

/**
 * QC check: every item OK passes (ready, the vehicle-ready SMS); any item not
 * OK fails (back to in progress for rework, then QC again).
 */
export const qcCheck = defineCommand({
  name: "stl.qcCheck",
  permission: "stl.qc.check",
  input: z.object({
    orderId: z.string(),
    expectedVersion: z.number().optional(),
    items: z
      .array(
        z.object({
          key: z.string(),
          ok: z.boolean(),
          note: z.string().optional(),
        })
      )
      .min(1),
  }),
  async run(tx, input) {
    const order = await tx.get("salesOrders", input.orderId, {
      expectedVersion: input.expectedVersion,
    })
    tx.requireLocation(order.locationId)
    const lines = (
      await tx.list("salesOrderLines", "orderId", order.id)
    ).filter(isTaskLine)
    const reworkDone =
      order.status === "in-progress" &&
      lines.length > 0 &&
      lines.every((l) => l.status === "done")
    if (order.status !== "qc" && !reworkDone)
      tx.reject("STL_ORDER_STATUS", { no: order.orderNo })
    const items: QcItem[] = input.items.map((i) => ({
      key: i.key,
      ok: i.ok,
      note: i.note?.trim() || undefined,
    }))
    const pass = items.every((i) => i.ok)
    const now = tx.now()
    tx.insert("qcChecks", {
      orderId: order.id,
      items,
      result: pass ? "pass" : "fail",
      checkedBy: tx.actor.userId,
      at: now,
    })
    const refs = { orderId: order.id, partyId: order.partyId }
    if (pass) {
      await tx.update("salesOrders", order.id, {
        status: "ready",
        readyAt: now,
        qcAt: order.qcAt ?? now,
      })
      tx.emit("QcPassed", {
        refs,
        params: { no: order.orderNo },
        locationId: order.locationId,
      })
      tx.emit("OrderReady", {
        refs,
        params: { no: order.orderNo },
        locationId: order.locationId,
      })
      const party = await tx.get("parties", order.partyId)
      if (party.smsConsent && party.phone) {
        queueSms(tx, {
          to: party.phone,
          partyId: party.id,
          lang: "en",
          templateId: "vehicle-ready",
          params: { orderNo: order.orderNo },
        })
      }
    } else {
      await tx.update("salesOrders", order.id, { status: "in-progress" })
      tx.emit("QcFailed", {
        refs,
        params: { no: order.orderNo },
        locationId: order.locationId,
      })
    }
    return { result: pass ? ("pass" as const) : ("fail" as const) }
  },
})

/* ================================================================== *
 * Quick add customer (advisor and cashier screens)
 * ================================================================== */

/**
 * A new retail customer with a vehicle from the quotation or booking screen
 * (plan §9 "quick add"), through PAR's own create and add-vehicle steps
 * (par.customer.create, unique registration, the retail price list) in one
 * commit. A phone number already on file is refused here, so the advisor
 * picks the existing customer (PAR's full form only warns about look-alikes).
 */
export const quickAddCustomer = defineCommand({
  name: "stl.quickAddCustomer",
  permission: "par.customer.create",
  input: z.object({
    nameEn: z.string().trim().min(2),
    nameBn: z.string().trim().optional(),
    phone: z
      .string()
      .trim()
      .regex(/^01\d{3}-?\d{6}$/),
    vehicle: z
      .object({
        regNo: z.string().trim().min(4),
        make: z.string().trim().min(2),
        model: z.string().trim().min(1),
        year: z.number().int().min(1980).max(2100).optional(),
        colour: z.string().trim().default(""),
        vehicleClass: z.enum(["HB", "SD", "SUV", "LSUV", "MPV"]),
      })
      .optional(),
  }),
  async run(tx, input) {
    const phone = input.phone.includes("-")
      ? input.phone
      : `${input.phone.slice(0, 5)}-${input.phone.slice(5)}`
    const [samePhone] = await tx.list("parties", "phone", phone)
    if (samePhone)
      tx.reject("STL_PHONE_TAKEN", {
        name: samePhone.nameEn,
        code: samePhone.code,
      })
    const { party } = await createPartyTx(
      tx,
      partyFields.parse({
        isCustomer: true,
        isVendor: false,
        type: "individual",
        nameEn: input.nameEn,
        nameBn: input.nameBn,
        segment: "retail",
        phone,
      })
    )
    let vehicleId: Id | undefined
    if (input.vehicle) {
      const { year, ...vehicle } = input.vehicle
      vehicleId = (
        await addVehicleTx(
          tx,
          addVehicleInput.parse({
            ...vehicle,
            year: year ?? 2020,
            partyId: party.id,
          })
        )
      ).id
    }
    return { partyId: party.id, vehicleId }
  },
})

export { QC_KEYS as STL_QC_KEYS }
