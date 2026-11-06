import type { PermissionDef } from "@/core/security/types"

/**
 * PM Product Master: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const pmPermissions: PermissionDef[] = [
  {
    key: "pm.app.view",
    labelKey: "pm.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "all" }, { role: "ADVISOR", scope: "all" }, { role: "CASHIER", scope: "all" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "pm.item.create",
    labelKey: "pm.perm.item_create",
    column: "create",
    grants: [{ role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "pm.item.edit",
    labelKey: "pm.perm.item_edit",
    column: "edit",
    grants: [{ role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "pm.reorder.edit",
    labelKey: "pm.perm.reorder_edit",
    column: "configure",
    grants: [{ role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
]
