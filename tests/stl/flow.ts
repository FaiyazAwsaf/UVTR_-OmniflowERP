import type { OmniflowDb } from "@/core/db/database"
import type { Id } from "@/core/db/schema"
import type { Actor } from "@/core/engine/types"
import type { LineRequest } from "@/modules/pc/pricing"
import { createOrder, finishTask, qcCheck, scheduleOrder, startTask } from "@/modules/stl/commands"
import { handover } from "@/modules/sd/commands"

import { key, run } from "./helpers"

type As = (username: string) => Promise<Actor>

/**
 * Drive an order through the studio (book, schedule, tasks, QC) to `ready`,
 * or on to `delivered` with a handover: the J1 to J3 path in one call.
 */
export async function orderThrough(
  db: OmniflowDb,
  as: As,
  opts: {
    partyId: Id
    vehicleId: Id
    requests: LineRequest[]
    bayId: Id
    start: number
    technician: string
    technicianId: Id
    deposit?: { method: "cash" | "card" | "bkash" | "nagad"; amountP: number }
    until: "booked" | "ready" | "delivered"
    advisor?: string
    manager?: string
  }
): Promise<Id> {
  const advisor = await as(opts.advisor ?? "nayeem")
  const { orderId } = await run(db, advisor, createOrder, {
    partyId: opts.partyId,
    vehicleId: opts.vehicleId,
    requests: opts.requests,
    deposit: opts.deposit ? { ...opts.deposit, confirmed: true } : undefined,
    idempotencyKey: key("order"),
  })
  if (opts.until === "booked") return orderId
  const lines = (await db.salesOrderLines.where("orderId").equals(orderId).sortBy("lineNo")).filter((l) => l.kind !== "item")
  await run(db, advisor, scheduleOrder, {
    orderId,
    bayId: opts.bayId,
    start: opts.start,
    assignments: lines.map((l) => ({ orderLineId: l.id, technicianId: opts.technicianId })),
  })
  const tech = await as(opts.technician)
  for (const task of await db.jobTasks.where("orderId").equals(orderId).sortBy("plannedStart")) {
    await run(db, tech, startTask, { taskId: task.id })
    await run(db, tech, finishTask, { taskId: task.id })
  }
  const manager = await as(opts.manager ?? "shahriar")
  await run(db, manager, qcCheck, { orderId, items: ["finish", "interior", "glass", "wheels"].map((k) => ({ key: k, ok: true })) })
  if (opts.until === "ready") return orderId
  await run(db, manager, handover, {
    orderId,
    checklist: ["exterior", "interior", "glass", "wheels", "belongings"].map((k) => ({ key: k, ok: true })),
    signatureName: "Customer",
    signatureSvg: "M10 10 L40 30 L80 12",
  })
  return orderId
}
