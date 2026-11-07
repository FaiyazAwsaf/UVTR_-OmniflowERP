import { dhakaTime } from "@/core/clock/dates"
import type { SalesOrderRow } from "@/core/db/schema"
import type { ScenarioDef, ScenarioKit, ScenarioOutcome } from "@/core/scenarios/types"

import { advanceOf, bringJourneyTo, clearJourney, JOURNEY, journeyInvoice, STAGE } from "./journey"

/**
 * Main-journey jump launchers (plan §10 J1 to J6). J1 starts the journey over
 * (an open journey booking is cancelled and its deposit returned, the
 * ceramic kit topped up); J2 to J6 bring it forward to their step from
 * wherever it stands, never undoing the presenter's live work.
 */

async function vehicleLine(kit: ScenarioKit): Promise<{ regNo: string; vehicle: string; customer: string }> {
  const vehicle = await kit.db.vehicles.get(JOURNEY.vehicleId)
  const party = await kit.db.parties.get(JOURNEY.partyId)
  return {
    regNo: vehicle?.regNo ?? "",
    vehicle: vehicle ? `${vehicle.make} ${vehicle.model}` : "",
    customer: party?.nameEn ?? "",
  }
}

async function orderParams(kit: ScenarioKit, order: SalesOrderRow): Promise<ScenarioOutcome> {
  const first = await kit.db.jobTasks.where("orderId").equals(order.id).sortBy("plannedStart")
  return {
    refs: { orderId: order.id, partyId: order.partyId, vehicleId: order.vehicleId },
    params: {
      ...(await vehicleLine(kit)),
      orderNo: order.orderNo,
      totalP: order.totalP,
      depositP: order.advanceP,
      bay: "C1",
      time: first[0] ? dhakaTime(first[0].plannedStart) : JOURNEY.firstSlot,
    },
  }
}

const cue = (id: string, n: number) => Array.from({ length: n }, (_, i) => `demo.journey.${id}.cue${i + 1}`)

export const demoScenarios: ScenarioDef[] = [
  {
    id: "J1",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J1.title",
    summaryKey: "demo.journey.J1.summary",
    user: JOURNEY.advisor,
    async setup(kit) {
      await clearJourney(kit)
      return {
        refs: { partyId: JOURNEY.partyId, vehicleId: JOURNEY.vehicleId },
        params: { ...(await vehicleLine(kit)), depositP: JOURNEY.depositP },
      }
    },
    route: () => "/stl/quotations/new",
    cueKeys: cue("J1", 5),
  },
  {
    id: "J2",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J2.title",
    summaryKey: "demo.journey.J2.summary",
    user: JOURNEY.technician,
    async setup(kit) {
      return orderParams(kit, await bringJourneyTo(kit, STAGE.scheduled))
    },
    route: () => "/stl/my-jobs",
    cueKeys: cue("J2", 4),
  },
  {
    id: "J3",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J3.title",
    summaryKey: "demo.journey.J3.summary",
    user: JOURNEY.manager,
    async setup(kit) {
      return orderParams(kit, await bringJourneyTo(kit, STAGE.qc))
    },
    route: (outcome) => `/sd/handover/${outcome.refs?.orderId ?? ""}`,
    cueKeys: cue("J3", 4),
  },
  {
    id: "J4",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J4.title",
    summaryKey: "demo.journey.J4.summary",
    user: JOURNEY.cashier,
    async setup(kit) {
      const order = await bringJourneyTo(kit, STAGE.delivered)
      const outcome = await orderParams(kit, order)
      // The invoice applies the customer's whole advance (this deposit, plus any earlier one).
      const appliedP = Math.min(order.totalP, await advanceOf(kit))
      return { ...outcome, params: { ...outcome.params, depositP: appliedP, cardP: JOURNEY.cardP } }
    },
    route: () => "/si/counter",
    cueKeys: cue("J4", 5),
  },
  {
    id: "J5",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J5.title",
    summaryKey: "demo.journey.J5.summary",
    user: "mahbub",
    async setup(kit) {
      const order = await bringJourneyTo(kit, STAGE.paid)
      const invoice = await journeyInvoice(kit, order.id)
      const outcome = await orderParams(kit, order)
      return {
        refs: { ...outcome.refs, invoiceId: invoice?.id },
        params: { ...outcome.params, invoiceNo: invoice?.invoiceNo ?? "", invoiceP: invoice?.totalP ?? 0 },
      }
    },
    route: () => "/fa/journals",
    cueKeys: cue("J5", 4),
  },
  {
    id: "J6",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J6.title",
    summaryKey: "demo.journey.J6.summary",
    user: "rashed",
    async setup(kit) {
      const order = await bringJourneyTo(kit, STAGE.paid)
      const invoice = await journeyInvoice(kit, order.id)
      const outcome = await orderParams(kit, order)
      return {
        refs: { ...outcome.refs, invoiceId: invoice?.id },
        params: { ...outcome.params, invoiceNo: invoice?.invoiceNo ?? "", invoiceP: invoice?.totalP ?? 0 },
      }
    },
    route: () => "/dashboard",
    cueKeys: cue("J6", 4),
  },
]
