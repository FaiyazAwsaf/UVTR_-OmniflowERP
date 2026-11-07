import type { Id, JobTaskRow, VehicleClass } from "@/core/db/schema"
import { previousRuns, setStockLevel } from "@/core/scenarios/helpers"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { BAY, ITM, LOC, PLANT, SVC, USR } from "@/core/seed/content/seed-refs"
import { roundQty } from "@/core/stock/value"
import { runKey, topUpWhenShort, usableAt } from "@/modules/ic/scenario-kit"
import { recipeFor } from "@/modules/pc/pricing"
import { cancelOrder, createOrder, scheduleOrder } from "@/modules/stl/commands"
import { MINUTE, taskInterval } from "@/modules/stl/orders"

import { cancelTransfer, receiveTransfer } from "./commands"

/**
 * E3 Stock-out for a job (plan §10): Uttara holds 20 ml of ceramic coating
 * 2-year and a fresh booked SUV ceramic 2-year job in its C1 needs 38 ml.
 * Arif requests a transfer from the Central Store on the order's stock check,
 * Habib dispatches it with the Mushak 6.5 challan, Arif receives it and the
 * job can proceed.
 */

const ITEM = ITM.cc2Kit
const SERVICE = SVC.PRT_CC2
const LEVEL = 20
const REASON = "Rebooked for the E3 stock-out demo"
/** Uttara's technicians on shift today (Polash is locked). */
const TECHNICIANS = [USR.kamrul, USR.jewel]
const BUSY = new Set(["booked", "in-progress", "qc"])
const STEP = 30 * MINUTE

/**
 * Clears what earlier runs left in the way (re-run rules): the previous
 * job (the seed's planted one on the first run) is cancelled while it is
 * still booked or in progress in the bay, and transfers raised for it are
 * withdrawn (still requested) or received (in transit), so the presenter
 * starts from a clean Transfers list.
 */
async function clearEarlierRuns(kit: ScenarioKit): Promise<void> {
  const db = kit.db
  const runs = await previousRuns(db, "E3")
  const ids = [...new Set([PLANT.e3Order, ...runs.map((r) => r.refs.orderId).filter((id): id is Id => !!id)])]
  const orderNos: string[] = []
  for (const id of ids) {
    const order = await db.salesOrders.get(id)
    if (!order) continue
    orderNos.push(order.orderNo)
    if (order.status === "booked" || order.status === "in-progress") {
      await kit.run(cancelOrder, { orderId: order.id, reason: REASON, expectedVersion: order.version }, "arif")
    }
  }
  if (!orderNos.length) return
  const open = await db.transfers.where("status").anyOf(["requested", "dispatched"]).toArray()
  for (const transfer of open) {
    if (transfer.toLocationId !== LOC.UTT || !orderNos.some((no) => transfer.note?.includes(no))) continue
    if (transfer.status === "requested") {
      await kit.run(cancelTransfer, { transferId: transfer.id, expectedVersion: transfer.version, reason: REASON }, "arif")
    } else {
      await kit.run(receiveTransfer, { transferId: transfer.id, expectedVersion: transfer.version, lines: [] }, "arif")
    }
  }
}

/** The customer and SUV of the planted E3 job (any SUV when it is missing). */
async function customerAndVehicle(kit: ScenarioKit): Promise<{ partyId: Id; vehicleId: Id; cls: VehicleClass }> {
  const planted = await kit.db.salesOrders.get(PLANT.e3Order)
  const vehicle = planted?.vehicleId ? await kit.db.vehicles.get(planted.vehicleId) : undefined
  if (planted && vehicle) return { partyId: planted.partyId, vehicleId: vehicle.id, cls: vehicle.vehicleClass }
  const suv = (await kit.db.vehicles.toArray()).find((v) => v.active && v.vehicleClass === "SUV")
  if (!suv) throw new Error("E3: no SUV in the seed")
  return { partyId: suv.partyId, vehicleId: suv.id, cls: suv.vehicleClass }
}

/** The first half hour from now when bay C1 and one of Uttara's technicians are free for the whole job. */
async function freeSlot(kit: ScenarioKit, minutes: number): Promise<{ start: number; technicianId: Id } | undefined> {
  const db = kit.db
  const statusOf = new Map<Id, string>()
  const live = async (tasks: JobTaskRow[]) => {
    const out: { start: number; end: number }[] = []
    for (const t of tasks) {
      if (t.status === "done") continue
      if (!statusOf.has(t.orderId)) statusOf.set(t.orderId, (await db.salesOrders.get(t.orderId))?.status ?? "cancelled")
      if (BUSY.has(statusOf.get(t.orderId)!)) out.push(taskInterval(t))
    }
    return out
  }
  const bay = await live(await db.jobTasks.where("bayId").equals(BAY.UTT_C1).toArray())
  const techs = await Promise.all(
    TECHNICIANS.map(async (id) => ({ id, busy: await live(await db.jobTasks.where("technicianId").equals(id).toArray()) }))
  )
  const free = (busy: { start: number; end: number }[], start: number, end: number) => busy.every((b) => end <= b.start || b.end <= start)
  const first = Math.ceil((kit.now() + 10 * MINUTE) / STEP) * STEP
  for (let start = first; start < first + 48 * 60 * MINUTE; start += STEP) {
    const end = start + minutes * MINUTE
    if (!free(bay, start, end)) continue
    const tech = techs.find((t) => free(t.busy, start, end))
    if (tech) return { start, technicianId: tech.id }
  }
  return undefined
}

export const e3StockOut: ScenarioDef = {
  id: "E3",
  kind: "scenario",
  module: "st",
  titleKey: "st.scenarios.e3.title",
  summaryKey: "st.scenarios.e3.summary",
  user: "arif",
  async setup(kit) {
    const db = kit.db
    const today = kit.today()
    await clearEarlierRuns(kit)

    const { partyId, vehicleId, cls } = await customerAndVehicle(kit)
    const items = new Map((await db.items.toArray()).map((i) => [i.id, i]))
    const recipe = recipeFor({ recipes: await db.serviceRecipes.where("serviceId").equals(SERVICE).toArray(), items }, SERVICE, cls)
    const need = roundQty(recipe.find((r) => r.itemId === ITEM)?.qtyBase ?? 0)
    if (need <= LEVEL) throw new Error(`E3: the recipe needs only ${need} of ${ITEM}`)

    // Only the ceramic coating is short: the job's other consumables are on the shelf.
    for (const line of recipe) {
      if (line.itemId !== ITEM) await topUpWhenShort(kit, { itemId: line.itemId, locationId: LOC.UTT, qtyBase: roundQty(line.qtyBase * 2) })
    }
    await setStockLevel(kit, { itemId: ITEM, locationId: LOC.UTT, qtyBase: LEVEL, mode: "exactly" })

    // The Central Store can send the shortfall in whole kits.
    const item = items.get(ITEM)!
    const short = roundQty(need - LEVEL)
    const transferQty = Math.ceil(short / item.purchaseFactor) * item.purchaseFactor
    await topUpWhenShort(kit, { itemId: ITEM, locationId: LOC.CST, qtyBase: Math.max(200, transferQty) })

    const order = await kit.run(
      createOrder,
      {
        locationId: LOC.UTT,
        partyId,
        vehicleId,
        requests: [{ kind: "service", serviceId: SERVICE }],
        idempotencyKey: runKey(kit, "order"),
      },
      "arif"
    )
    const variant = await db.serviceVariants.where("serviceId").equals(SERVICE).filter((v) => v.vehicleClass === cls).first()
    const slot = await freeSlot(kit, variant?.durationMin ?? 60)
    const line = (await db.salesOrderLines.where("orderId").equals(order.orderId).toArray()).find((l) => l.kind === "service")
    if (slot && line) {
      await kit.run(
        scheduleOrder,
        { orderId: order.orderId, bayId: BAY.UTT_C1, start: slot.start, assignments: [{ orderLineId: line.id, technicianId: slot.technicianId }] },
        "arif"
      )
    }

    return {
      refs: { orderId: order.orderId, itemId: ITEM, locationId: LOC.UTT },
      params: {
        orderNo: order.orderNo,
        sku: item.sku,
        needQty: need,
        onHandQty: await usableAt(db, ITEM, LOC.UTT, today),
        shortQty: short,
        transferQty,
        afterQty: roundQty(LEVEL + transferQty),
      },
    }
  },
  route: (outcome) => `/stl/orders/${outcome.refs?.orderId ?? ""}`,
  cueKeys: ["st.scenarios.e3.cue1", "st.scenarios.e3.cue2", "st.scenarios.e3.cue3", "st.scenarios.e3.cue4", "st.scenarios.e3.cue5"],
  companion: { user: "habib", route: () => "/st/transfers" },
}

/** ST scenario launchers (implementation_plan.md §10). */
export const stScenarios: ScenarioDef[] = [e3StockOut]
