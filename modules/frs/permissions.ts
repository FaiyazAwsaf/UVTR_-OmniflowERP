import type { PermissionDef } from "@/core/security/types"

/**
 * FRS Financial Reporting: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const frsPermissions: PermissionDef[] = [
  {
    key: "frs.app.view",
    labelKey: "frs.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "frs.export",
    labelKey: "frs.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "frs.vat.submit",
    labelKey: "frs.perm.vat_submit",
    column: "post",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "frs.tax.pay",
    labelKey: "frs.perm.tax_pay",
    column: "post",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
]
