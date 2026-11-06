import type { PermissionDef } from "@/core/security/types"

/**
 * CAB Cash & Bank Management: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const cabPermissions: PermissionDef[] = [
  {
    key: "cab.app.view",
    labelKey: "cab.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "cab.export",
    labelKey: "cab.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "cab.transfer.create",
    labelKey: "cab.perm.transfer_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }],
  },
  {
    key: "cab.settlement.create",
    labelKey: "cab.perm.settlement_create",
    column: "post",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "cab.cheque.update",
    labelKey: "cab.perm.cheque_update",
    column: "edit",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "cab.reconcile",
    labelKey: "cab.perm.reconcile",
    column: "post",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "cab.pettycash.create",
    labelKey: "cab.perm.pettycash_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "CASHIER", scope: "own-location" }],
  },
  {
    key: "cab.pettycash.approve",
    labelKey: "cab.perm.pettycash_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }],
  },
  {
    key: "cab.account.configure",
    labelKey: "cab.perm.account_configure",
    column: "configure",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
]
