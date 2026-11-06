import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by ST (implementation_plan.md §3.10). */
export const stEvents: EventCatalog = {
  TransferRequested: {
    module: "st",
    labelKey: "st.events.TransferRequested",
    consumers: ["consumers.locations", "consumers.gl"],
    severity: "info",
  },
  TransferDispatched: {
    module: "st",
    labelKey: "st.events.TransferDispatched",
    consumers: ["consumers.locations", "consumers.gl"],
    severity: "info",
  },
  TransferReceived: {
    module: "st",
    labelKey: "st.events.TransferReceived",
    consumers: ["consumers.locations", "consumers.gl"],
    severity: "success",
  },
  StockIssued: {
    module: "st",
    labelKey: "st.events.StockIssued",
    consumers: ["consumers.locations", "consumers.gl"],
    severity: "info",
  },
  AdjustmentSubmitted: {
    module: "st",
    labelKey: "st.events.AdjustmentSubmitted",
    consumers: ["consumers.locations", "consumers.gl"],
    severity: "warning",
  },
  AdjustmentPosted: {
    module: "st",
    labelKey: "st.events.AdjustmentPosted",
    consumers: ["consumers.locations", "consumers.gl"],
    severity: "success",
  },
}
