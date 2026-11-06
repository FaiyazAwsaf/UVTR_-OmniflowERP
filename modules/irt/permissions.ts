import type { PermissionDef } from "@/core/security/types"

/**
 * IRT Reporting Tool: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const irtPermissions: PermissionDef[] = [
  {
    key: "irt.app.view",
    labelKey: "irt.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "all" }, { role: "ADVISOR", scope: "all" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }, { role: "SYS_ADMIN", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "irt.export",
    labelKey: "irt.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "irt.builder.create",
    labelKey: "irt.perm.builder_create",
    column: "create",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "irt.schedule.edit",
    labelKey: "irt.perm.schedule_edit",
    column: "configure",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
]
