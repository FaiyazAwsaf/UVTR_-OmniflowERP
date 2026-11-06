import type { PermissionDef } from "@/core/security/types"

/**
 * SAC User Security: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const sacPermissions: PermissionDef[] = [
  {
    key: "sac.app.view",
    labelKey: "sac.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "SYS_ADMIN", scope: "all" }],
  },
  {
    key: "sac.audit.view",
    labelKey: "sac.perm.audit_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "SYS_ADMIN", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "sac.user.create",
    labelKey: "sac.perm.user_create",
    column: "create",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
  {
    key: "sac.user.edit",
    labelKey: "sac.perm.user_edit",
    column: "edit",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
  {
    key: "sac.session.end",
    labelKey: "sac.perm.session_end",
    column: "cancel",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
  {
    key: "sac.policy.configure",
    labelKey: "sac.perm.policy_configure",
    column: "configure",
    grants: [{ role: "SYS_ADMIN", scope: "all" }],
  },
]
