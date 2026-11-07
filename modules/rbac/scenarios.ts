import type { ScenarioDef } from "@/core/scenarios/types"
import { PERMISSIONS } from "@/core/security/registry"
import { APPROVAL_KINDS, roleId } from "@/core/security/types"
import { APPROVAL_LIMITS } from "@/core/seed/generators/org"

import { setLimit, setPermission } from "./commands"

const ADVISOR = roleId("ADVISOR")

/**
 * RBAC scenario launchers (implementation_plan.md §10).
 * E13: a live permission revoke. Tahmid edits the Service Advisor role while
 * Nayeem's window (the companion pane) shows the quotation editor: revoking
 * `par.customer.create` hides "+ New customer" at once; a 0% discount limit
 * makes any discount ask for the manager's PIN; then both are restored.
 */
export const rbacScenarios: ScenarioDef[] = [
  {
    id: "E13",
    kind: "scenario",
    module: "rbac",
    titleKey: "rbac.scenarios.E13.title",
    summaryKey: "rbac.scenarios.E13.summary",
    user: "tahmid",
    async setup(kit) {
      // Advisor grants and limits back to the seed (re-run rule).
      const seeded = new Map<string, "all" | "own-location">()
      for (const p of PERMISSIONS) for (const g of p.grants) if (g.role === "ADVISOR") seeded.set(p.key, g.scope)
      const current = await kit.db.rolePermissions.where("roleId").equals(ADVISOR).toArray()
      const changes: { permission: string; scope: "all" | "own-location" | null }[] = []
      for (const [permission, scope] of seeded) {
        const row = current.find((r) => r.permission === permission)
        if (!row || row.scope !== scope) changes.push({ permission, scope })
      }
      for (const row of current) if (!seeded.has(row.permission)) changes.push({ permission: row.permission, scope: null })
      if (changes.length) {
        await kit.run(setPermission, { roleId: ADVISOR, changes, reason: "Demo setup: Service Advisor grants restored to the seed" }, "tahmid")
      }
      const limits = await kit.db.approvalLimits.where("roleId").equals(ADVISOR).toArray()
      for (const kind of APPROVAL_KINDS) {
        const value = APPROVAL_LIMITS.ADVISOR[kind]
        if (limits.find((l) => l.kind === kind)?.value !== value) {
          await kit.run(setLimit, { roleId: ADVISOR, kind, value, reason: "Demo setup: Service Advisor limit restored to the seed" }, "tahmid")
        }
      }
      return { refs: { roleId: ADVISOR }, params: { limit: APPROVAL_LIMITS.ADVISOR["discount-pct"] } }
    },
    route: () => `/rbac/roles/${ADVISOR}`,
    cueKeys: ["rbac.scenarios.E13.cue1", "rbac.scenarios.E13.cue2", "rbac.scenarios.E13.cue3", "rbac.scenarios.E13.cue4", "rbac.scenarios.E13.cue5"],
    companion: { user: "nayeem", route: () => "/stl/quotations/new" },
  },
]
