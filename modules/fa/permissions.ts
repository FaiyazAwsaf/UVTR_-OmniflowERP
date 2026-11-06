import type { PermissionDef } from "@/core/security/types"

/**
 * FA Core Accounting: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const faPermissions: PermissionDef[] = [
  {
    key: "fa.app.view",
    labelKey: "fa.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "fa.export",
    labelKey: "fa.perm.export",
    column: "export",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "AUDITOR", scope: "all" }],
  },
  {
    key: "fa.account.edit",
    labelKey: "fa.perm.account_edit",
    column: "configure",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "fa.journal.create",
    labelKey: "fa.perm.journal_create",
    column: "create",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "fa.journal.approve",
    labelKey: "fa.perm.journal_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "fa.journal.reverse",
    labelKey: "fa.perm.journal_reverse",
    column: "post",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "fa.period.close",
    labelKey: "fa.perm.period_close",
    column: "post",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "fa.period.reopen",
    labelKey: "fa.perm.period_reopen",
    column: "configure",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }],
  },
  {
    key: "fa.recurring.run",
    labelKey: "fa.perm.recurring_run",
    column: "post",
    grants: [{ role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }],
  },
  {
    key: "fa.settings.configure",
    labelKey: "fa.perm.settings_configure",
    column: "configure",
    grants: [{ role: "ACC_MGR", scope: "all" }],
  },
]
