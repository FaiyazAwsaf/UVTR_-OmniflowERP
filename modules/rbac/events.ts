import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by RBAC (implementation_plan.md §3.10). */
export const rbacEvents: EventCatalog = {
  PermissionGranted: {
    module: "rbac",
    labelKey: "rbac.events.PermissionGranted",
    consumers: ["consumers.security", "consumers.audit", "consumers.affectedUsers"],
    severity: "warning",
  },
  PermissionRevoked: {
    module: "rbac",
    labelKey: "rbac.events.PermissionRevoked",
    consumers: ["consumers.security", "consumers.audit", "consumers.affectedUsers"],
    severity: "warning",
  },
  RoleAssigned: {
    module: "rbac",
    labelKey: "rbac.events.RoleAssigned",
    consumers: ["consumers.security", "consumers.audit", "consumers.affectedUsers"],
    severity: "warning",
  },
  RoleUnassigned: {
    module: "rbac",
    labelKey: "rbac.events.RoleUnassigned",
    consumers: ["consumers.security", "consumers.audit", "consumers.affectedUsers"],
    severity: "warning",
  },
  LimitChanged: {
    module: "rbac",
    labelKey: "rbac.events.LimitChanged",
    consumers: ["consumers.security", "consumers.audit", "consumers.affectedUsers"],
    severity: "warning",
  },
  SodConflictFlagged: {
    module: "rbac",
    labelKey: "rbac.events.SodConflictFlagged",
    consumers: ["consumers.security", "consumers.audit", "consumers.affectedUsers"],
    severity: "warning",
  },
  /* Added by WS-CSC: role and SoD rule edits also show in the event stream. */
  RoleSaved: {
    module: "rbac",
    labelKey: "rbac.events.RoleSaved",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "info",
  },
  SodRuleSaved: {
    module: "rbac",
    labelKey: "rbac.events.SodRuleSaved",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "info",
  },
}
