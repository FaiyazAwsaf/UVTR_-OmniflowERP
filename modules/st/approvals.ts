import type { ApprovalHandlerMap } from "@/core/approvals/types"

import { postAdjustment } from "./commands"

/**
 * ST approval handlers by document type (implementation_plan.md §3.7),
 * registered in core/approvals/registry.ts. An approved adjustment posts its
 * stock moves and R22 at today's average cost, exactly as the maker's
 * command does within limit; the maker stays the voucher's preparer.
 */
export const stApprovalHandlers: ApprovalHandlerMap = {
  stockAdjustments: {
    async onApproved(tx, docId, approval) {
      const adj = await tx.get("stockAdjustments", docId)
      if (adj.status !== "pending-approval") tx.reject("ADJUSTMENT_NOT_PENDING", { no: adj.adjustmentNo })
      const posted = await postAdjustment(tx, adj, { preparedBy: adj.preparedBy, approvalId: approval.id })
      await tx.update("stockAdjustments", adj.id, {
        lines: posted.lines,
        status: "posted",
        journalId: posted.journalId,
        approvalId: approval.id,
      })
    },
    async onRejected(tx, docId, approval) {
      const adj = await tx.get("stockAdjustments", docId)
      if (adj.status !== "pending-approval") tx.reject("ADJUSTMENT_NOT_PENDING", { no: adj.adjustmentNo })
      await tx.update("stockAdjustments", adj.id, { status: "rejected", approvalId: approval.id })
    },
  },
}
