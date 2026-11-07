import type { DatasetLoaders } from "@/core/reports/types"
import { PERMISSIONS } from "@/core/security/registry"

/**
 * RBAC report dataset loaders (implementation_plan.md §3.19.1):
 * `rbac.access`, one row per user, role and granted key (active roles only),
 * for the user access review (IRT-32). A location narrows it to the users who
 * work there.
 */

const ORDER = new Map(PERMISSIONS.map((p, i) => [p.key, i]))
const COLUMN = new Map(PERMISSIONS.map((p) => [p.key, p.column]))

export const rbacDatasetLoaders: DatasetLoaders = {
  "rbac.access": async (db, params) => {
    const [users, roles, userRoles, grants] = await Promise.all([
      db.users.orderBy("username").toArray(),
      db.roles.toArray(),
      db.userRoles.toArray(),
      db.rolePermissions.toArray(),
    ])
    const location = typeof params.locationId === "string" && params.locationId ? params.locationId : null
    const roleById = new Map(roles.filter((r) => r.active).map((r) => [r.id, r]))
    const grantsByRole = new Map<string, typeof grants>()
    for (const g of grants) {
      const list = grantsByRole.get(g.roleId) ?? []
      list.push(g)
      grantsByRole.set(g.roleId, list)
    }
    const rows = []
    for (const user of users) {
      if (location && !user.locationIds.includes(location)) continue
      for (const ur of userRoles.filter((r) => r.userId === user.id)) {
        const role = roleById.get(ur.roleId)
        if (!role) continue
        const list = [...(grantsByRole.get(role.id) ?? [])].sort(
          (a, b) => (ORDER.get(a.permission) ?? 0) - (ORDER.get(b.permission) ?? 0)
        )
        for (const g of list) {
          rows.push({
            user: user.nameEn,
            username: user.username,
            role: role.nameEn,
            roleCode: role.code,
            permission: g.permission,
            column: COLUMN.get(g.permission) ?? "view",
            scope: g.scope,
            status: user.status,
            userHref: `/sac/users/${user.id}`,
            roleHref: `/rbac/roles/${role.id}`,
          })
        }
      }
    }
    return rows
  },
}
