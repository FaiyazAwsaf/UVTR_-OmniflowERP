import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by PAR (implementation_plan.md §3.10). */
export const parEvents: EventCatalog = {
  PartyCreated: {
    module: "par",
    labelKey: "par.events.PartyCreated",
    consumers: ["consumers.ar", "consumers.ap", "consumers.sales", "consumers.audit"],
    severity: "success",
  },
  PartyUpdated: {
    module: "par",
    labelKey: "par.events.PartyUpdated",
    consumers: ["consumers.ar", "consumers.ap", "consumers.sales", "consumers.audit"],
    severity: "info",
  },
  PartyOnHold: {
    module: "par",
    labelKey: "par.events.PartyOnHold",
    consumers: ["consumers.ar", "consumers.ap", "consumers.sales", "consumers.audit"],
    severity: "warning",
  },
  PartyReleased: {
    module: "par",
    labelKey: "par.events.PartyReleased",
    consumers: ["consumers.ar", "consumers.ap", "consumers.sales", "consumers.audit"],
    severity: "success",
  },
  VehicleAdded: {
    module: "par",
    labelKey: "par.events.VehicleAdded",
    consumers: ["consumers.ar", "consumers.ap", "consumers.sales", "consumers.audit"],
    severity: "info",
  },
}
