import type { PermissionDef } from "@/core/security/types"

/**
 * STL Sales Transaction Lifecycle: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const stlPermissions: PermissionDef[] = [
  {
    key: "stl.app.view",
    labelKey: "stl.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }, { role: "TECHNICIAN", scope: "own-location" }],
  },
  {
    key: "stl.export",
    labelKey: "stl.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }],
  },
  {
    key: "stl.quote.create",
    labelKey: "stl.perm.quote_create",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }],
  },
  {
    key: "stl.order.create",
    labelKey: "stl.perm.order_create",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }],
  },
  {
    key: "stl.order.edit",
    labelKey: "stl.perm.order_edit",
    column: "edit",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }],
  },
  {
    key: "stl.order.cancel",
    labelKey: "stl.perm.order_cancel",
    column: "cancel",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }],
  },
  {
    key: "stl.discount.approve",
    labelKey: "stl.perm.discount_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }],
  },
  {
    key: "stl.job.work",
    labelKey: "stl.perm.job_work",
    column: "edit",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "TECHNICIAN", scope: "own-location" }],
  },
  {
    key: "stl.qc.check",
    labelKey: "stl.perm.qc_check",
    column: "post",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }],
  },
]
