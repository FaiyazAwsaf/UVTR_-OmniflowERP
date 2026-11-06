import type { ApprovalHandlerMap } from "./types"
import { faApprovalHandlers } from "@/modules/fa/approvals"
import { apApprovalHandlers } from "@/modules/ap/approvals"
import { arApprovalHandlers } from "@/modules/ar/approvals"
import { cabApprovalHandlers } from "@/modules/cab/approvals"
import { parApprovalHandlers } from "@/modules/par/approvals"
import { frsApprovalHandlers } from "@/modules/frs/approvals"
import { stlApprovalHandlers } from "@/modules/stl/approvals"
import { siApprovalHandlers } from "@/modules/si/approvals"
import { pcApprovalHandlers } from "@/modules/pc/approvals"
import { sdApprovalHandlers } from "@/modules/sd/approvals"
import { ptlApprovalHandlers } from "@/modules/ptl/approvals"
import { pmApprovalHandlers } from "@/modules/pm/approvals"
import { grnApprovalHandlers } from "@/modules/grn/approvals"
import { stApprovalHandlers } from "@/modules/st/approvals"
import { icApprovalHandlers } from "@/modules/ic/approvals"
import { irtApprovalHandlers } from "@/modules/irt/approvals"
import { sacApprovalHandlers } from "@/modules/sac/approvals"
import { rbacApprovalHandlers } from "@/modules/rbac/approvals"

/**
 * Approval handlers by document type (implementation_plan.md §3.7), merged
 * from every module. Only the main agent edits this file.
 */
export const APPROVAL_HANDLERS: ApprovalHandlerMap = {
  ...faApprovalHandlers,
  ...apApprovalHandlers,
  ...arApprovalHandlers,
  ...cabApprovalHandlers,
  ...parApprovalHandlers,
  ...frsApprovalHandlers,
  ...stlApprovalHandlers,
  ...siApprovalHandlers,
  ...pcApprovalHandlers,
  ...sdApprovalHandlers,
  ...ptlApprovalHandlers,
  ...pmApprovalHandlers,
  ...grnApprovalHandlers,
  ...stApprovalHandlers,
  ...icApprovalHandlers,
  ...irtApprovalHandlers,
  ...sacApprovalHandlers,
  ...rbacApprovalHandlers,
}
