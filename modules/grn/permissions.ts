import type { PermissionDef } from "@/core/security/types"

/**
 * GRN Goods Receive Note: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const grnPermissions: PermissionDef[] = [
  {
    key: "grn.app.view",
    labelKey: "grn.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "grn.receive.create",
    labelKey: "grn.perm.receive_create",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }],
  },
  {
    key: "grn.quarantine.decide",
    labelKey: "grn.perm.quarantine_decide",
    column: "post",
    grants: [{ role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
]
