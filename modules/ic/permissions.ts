import type { PermissionDef } from "@/core/security/types"

/**
 * IC Inventory Control: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const icPermissions: PermissionDef[] = [
  {
    key: "ic.app.view",
    labelKey: "ic.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }, { role: "TECHNICIAN", scope: "own-location" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ic.export",
    labelKey: "ic.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STORE", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ic.count.create",
    labelKey: "ic.perm.count_create",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }],
  },
  {
    key: "ic.count.approve",
    labelKey: "ic.perm.count_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }],
  },
]
