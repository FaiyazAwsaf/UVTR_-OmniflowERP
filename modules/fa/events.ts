import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by FA (implementation_plan.md §3.10). */
export const faEvents: EventCatalog = {
  JournalPosted: {
    module: "fa",
    labelKey: "fa.events.JournalPosted",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "success",
  },
  JournalSubmitted: {
    module: "fa",
    labelKey: "fa.events.JournalSubmitted",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "warning",
  },
  JournalApproved: {
    module: "fa",
    labelKey: "fa.events.JournalApproved",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "success",
  },
  JournalReversed: {
    module: "fa",
    labelKey: "fa.events.JournalReversed",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "info",
  },
  JournalDiscarded: {
    module: "fa",
    labelKey: "fa.events.JournalDiscarded",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "info",
  },
  PeriodClosed: {
    module: "fa",
    labelKey: "fa.events.PeriodClosed",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "success",
  },
  PeriodReopened: {
    module: "fa",
    labelKey: "fa.events.PeriodReopened",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "warning",
  },
  RecurringPosted: {
    module: "fa",
    labelKey: "fa.events.RecurringPosted",
    consumers: ["consumers.reports", "consumers.audit"],
    severity: "success",
  },
}
