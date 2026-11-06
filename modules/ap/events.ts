import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by AP (implementation_plan.md §3.10). */
export const apEvents: EventCatalog = {
  BillRecorded: {
    module: "ap",
    labelKey: "ap.events.BillRecorded",
    consumers: ["consumers.gl", "consumers.cash", "consumers.taxRegisters"],
    severity: "success",
  },
  BillOnHold: {
    module: "ap",
    labelKey: "ap.events.BillOnHold",
    consumers: ["consumers.gl", "consumers.cash", "consumers.taxRegisters"],
    severity: "warning",
  },
  BillReleased: {
    module: "ap",
    labelKey: "ap.events.BillReleased",
    consumers: ["consumers.gl", "consumers.cash", "consumers.taxRegisters"],
    severity: "success",
  },
  PaymentSubmitted: {
    module: "ap",
    labelKey: "ap.events.PaymentSubmitted",
    consumers: ["consumers.gl", "consumers.cash", "consumers.taxRegisters"],
    severity: "warning",
  },
  VendorPaid: {
    module: "ap",
    labelKey: "ap.events.VendorPaid",
    consumers: ["consumers.gl", "consumers.cash", "consumers.taxRegisters"],
    severity: "success",
  },
}
