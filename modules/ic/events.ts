import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by IC (implementation_plan.md §3.10). */
export const icEvents: EventCatalog = {
  StockBelowReorder: {
    module: "ic",
    labelKey: "ic.events.StockBelowReorder",
    consumers: ["consumers.store", "consumers.purchasing", "consumers.dashboard"],
    severity: "warning",
  },
  CountOpened: {
    module: "ic",
    labelKey: "ic.events.CountOpened",
    consumers: ["consumers.store", "consumers.purchasing", "consumers.dashboard"],
    severity: "info",
  },
  CountPosted: {
    module: "ic",
    labelKey: "ic.events.CountPosted",
    consumers: ["consumers.store", "consumers.purchasing", "consumers.dashboard"],
    severity: "success",
  },
  ExpiryAlert: {
    module: "ic",
    labelKey: "ic.events.ExpiryAlert",
    consumers: ["consumers.store", "consumers.purchasing", "consumers.dashboard"],
    severity: "warning",
  },
}
