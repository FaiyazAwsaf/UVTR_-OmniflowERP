import type { ApprovalHandlerMap } from "@/core/approvals/types"

/**
 * AR approval handlers by document type (implementation_plan.md §3.7),
 * registered in core/approvals/registry.ts. The workstream fills them.
 */
export const arApprovalHandlers: ApprovalHandlerMap = {}
