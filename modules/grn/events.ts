import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by GRN (implementation_plan.md §3.10). */
export const grnEvents: EventCatalog = {
  GoodsReceived: {
    module: "grn",
    labelKey: "grn.events.GoodsReceived",
    consumers: ["consumers.inventory", "consumers.ap", "consumers.gl"],
    severity: "success",
  },
  LotQuarantined: {
    module: "grn",
    labelKey: "grn.events.LotQuarantined",
    consumers: ["consumers.inventory", "consumers.ap", "consumers.gl"],
    severity: "warning",
  },
  QuarantineAccepted: {
    module: "grn",
    labelKey: "grn.events.QuarantineAccepted",
    consumers: ["consumers.inventory", "consumers.ap", "consumers.gl"],
    severity: "success",
  },
  QuarantineReturned: {
    module: "grn",
    labelKey: "grn.events.QuarantineReturned",
    consumers: ["consumers.inventory", "consumers.ap", "consumers.gl"],
    severity: "info",
  },
}
