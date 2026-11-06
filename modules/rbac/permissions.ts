import type { PermissionDef } from "@/core/security/types"

/**
 * RBAC Role-Based Access Control: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const rbacPermissions: PermissionDef[] = [
  {
    key: "rbac.app.view",
    labelKey: "rbac.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "SYS_ADMIN", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "rbac.role.edit",
    labelKey: "rbac.perm.role_edit",
    column: "configure",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
  {
    key: "rbac.assign.edit",
    labelKey: "rbac.perm.assign_edit",
    column: "edit",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
  {
    key: "rbac.limits.edit",
    labelKey: "rbac.perm.limits_edit",
    column: "configure",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
  {
    key: "rbac.sod.edit",
    labelKey: "rbac.perm.sod_edit",
    column: "configure",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
]
