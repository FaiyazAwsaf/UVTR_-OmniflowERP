import type { ApprovalHandlerMap } from "@/core/approvals/types"

import { postManualVoucher } from "./posting"

/**
 * FA approval handlers by document type (implementation_plan.md §3.7),
 * registered in core/approvals/registry.ts. `approvals.decide` runs them in
 * the same commit as the decision.
 *
 * journals: approved, the manual voucher posts exactly as its maker's
 * submit would have within limit (R24, the original preparer kept as
 * preparedBy, the approver as postedBy); rejected, it returns to draft so
 * the preparer can correct and resubmit it, or discard it.
 */
export const faApprovalHandlers: ApprovalHandlerMap = {
  journals: {
    async onApproved(tx, docId, approval) {
      const journal = await tx.get("journals", docId)
      if (journal.status !== "pending-approval") tx.reject("JOURNAL_NOT_PENDING", { no: journal.journalNo })
      const posted = await postManualVoucher(tx, journal, { approvalId: approval.id })
      tx.emit("JournalApproved", {
        refs: { journalId: journal.id, approvalId: approval.id },
        params: { no: posted.journalNo, amount: Math.round(posted.totalP / 100) },
      })
    },
    async onRejected(tx, docId, approval) {
      const journal = await tx.get("journals", docId)
      if (journal.status !== "pending-approval") tx.reject("JOURNAL_NOT_PENDING", { no: journal.journalNo })
      await tx.update("journals", journal.id, { status: "draft", approvalId: approval.id })
    },
  },
}
