import type { OmniflowDb } from "@/core/db/database"
import type {
  ApprovalLimitRow,
  Id,
  RolePermissionRow,
  RoleRow,
} from "@/core/db/schema"
import type { SecurityContext } from "@/core/engine/types"

import { APPROVAL_KINDS, type ApprovalKind, type Scope } from "./types"

const NO_LIMITS = Object.fromEntries(APPROVAL_KINDS.map((k) => [k, 0])) as Record<
  ApprovalKind,
  number
>

const ALL_LIMITS = Object.fromEntries(APPROVAL_KINDS.map((k) => [k, Infinity])) as Record<
  ApprovalKind,
  number
>

export const SYSTEM_SECURITY: SecurityContext = {
  grants: new Map(),
  limits: ALL_LIMITS,
  roleIds: [],
  roleCodes: [],
  all: true,
}

export const EMPTY_SECURITY: SecurityContext = {
  grants: new Map(),
  limits: NO_LIMITS,
  roleIds: [],
  roleCodes: [],
  all: false,
}

/**
 * Effective permissions (plan §3.8): the union over the user's active roles;
 * per key the widest scope wins. Limits are the highest across roles
 * (-1 = unlimited becomes Infinity). Pure, so the engine, the live hooks and
 * the RBAC effective-permissions checker share it.
 */
export function buildSecurity(
  roles: RoleRow[],
  permissions: RolePermissionRow[],
  limitRows: ApprovalLimitRow[]
): SecurityContext {
  const active = new Set(roles.filter((r) => r.active).map((r) => r.id))
  const grants = new Map<string, Scope>()
  for (const p of permissions) {
    if (!active.has(p.roleId)) continue
    const prev = grants.get(p.permission)
    if (prev !== "all") grants.set(p.permission, p.scope)
  }
  const limits = { ...NO_LIMITS }
  for (const l of limitRows) {
    if (!active.has(l.roleId)) continue
    const value = l.value < 0 ? Infinity : l.value
    if (value > limits[l.kind]) limits[l.kind] = value
  }
  const activeRoles = roles.filter((r) => active.has(r.id))
  return {
    grants,
    limits,
    roleIds: activeRoles.map((r) => r.id),
    roleCodes: activeRoles.map((r) => r.code),
    all: false,
  }
}

/** Read a user's roles, grants and limits from the database (committed data). */
export async function resolveSecurity(db: OmniflowDb, userId: Id): Promise<SecurityContext> {
  const userRoles = await db.userRoles.where("userId").equals(userId).toArray()
  const roleIds = userRoles.map((r) => r.roleId)
  if (!roleIds.length) return EMPTY_SECURITY
  const roles = (await db.roles.bulkGet(roleIds)).filter((r): r is RoleRow => !!r)
  const [permissions, limits] = await Promise.all([
    db.rolePermissions.where("roleId").anyOf(roleIds).toArray(),
    db.approvalLimits.where("roleId").anyOf(roleIds).toArray(),
  ])
  return buildSecurity(roles, permissions, limits)
}

/** Whether a security context grants a key, optionally at a location. */
export function grantAllows(
  security: SecurityContext,
  permission: string,
  locationIds: readonly Id[],
  locationId?: Id | null
): boolean {
  if (security.all) return true
  const scope = security.grants.get(permission)
  if (!scope) return false
  if (scope === "all" || !locationId) return true
  return locationIds.includes(locationId)
}
