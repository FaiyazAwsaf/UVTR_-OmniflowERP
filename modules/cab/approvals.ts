import type { ApprovalHandlerMap } from "@/core/approvals/types"

import { postPettyCash } from "./commands"

/**
 * CAB approval handlers by document type (implementation_plan.md §3.7),
 * registered in core/approvals/registry.ts.
 */
export const cabApprovalHandlers: ApprovalHandlerMap = {
  /** A petty cash voucher above the maker's limit: approval posts R19. */
  pettyCashVouchers: {
    async onApproved(tx, docId, approval) {
      await postPettyCash(tx, docId, { approvalId: approval.id })
    },
    async onRejected(tx, docId) {
      const voucher = await tx.get("pettyCashVouchers", docId)
      if (voucher.status !== "pending-approval") tx.reject("VOUCHER_NOT_PENDING", { no: voucher.voucherNo })
      await tx.update("pettyCashVouchers", voucher.id, { status: "rejected" })
    },
  },
}
