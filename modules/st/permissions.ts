import type { PermissionDef } from "@/core/security/types"

/**
 * ST Stock Transactions: its permission keys (implementation_plan.md §3.9), with
 * the seeded default grants. The seed builds `rolePermissions` from these
 * grants. Only the main agent adds or changes keys.
 */
export const stPermissions: PermissionDef[] = [
  {
    key: "st.app.view",
    labelKey: "st.perm.app_view",
    column: "view",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "ACCOUNTANT", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }, { role: "PROCUREMENT", scope: "all" }],
  },
  {
    key: "st.transfer.request",
    labelKey: "st.perm.transfer_request",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }],
  },
  {
    key: "st.transfer.dispatch",
    labelKey: "st.perm.transfer_dispatch",
    column: "post",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }],
  },
  {
    key: "st.transfer.receive",
    labelKey: "st.perm.transfer_receive",
    column: "post",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }],
  },
  {
    key: "st.adjust.create",
    labelKey: "st.perm.adjust_create",
    column: "create",
    grants: [{ role: "STUDIO_MGR", scope: "own-location" }, { role: "STORE", scope: "all" }],
  },
  {
    key: "st.adjust.approve",
    labelKey: "st.perm.adjust_approve",
    column: "approve",
    grants: [{ role: "OWNER", scope: "all" }, { role: "ACC_MGR", scope: "all" }, { role: "STUDIO_MGR", scope: "own-location" }],
  },
]
