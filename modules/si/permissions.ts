import type { PermissionDef } from "@/core/security/types"

/**
 * SI Sale Invoice: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const siPermissions: PermissionDef[] = [
  {
    key: "si.app.view",
    labelKey: "si.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "ADVISOR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "si.export",
    labelKey: "si.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "si.invoice.issue",
    labelKey: "si.perm.invoice_issue",
    column: "post",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }],
  },
  {
    key: "si.counter.checkout",
    labelKey: "si.perm.counter_checkout",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }],
  },
  {
    key: "si.creditnote.create",
    labelKey: "si.perm.creditnote_create",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }],
  },
  {
    key: "si.creditnote.approve",
    labelKey: "si.perm.creditnote_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }],
  },
]
