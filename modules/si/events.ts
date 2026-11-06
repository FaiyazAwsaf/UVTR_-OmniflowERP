import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by SI (implementation_plan.md §3.10). */
export const siEvents: EventCatalog = {
  InvoiceIssued: {
    module: "si",
    labelKey: "si.events.InvoiceIssued",
    consumers: ["consumers.ar", "consumers.gl", "consumers.vatRegister", "consumers.cash", "consumers.audit"],
    severity: "success",
  },
  ConsolidatedInvoiceIssued: {
    module: "si",
    labelKey: "si.events.ConsolidatedInvoiceIssued",
    consumers: ["consumers.ar", "consumers.gl", "consumers.vatRegister", "consumers.cash", "consumers.audit"],
    severity: "success",
  },
  CounterPaid: {
    module: "si",
    labelKey: "si.events.CounterPaid",
    consumers: ["consumers.ar", "consumers.gl", "consumers.vatRegister", "consumers.cash", "consumers.audit"],
    severity: "success",
  },
  PaymentPending: {
    module: "si",
    labelKey: "si.events.PaymentPending",
    consumers: ["consumers.ar", "consumers.gl", "consumers.vatRegister", "consumers.cash", "consumers.audit"],
    severity: "warning",
  },
  PaymentConfirmed: {
    module: "si",
    labelKey: "si.events.PaymentConfirmed",
    consumers: ["consumers.ar", "consumers.gl", "consumers.vatRegister", "consumers.cash", "consumers.audit"],
    severity: "success",
  },
  PaymentTimedOut: {
    module: "si",
    labelKey: "si.events.PaymentTimedOut",
    consumers: ["consumers.ar", "consumers.gl", "consumers.vatRegister", "consumers.cash", "consumers.audit"],
    severity: "warning",
  },
  CreditNoteIssued: {
    module: "si",
    labelKey: "si.events.CreditNoteIssued",
    consumers: ["consumers.ar", "consumers.gl", "consumers.vatRegister", "consumers.cash", "consumers.audit"],
    severity: "info",
  },
}
