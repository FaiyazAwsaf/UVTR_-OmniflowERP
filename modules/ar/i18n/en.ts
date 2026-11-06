/** AR strings, English. Every key also lives in bn.ts. */
export const arEn = {
  ar: {
    name: "Accounts Receivable",
    description: "Receipts, advances, credit control and aging",
    pages: {
      home: "Receivables home",
      receipts: "Receipts",
      receiptNew: "New receipt",
      refunds: "Refunds",
      aging: "Aging",
      creditControl: "Credit control",
      statement: "Customer statement",
    },
    perm: {
      app_view: "Open Accounts Receivable",
      export: "Export receivables and statements",
      receipt_create: "Record customer receipts",
      refund_create: "Refund customers",
      credit_override: "Override credit holds and limits",
      reminder_send: "Send payment reminders",
    },
    events: {
      ReceiptRecorded: "Receipt {no} recorded, {amount}",
      AdvanceApplied: "Advance {amount} applied to {no}",
      RefundPaid: "Refund {no} paid, {amount}",
      CreditHoldSet: "{party} put on credit hold",
      CreditHoldReleased: "{party} released from credit hold",
      CreditOverrideApproved: "Credit override approved for {party}",
      ReminderSent: "Payment reminder sent to {party}",
    },
  },
}
