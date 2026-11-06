import type { PermissionDef } from "@/core/security/types"

/** The executive dashboard's key (implementation_plan.md §3.9). */
export const dashboardPermissions: PermissionDef[] = [
  {
    key: "dashboard.app.view",
    labelKey: "dashboard.perm.app_view",
    column: "view",
    grants: [
      { role: "OWNER", scope: "all" },
      { role: "ACC_MGR", scope: "all" },
      { role: "AUDITOR", scope: "all" },
    ],
  },
]
