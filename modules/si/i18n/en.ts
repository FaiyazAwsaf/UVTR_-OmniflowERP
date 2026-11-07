/** SI strings, English. Every key also lives in bn.ts. */
export const siEn = {
  si: {
    name: "Sale Invoice",
    description: "Mushak 6.3 invoices, counter checkout and credit notes",
    pages: {
      home: "Invoices",
      counter: "Counter",
      invoiceNew: "New invoice",
      invoice: "Invoice",
      creditNotes: "Credit notes",
    },
    perm: {
      app_view: "Open Sale Invoice",
      export: "Export invoices and registers",
      invoice_issue: "Issue tax invoices",
      counter_checkout: "Check out at the counter",
      creditnote_create: "Raise credit notes",
      creditnote_approve: "Approve credit notes",
    },
    events: {
      InvoiceIssued: "Invoice {no} issued, {amount}",
      ConsolidatedInvoiceIssued: "Consolidated invoice {no} issued, {amount}",
      CounterPaid: "Counter payment {amount} on {no}",
      PaymentPending: "{method} payment pending on {no}",
      PaymentConfirmed: "{method} payment confirmed on {no}",
      PaymentTimedOut: "{method} payment timed out on {no}",
      CreditNoteIssued: "Credit note {no} issued, {amount}",
    },
    tender: {
      card: "Card",
    },
    sim: {
      cardTitle: "Card terminal",
      cardBody: "Tap or insert the card on the studio terminal.",
      cardLast4: "Last 4 digits of the card",
      cardHint: "A card ending in 0002 is declined (for the demo).",
      approveCard: "Approve on terminal",
      declined: "Declined by the card issuer. Try another card or tender.",
      pushTitle: "{brand} payment request",
      pushBody: "A payment request was pushed to {brand} wallet {phone}. It times out after {minutes} demo minutes.",
      waiting: "Waiting for the customer to approve on the phone",
      customerApproved: "Customer approved",
    },
  },
}
