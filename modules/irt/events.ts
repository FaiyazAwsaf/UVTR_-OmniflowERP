import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by IRT (implementation_plan.md §3.10). */
export const irtEvents: EventCatalog = {
  ReportSaved: {
    module: "irt",
    labelKey: "irt.events.ReportSaved",
    consumers: ["consumers.recipients"],
    severity: "success",
  },
  ReportScheduled: {
    module: "irt",
    labelKey: "irt.events.ReportScheduled",
    consumers: ["consumers.recipients"],
    severity: "info",
  },
  ReportEmailed: {
    module: "irt",
    labelKey: "irt.events.ReportEmailed",
    consumers: ["consumers.recipients"],
    severity: "info",
  },
}
