/** ST strings, English. Every key also lives in bn.ts. */
export const stEn = {
  st: {
    name: "Stock Transactions",
    description: "Transfers, issues and stock adjustments",
    pages: {
      home: "Stock transactions",
      transfers: "Transfers",
      transfer: "Transfer",
      adjustments: "Adjustments",
      issues: "Issues",
    },
    perm: {
      app_view: "Open Stock Transactions",
      transfer_request: "Request transfers",
      transfer_dispatch: "Dispatch transfers",
      transfer_receive: "Receive transfers",
      adjust_create: "Adjust stock and record internal use",
      adjust_approve: "Approve stock adjustments",
    },
    events: {
      TransferRequested: "Transfer {no} requested",
      TransferDispatched: "Transfer {no} dispatched",
      TransferReceived: "Transfer {no} received",
      StockIssued: "Stock issued: {no}",
      AdjustmentSubmitted: "Adjustment {no} submitted",
      AdjustmentPosted: "Adjustment {no} posted",
    },
  },
}
