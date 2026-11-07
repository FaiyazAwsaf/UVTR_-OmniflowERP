"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type {
  ApprovalLimitRow,
  Id,
  RolePermissionRow,
  RoleRow,
  SodRuleRow,
  UserRoleRow,
  UserRow,
} from "@/core/db/schema"
import type { Scope } from "@/core/security/types"

/**
 * RBAC live data (useDb + useLiveQuery): roles, grants, assignments, limits
 * and SoD rules, re-read whenever any window changes them, so every RBAC
 * screen and every other window's permissions move together.
 */
export type RbacData = {
  roles: RoleRow[]
  roleById: Map<Id, RoleRow>
  users: UserRow[]
  userById: Map<Id, UserRow>
  rolePermissions: RolePermissionRow[]
  userRoles: UserRoleRow[]
  limits: ApprovalLimitRow[]
  rules: SodRuleRow[]
  /** Granted keys and their scope, per role */
  grantsByRole: Map<Id, Map<string, Scope>>
  /** Role ids per user */
  rolesByUser: Map<Id, Id[]>
  /** User ids per role */
  usersByRole: Map<Id, Id[]>
}

const ROLE_ORDER = [
  "OWNER",
  "ACC_MGR",
  "ACCOUNTANT",
  "STUDIO_MGR",
  "ADVISOR",
  "CASHIER",
  "TECHNICIAN",
  "STORE",
  "PROCUREMENT",
  "SYS_ADMIN",
  "AUDITOR",
]

/** System roles in the plan's order, then custom roles by code. */
export function sortRoles(roles: RoleRow[]): RoleRow[] {
  const rank = (r: RoleRow) => {
    const i = ROLE_ORDER.indexOf(r.code)
    return i < 0 ? ROLE_ORDER.length : i
  }
  return [...roles].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
}

export function useRbacData(): RbacData | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [roles, users, rolePermissions, userRoles, limits, rules] = await Promise.all([
      db.roles.toArray(),
      db.users.orderBy("username").toArray(),
      db.rolePermissions.toArray(),
      db.userRoles.toArray(),
      db.approvalLimits.toArray(),
      db.sodRules.toArray(),
    ])
    const grantsByRole = new Map<Id, Map<string, Scope>>()
    for (const rp of rolePermissions) {
      const map = grantsByRole.get(rp.roleId) ?? new Map<string, Scope>()
      map.set(rp.permission, rp.scope)
      grantsByRole.set(rp.roleId, map)
    }
    const rolesByUser = new Map<Id, Id[]>()
    const usersByRole = new Map<Id, Id[]>()
    for (const ur of userRoles) {
      rolesByUser.set(ur.userId, [...(rolesByUser.get(ur.userId) ?? []), ur.roleId])
      usersByRole.set(ur.roleId, [...(usersByRole.get(ur.roleId) ?? []), ur.userId])
    }
    const sorted = sortRoles(roles)
    return {
      roles: sorted,
      roleById: new Map(sorted.map((r) => [r.id, r])),
      users,
      userById: new Map(users.map((u) => [u.id, u])),
      rolePermissions,
      userRoles,
      limits,
      rules: [...rules].sort((a, b) => a.code.localeCompare(b.code)),
      grantsByRole,
      rolesByUser,
      usersByRole,
    }
  }, [db])
}

/** Keys per role as plain sets (for the SoD helpers). */
export function keySets(data: RbacData): Map<Id, Set<string>> {
  return new Map([...data.grantsByRole].map(([roleId, map]) => [roleId, new Set(map.keys())]))
}
