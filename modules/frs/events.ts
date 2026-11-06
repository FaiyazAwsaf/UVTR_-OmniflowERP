import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by FRS (implementation_plan.md §3.10). */
export const frsEvents: EventCatalog = {
  VatReturnSubmitted: {
    module: "frs",
    labelKey: "frs.events.VatReturnSubmitted",
    consumers: ["consumers.tax", "consumers.audit"],
    severity: "success",
  },
  TaxPaid: {
    module: "frs",
    labelKey: "frs.events.TaxPaid",
    consumers: ["consumers.tax", "consumers.audit"],
    severity: "success",
  },
}
