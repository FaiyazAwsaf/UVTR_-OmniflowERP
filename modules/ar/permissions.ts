import type { PermissionDef } from "@/core/security/types"

/**
 * AR Accounts Receivable: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const arPermissions: PermissionDef[] = [
  {
    key: "ar.app.view",
    labelKey: "ar.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ar.export",
    labelKey: "ar.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ar.receipt.create",
    labelKey: "ar.perm.receipt_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }],
  },
  {
    key: "ar.refund.create",
    labelKey: "ar.perm.refund_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }],
  },
  {
    key: "ar.credit.override",
    labelKey: "ar.perm.credit_override",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "ar.reminder.send",
    labelKey: "ar.perm.reminder_send",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
]
