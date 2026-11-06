/** AP strings, English. Every key also lives in bn.ts. */
export const apEn = {
  ap: {
    name: "Accounts Payable",
    description: "Vendor bills, three-way match, payments and withholding",
    pages: {
      home: "Payables home",
      bills: "Bills",
      billNew: "New bill",
      bill: "Bill",
      payments: "Payments",
      paymentNew: "New payment",
      payment: "Payment",
      aging: "Aging",
      debitNotes: "Debit notes",
    },
    perm: {
      app_view: "Open Accounts Payable",
      export: "Export payables",
      bill_create: "Record vendor bills",
      bill_approve: "Release bills on hold",
      payment_create: "Prepare vendor payments",
      payment_approve: "Approve vendor payments",
    },
    events: {
      BillRecorded: "Bill {no} recorded, {amount}",
      BillOnHold: "Bill {no} on hold: the match failed",
      BillReleased: "Bill {no} released",
      PaymentSubmitted: "Payment {no} submitted for approval",
      VendorPaid: "Vendor paid: {no}, {amount}",
    },
  },
}
