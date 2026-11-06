import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by PC (implementation_plan.md §3.10). */
export const pcEvents: EventCatalog = {
  ServiceUpdated: {
    module: "pc",
    labelKey: "pc.events.ServiceUpdated",
    consumers: ["consumers.sales", "consumers.counter", "consumers.audit"],
    severity: "info",
  },
  RecipeUpdated: {
    module: "pc",
    labelKey: "pc.events.RecipeUpdated",
    consumers: ["consumers.sales", "consumers.counter", "consumers.audit"],
    severity: "info",
  },
  PriceListPublished: {
    module: "pc",
    labelKey: "pc.events.PriceListPublished",
    consumers: ["consumers.sales", "consumers.counter", "consumers.audit"],
    severity: "success",
  },
  PromotionSaved: {
    module: "pc",
    labelKey: "pc.events.PromotionSaved",
    consumers: ["consumers.sales", "consumers.counter", "consumers.audit"],
    severity: "info",
  },
}
