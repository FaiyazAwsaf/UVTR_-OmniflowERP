import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by CAB (implementation_plan.md §3.10). */
export const cabEvents: EventCatalog = {
  FundsTransferred: {
    module: "cab",
    labelKey: "cab.events.FundsTransferred",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "info",
  },
  SettlementRecorded: {
    module: "cab",
    labelKey: "cab.events.SettlementRecorded",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "info",
  },
  ChequeDeposited: {
    module: "cab",
    labelKey: "cab.events.ChequeDeposited",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "info",
  },
  ChequeCleared: {
    module: "cab",
    labelKey: "cab.events.ChequeCleared",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "success",
  },
  ChequeBounced: {
    module: "cab",
    labelKey: "cab.events.ChequeBounced",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "critical",
  },
  StatementImported: {
    module: "cab",
    labelKey: "cab.events.StatementImported",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "info",
  },
  StatementLineMatched: {
    module: "cab",
    labelKey: "cab.events.StatementLineMatched",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "info",
  },
  ReconciliationCompleted: {
    module: "cab",
    labelKey: "cab.events.ReconciliationCompleted",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "success",
  },
  PettyCashSpent: {
    module: "cab",
    labelKey: "cab.events.PettyCashSpent",
    consumers: ["consumers.gl", "consumers.ar", "consumers.ap"],
    severity: "info",
  },
}
