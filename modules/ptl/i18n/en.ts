/** PTL strings, English. Every key also lives in bn.ts. */
export const ptlEn = {
  ptl: {
    name: "Purchase Transactions (Local)",
    description: "Requisitions, purchase orders and returns",
    pages: {
      home: "Purchasing home",
      requisitions: "Requisitions",
      requisition: "Requisition",
      pos: "Purchase orders",
      po: "Purchase order",
      returns: "Purchase returns",
    },
    perm: {
      app_view: "Open Purchase Transactions",
      export: "Export purchase lists",
      pr_create: "Raise purchase requisitions",
      pr_approve: "Approve requisitions",
      po_create: "Issue purchase orders",
      po_approve: "Approve purchase orders",
      po_cancel: "Cancel purchase orders",
      return_create: "Return goods to vendors",
    },
    events: {
      RequisitionSubmitted: "Requisition {no} submitted",
      RequisitionApproved: "Requisition {no} approved",
      RequisitionRejected: "Requisition {no} rejected",
      PurchaseOrderIssued: "PO {no} issued, {amount}",
      PurchaseOrderApproved: "PO {no} approved",
      PurchaseOrderCancelled: "PO {no} cancelled",
      PurchaseReturned: "Goods returned: {no}",
      DebitNoteIssued: "Debit note {no} issued",
    },
  },
}
