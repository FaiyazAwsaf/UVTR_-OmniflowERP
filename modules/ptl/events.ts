import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by PTL (implementation_plan.md §3.10). */
export const ptlEvents: EventCatalog = {
  RequisitionSubmitted: {
    module: "ptl",
    labelKey: "ptl.events.RequisitionSubmitted",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "info",
  },
  RequisitionApproved: {
    module: "ptl",
    labelKey: "ptl.events.RequisitionApproved",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "success",
  },
  RequisitionRejected: {
    module: "ptl",
    labelKey: "ptl.events.RequisitionRejected",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "warning",
  },
  PurchaseOrderIssued: {
    module: "ptl",
    labelKey: "ptl.events.PurchaseOrderIssued",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "success",
  },
  PurchaseOrderApproved: {
    module: "ptl",
    labelKey: "ptl.events.PurchaseOrderApproved",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "success",
  },
  PurchaseOrderCancelled: {
    module: "ptl",
    labelKey: "ptl.events.PurchaseOrderCancelled",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "warning",
  },
  PurchaseReturned: {
    module: "ptl",
    labelKey: "ptl.events.PurchaseReturned",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "info",
  },
  DebitNoteIssued: {
    module: "ptl",
    labelKey: "ptl.events.DebitNoteIssued",
    consumers: ["consumers.approverInbox", "consumers.vendor", "consumers.ap"],
    severity: "info",
  },
}
