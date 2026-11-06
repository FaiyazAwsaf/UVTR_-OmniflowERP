import type { PermissionDef } from "@/core/security/types"

/**
 * SD Sale Delivery: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const sdPermissions: PermissionDef[] = [
  {
    key: "sd.app.view",
    labelKey: "sd.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }],
  },
  {
    key: "sd.delivery.handover",
    labelKey: "sd.perm.delivery_handover",
    column: "post",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }],
  },
  {
    key: "sd.delivery.goods",
    labelKey: "sd.perm.delivery_goods",
    column: "post",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }],
  },
]
