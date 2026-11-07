import type { BayKind } from "@/config/brand.config"
import { addDaysISO, atDhaka, DAY, MINUTE } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { ISODate, Id, JobTaskRow, Ms, UserRow } from "@/core/db/schema"
import { setStockLevel } from "@/core/scenarios/helpers"
import type { ScenarioKit } from "@/core/scenarios/types"
import { roundQty } from "@/core/stock/value"
import type { LineRequest } from "@/modules/pc/pricing"
import { handover, HANDOVER_KEYS } from "@/modules/sd/commands"

import { createOrder, finishTask, QC_KEYS, qcCheck, scheduleOrder, startTask } from "./commands"
import { readUsableQty } from "./stock-check"

/**
 * Launcher setup support for the sales apps (plan §10): book, schedule,
 * work, QC and hand over an order through the real commands, each as the
 * user who would do it, and find a bay and technician that are free so the
 * setup never collides with today's board. Reads committed data only.
 */

const BUSY = new Set(["booked", "in-progress", "qc"])

/** Tasks still holding a bay or technician at a studio around a moment (not done, order live). */
async function liveTasks(db: OmniflowDb, locationId: Id, from: Ms, to: Ms): Promise<JobTaskRow[]> {
  const tasks = (await db.jobTasks.where("plannedStart").between(from - 3 * DAY, to, true, true).toArray()).filter(
    (t) => t.locationId === locationId && t.status !== "done"
  )
  const orders = new Map((await db.salesOrders.bulkGet([...new Set(tasks.map((t) => t.orderId))])).filter(Boolean).map((o) => [o!.id, o!]))
  return tasks.filter((t) => BUSY.has(orders.get(t.orderId)?.status ?? "cancelled"))
}

/** Active technicians of a studio (the TECHNICIAN role), by username. */
export async function techniciansAt(db: OmniflowDb, locationId: Id): Promise<UserRow[]> {
  const role = await db.roles.where("code").equals("TECHNICIAN").first()
  if (!role) return []
  const links = await db.userRoles.where("roleId").equals(role.id).toArray()
  const users = (await db.users.bulkGet(links.map((l) => l.userId))).filter((u): u is UserRow => !!u)
  return users.filter((u) => u.status === "active" && u.locationIds.includes(locationId)).sort((a, b) => a.username.localeCompare(b.username))
}

export type Slot = { bayId: Id; technician: UserRow; start: Ms }

/**
 * A bay and a technician free for `minutes` from 07:00 on a past morning
 * (yesterday, or earlier for long work), so the done tasks never sit on
 * today's bay lanes and never block a booking. Wash or detailing bays first.
 */
export async function findPastSlot(
  db: OmniflowDb,
  input: { locationId: Id; minutes: number; today: ISODate; kinds?: BayKind[] }
): Promise<Slot> {
  const bays = (await db.bays.where("locationId").equals(input.locationId).toArray())
    .filter((b) => b.active)
    .sort((a, b) => {
      const rank = (k: BayKind) => {
        const i = (input.kinds ?? ["wash", "detailing", "coating"]).indexOf(k)
        return i < 0 ? 9 : i
      }
      return rank(a.kind) - rank(b.kind) || a.code.localeCompare(b.code)
    })
  const technicians = await techniciansAt(db, input.locationId)
  if (!bays.length || !technicians.length) throw new Error(`No bay or technician at ${input.locationId}`)
  const back = 1 + Math.floor(input.minutes / (24 * 60))
  for (let day = back; day < back + 14; day++) {
    const start = atDhaka(addDaysISO(input.today, -day), "07:00")
    const end = start + input.minutes * MINUTE
    const live = await liveTasks(db, input.locationId, start, end)
    const overlaps = (t: JobTaskRow) => t.plannedStart < end && start < t.plannedStart + t.plannedMinutes * MINUTE
    for (const bay of bays) {
      if (live.some((t) => t.bayId === bay.id && overlaps(t))) continue
      const technician = technicians.find((u) => !live.some((t) => t.technicianId === u.id && overlaps(t)))
      if (technician) return { bayId: bay.id, technician, start }
    }
  }
  throw new Error(`No free bay at ${input.locationId}`)
}

/**
 * Make sure a studio can issue what a setup's jobs will consume: an item
 * whose usable stock is below the need is topped up to twice the need with
 * the shared audited fixture (R22), so a launcher keeps working however
 * often it runs.
 */
export async function ensureStock(kit: ScenarioKit, locationId: Id, needs: Map<Id, number>): Promise<void> {
  for (const [itemId, need] of needs) {
    if (need <= 0) continue
    const usable = await readUsableQty(kit.db, itemId, locationId, kit.today())
    if (usable >= need) continue
    await setStockLevel(kit, { itemId, locationId, qtyBase: roundQty(Math.ceil(need * 2)), mode: "at-least" })
  }
}

export type CompleteOrderInput = {
  locationId: Id
  partyId: Id
  vehicleId: Id
  requests: LineRequest[]
  slot: Slot
  /** Books, schedules and hands over (an advisor or the studio manager) */
  advisor: string
  /** Runs QC */
  manager: string
  /** Unique within the run (idempotency) */
  key: string
  conditionNotes?: string
}

/**
 * Book an order and take it to `delivered` through the real commands: book
 * (advisor), schedule into the slot (advisor), start and finish every task
 * (the technician; finishing issues the recipe with R4), QC pass (manager)
 * and the vehicle handover with checklist and signature (advisor).
 */
export async function deliverOrder(kit: ScenarioKit, input: CompleteOrderInput): Promise<{ orderId: Id; orderNo: string }> {
  const { orderId, orderNo } = await kit.run(
    createOrder,
    {
      locationId: input.locationId,
      partyId: input.partyId,
      vehicleId: input.vehicleId,
      requests: input.requests,
      conditionNotes: input.conditionNotes,
      idempotencyKey: `${kit.runId}:${input.key}`,
    },
    input.advisor
  )
  const lines = (await kit.db.salesOrderLines.where("orderId").equals(orderId).sortBy("lineNo")).filter(
    (l) => (l.kind === "service" || l.kind === "add-on") && l.status !== "cancelled"
  )
  await kit.run(
    scheduleOrder,
    {
      orderId,
      bayId: input.slot.bayId,
      start: input.slot.start,
      assignments: lines.map((l) => ({ orderLineId: l.id, technicianId: input.slot.technician.id })),
    },
    input.advisor
  )
  const tasks = await kit.db.jobTasks.where("orderId").equals(orderId).sortBy("plannedStart")
  for (const task of tasks) {
    await kit.run(startTask, { taskId: task.id }, input.slot.technician.username)
    await kit.run(finishTask, { taskId: task.id }, input.slot.technician.username)
  }
  await kit.run(qcCheck, { orderId, items: QC_KEYS.map((key) => ({ key, ok: true })) }, input.manager)
  const party = await kit.db.parties.get(input.partyId)
  await kit.run(
    handover,
    {
      orderId,
      checklist: HANDOVER_KEYS.map((key) => ({ key, ok: true })),
      signatureName: party?.nameEn ?? "Customer",
      signatureSvg: "M12 30 C 30 8, 44 8, 52 26 S 76 44, 92 18",
    },
    input.advisor
  )
  return { orderId, orderNo }
}
