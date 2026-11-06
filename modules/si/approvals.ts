import type { ApprovalHandlerMap } from "@/core/approvals/types"

import { postCreditNote } from "./invoice"

/**
 * SI approval handlers (plan §3.7), registered in core/approvals/registry.ts.
 * A credit note above its maker's limit waits pending-approval; approving it
 * posts R11 exactly as the maker's command would have within limit.
 */
export const siApprovalHandlers: ApprovalHandlerMap = {
  creditNotes: {
    async onApproved(tx, docId, approval) {
      const cn = await tx.get("creditNotes", docId)
      if (cn.status !== "pending-approval") tx.reject("APPROVAL_DECIDED")
      await postCreditNote(tx, cn.id, { approvalId: approval.id, preparedBy: approval.requestedBy })
    },
    async onRejected(tx, docId) {
      const cn = await tx.get("creditNotes", docId)
      if (cn.status !== "pending-approval") tx.reject("APPROVAL_DECIDED")
      await tx.update("creditNotes", cn.id, { status: "rejected" })
    },
  },
}
