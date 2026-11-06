import type { PermissionDef } from "@/core/security/types"

/**
 * PAR Party Management: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const parPermissions: PermissionDef[] = [
  {
    key: "par.app.view",
    labelKey: "par.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "all" }, { role: "ADVISOR", scope: "all" }, { role: "CASHIER", scope: "all" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "par.export",
    labelKey: "par.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "par.customer.create",
    labelKey: "par.perm.customer_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "all" }, { role: "ADVISOR", scope: "all" }, { role: "CASHIER", scope: "all" }],
  },
  {
    key: "par.customer.edit",
    labelKey: "par.perm.customer_edit",
    column: "edit",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "all" }, { role: "ADVISOR", scope: "all" }],
  },
  {
    key: "par.vendor.create",
    labelKey: "par.perm.vendor_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "par.vendor.edit",
    labelKey: "par.perm.vendor_edit",
    column: "edit",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "par.credit.edit",
    labelKey: "par.perm.credit_edit",
    column: "configure",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "par.party.hold",
    labelKey: "par.perm.party_hold",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
]
