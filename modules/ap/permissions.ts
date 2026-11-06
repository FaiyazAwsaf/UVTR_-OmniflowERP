import type { PermissionDef } from "@/core/security/types"

/**
 * AP Accounts Payable: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const apPermissions: PermissionDef[] = [
  {
    key: "ap.app.view",
    labelKey: "ap.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "PROCUREMENT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ap.export",
    labelKey: "ap.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "ap.bill.create",
    labelKey: "ap.perm.bill_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "ap.bill.approve",
    labelKey: "ap.perm.bill_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "ap.payment.create",
    labelKey: "ap.perm.payment_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "ap.payment.approve",
    labelKey: "ap.perm.payment_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
]
