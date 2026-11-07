import type { ApprovalHandlerMap } from "@/core/approvals/types"

import { postCountVariances } from "./commands"

/**
 * IC approval handlers by document type (implementation_plan.md §3.7),
 * registered in core/approvals/registry.ts. An approved count posts its
 * variances (count-variance moves and R22) at today's average cost, exactly
 * as `ic.postCount` does within the poster's limit; a rejected count goes
 * back to `counted` for a recount.
 */
export const icApprovalHandlers: ApprovalHandlerMap = {
  stockCounts: {
    async onApproved(tx, docId, approval) {
      const count = await tx.get("stockCounts", docId)
      if (count.status !== "pending-approval") tx.reject("COUNT_NOT_PENDING", { no: count.countNo })
      const posted = await postCountVariances(tx, count, { preparedBy: approval.requestedBy, approvalId: approval.id })
      await tx.update("stockCounts", count.id, {
        lines: posted.lines,
        status: "posted",
        journalId: posted.journalId,
        approvalId: approval.id,
      })
    },
    async onRejected(tx, docId, approval) {
      const count = await tx.get("stockCounts", docId)
      if (count.status !== "pending-approval") tx.reject("COUNT_NOT_PENDING", { no: count.countNo })
      await tx.update("stockCounts", count.id, { status: "counted", approvalId: approval.id })
    },
  },
}
