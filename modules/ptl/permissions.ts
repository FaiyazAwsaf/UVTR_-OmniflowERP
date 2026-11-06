import type { PermissionDef } from "@/core/security/types"

/**
 * PTL Purchase Transactions (Local): its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const ptlPermissions: PermissionDef[] = [
  {
    key: "ptl.app.view",
    labelKey: "ptl.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ptl.export",
    labelKey: "ptl.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "PROCUREMENT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ptl.pr.create",
    labelKey: "ptl.perm.pr_create",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "ptl.pr.approve",
    labelKey: "ptl.perm.pr_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "ptl.po.create",
    labelKey: "ptl.perm.po_create",
    column: "create",
    grants: [{ role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "ptl.po.approve",
    labelKey: "ptl.perm.po_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "ptl.po.cancel",
    labelKey: "ptl.perm.po_cancel",
    column: "cancel",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "ptl.return.create",
    labelKey: "ptl.perm.return_create",
    column: "create",
    grants: [{ role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
]
