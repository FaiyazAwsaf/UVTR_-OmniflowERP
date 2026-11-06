import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by AR (implementation_plan.md §3.10). */
export const arEvents: EventCatalog = {
  ReceiptRecorded: {
    module: "ar",
    labelKey: "ar.events.ReceiptRecorded",
    consumers: ["consumers.gl", "consumers.cash", "consumers.creditControl", "consumers.sms"],
    severity: "success",
  },
  AdvanceApplied: {
    module: "ar",
    labelKey: "ar.events.AdvanceApplied",
    consumers: ["consumers.gl", "consumers.cash", "consumers.creditControl", "consumers.sms"],
    severity: "info",
  },
  RefundPaid: {
    module: "ar",
    labelKey: "ar.events.RefundPaid",
    consumers: ["consumers.gl", "consumers.cash", "consumers.creditControl", "consumers.sms"],
    severity: "info",
  },
  CreditHoldSet: {
    module: "ar",
    labelKey: "ar.events.CreditHoldSet",
    consumers: ["consumers.gl", "consumers.cash", "consumers.creditControl", "consumers.sms"],
    severity: "warning",
  },
  CreditHoldReleased: {
    module: "ar",
    labelKey: "ar.events.CreditHoldReleased",
    consumers: ["consumers.gl", "consumers.cash", "consumers.creditControl", "consumers.sms"],
    severity: "success",
  },
  CreditOverrideApproved: {
    module: "ar",
    labelKey: "ar.events.CreditOverrideApproved",
    consumers: ["consumers.gl", "consumers.cash", "consumers.creditControl", "consumers.sms"],
    severity: "warning",
  },
  ReminderSent: {
    module: "ar",
    labelKey: "ar.events.ReminderSent",
    consumers: ["consumers.gl", "consumers.cash", "consumers.creditControl", "consumers.sms"],
    severity: "info",
  },
}
