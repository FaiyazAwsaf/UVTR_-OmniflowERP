import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by STL (implementation_plan.md §3.10). */
export const stlEvents: EventCatalog = {
  QuotationSaved: {
    module: "stl",
    labelKey: "stl.events.QuotationSaved",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "info",
  },
  QuotationSent: {
    module: "stl",
    labelKey: "stl.events.QuotationSent",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "info",
  },
  QuotationAccepted: {
    module: "stl",
    labelKey: "stl.events.QuotationAccepted",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
  OrderBooked: {
    module: "stl",
    labelKey: "stl.events.OrderBooked",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
  DepositReceived: {
    module: "stl",
    labelKey: "stl.events.DepositReceived",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
  JobScheduled: {
    module: "stl",
    labelKey: "stl.events.JobScheduled",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "info",
  },
  TaskStarted: {
    module: "stl",
    labelKey: "stl.events.TaskStarted",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "info",
  },
  TaskFinished: {
    module: "stl",
    labelKey: "stl.events.TaskFinished",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
  ConsumablesIssued: {
    module: "stl",
    labelKey: "stl.events.ConsumablesIssued",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "info",
  },
  QcPassed: {
    module: "stl",
    labelKey: "stl.events.QcPassed",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
  QcFailed: {
    module: "stl",
    labelKey: "stl.events.QcFailed",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "warning",
  },
  OrderReady: {
    module: "stl",
    labelKey: "stl.events.OrderReady",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
  OrderCancelled: {
    module: "stl",
    labelKey: "stl.events.OrderCancelled",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "warning",
  },
  DiscountApproved: {
    module: "stl",
    labelKey: "stl.events.DiscountApproved",
    consumers: ["consumers.jobBoard", "consumers.inventory", "consumers.ar", "consumers.gl", "consumers.sms"],
    severity: "warning",
  },
}
