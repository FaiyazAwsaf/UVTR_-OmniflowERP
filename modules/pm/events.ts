import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by PM (implementation_plan.md §3.10). */
export const pmEvents: EventCatalog = {
  ItemCreated: {
    module: "pm",
    labelKey: "pm.events.ItemCreated",
    consumers: ["consumers.inventory", "consumers.purchasing"],
    severity: "success",
  },
  ItemUpdated: {
    module: "pm",
    labelKey: "pm.events.ItemUpdated",
    consumers: ["consumers.inventory", "consumers.purchasing"],
    severity: "info",
  },
  ReorderRuleChanged: {
    module: "pm",
    labelKey: "pm.events.ReorderRuleChanged",
    consumers: ["consumers.inventory", "consumers.purchasing"],
    severity: "info",
  },
}
