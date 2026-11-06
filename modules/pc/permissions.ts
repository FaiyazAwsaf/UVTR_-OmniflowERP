import type { PermissionDef } from "@/core/security/types"

/**
 * PC Product Configuration: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const pcPermissions: PermissionDef[] = [
  {
    key: "pc.app.view",
    labelKey: "pc.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "all" }, { role: "ADVISOR", scope: "all" }, { role: "CASHIER", scope: "all" }],
  },
  {
    key: "pc.catalog.edit",
    labelKey: "pc.perm.catalog_edit",
    column: "edit",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "pc.pricelist.publish",
    labelKey: "pc.perm.pricelist_publish",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
]
