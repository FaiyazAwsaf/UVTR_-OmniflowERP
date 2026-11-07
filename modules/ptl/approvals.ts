import type { ApprovalHandlerMap } from "@/core/approvals/types"

import { issueApprovedPo } from "./commands"

/**
 * PTL approval handlers by document type (implementation_plan.md §3.7),
 * registered in core/approvals/registry.ts. `approvals.decide` runs them in
 * the decision's commit: an approved requisition becomes `approved`; an
 * approved PO is issued exactly as the buyer's command would issue it.
 */
export const ptlApprovalHandlers: ApprovalHandlerMap = {
  purchaseRequisitions: {
    async onApproved(tx, docId, approval) {
      const pr = await tx.get("purchaseRequisitions", docId)
      if (pr.status !== "pending-approval") tx.reject("PR_NOT_PENDING", { no: pr.prNo })
      await tx.update("purchaseRequisitions", pr.id, { status: "approved", approvalId: approval.id })
      tx.emit("RequisitionApproved", { refs: { prId: pr.id, approvalId: approval.id }, params: { no: pr.prNo }, locationId: pr.locationId })
    },
    async onRejected(tx, docId, approval) {
      const pr = await tx.get("purchaseRequisitions", docId)
      if (pr.status !== "pending-approval") tx.reject("PR_NOT_PENDING", { no: pr.prNo })
      await tx.update("purchaseRequisitions", pr.id, { status: "rejected", approvalId: approval.id })
      tx.emit("RequisitionRejected", { refs: { prId: pr.id, approvalId: approval.id }, params: { no: pr.prNo }, locationId: pr.locationId })
    },
  },
  purchaseOrders: {
    async onApproved(tx, docId, approval) {
      const po = await tx.get("purchaseOrders", docId)
      if (po.status !== "pending-approval") tx.reject("PO_NOT_PENDING", { no: po.poNo })
      await issueApprovedPo(tx, po, approval.id)
    },
    async onRejected(tx, docId, approval) {
      const po = await tx.get("purchaseOrders", docId)
      if (po.status !== "pending-approval") tx.reject("PO_NOT_PENDING", { no: po.poNo })
      await tx.update("purchaseOrders", po.id, { status: "cancelled", approvalId: approval.id, cancelReason: approval.decisionReason || undefined })
      tx.emit("PurchaseOrderCancelled", { refs: { poId: po.id, approvalId: approval.id }, params: { no: po.poNo }, locationId: po.locationId })
    },
  },
}
