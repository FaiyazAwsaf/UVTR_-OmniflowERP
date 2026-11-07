import type { ApprovalLimitRow, Id, RolePermissionRow, RoleRow, UserRow } from "@/core/db/schema"
import { APPROVAL_KINDS, type ApprovalKind, type Scope } from "@/core/security/types"

/**
 * "Why can or can't this user do this?" (plan §9 /rbac/effective). Pure: the
 * same union the engine applies (core/security/resolve.ts buildSecurity),
 * with the granting role and scope of each key and the role behind each
 * limit, so the checker explains what the engine will decide.
 */

export type GrantSource = { roleId: Id; scope: Scope }

export type Explanation = {
  /** The key is granted by an active role the user holds */
  granted: boolean
  /** Granted and usable right now (user active) and, when a location is asked, in scope */
  allowed: boolean
  status: UserRow["status"]
  /** Roles the user holds that grant the key (active roles only) */
  sources: GrantSource[]
  /** The widest scope among the sources */
  scope: Scope | null
  /** When a location is asked: whether the grant covers it */
  inScope: boolean | null
  /** Inactive roles the user holds that would grant it */
  inactiveSources: GrantSource[]
  /** Active roles the user does NOT hold that grant it (who else could) */
  otherRoles: Id[]
}

export function explainPermission(input: {
  user: Pick<UserRow, "status" | "locationIds">
  heldRoleIds: readonly Id[]
  roles: readonly Pick<RoleRow, "id" | "active">[]
  rolePermissions: readonly Pick<RolePermissionRow, "roleId" | "permission" | "scope">[]
  key: string
  locationId?: Id | null
}): Explanation {
  const active = new Set(input.roles.filter((r) => r.active).map((r) => r.id))
  const held = new Set(input.heldRoleIds)
  const sources: GrantSource[] = []
  const inactiveSources: GrantSource[] = []
  const others = new Set<Id>()
  for (const rp of input.rolePermissions) {
    if (rp.permission !== input.key) continue
    if (held.has(rp.roleId)) {
      if (active.has(rp.roleId)) sources.push({ roleId: rp.roleId, scope: rp.scope })
      else inactiveSources.push({ roleId: rp.roleId, scope: rp.scope })
    } else if (active.has(rp.roleId)) {
      others.add(rp.roleId)
    }
  }
  const granted = sources.length > 0
  const scope: Scope | null = granted ? (sources.some((s) => s.scope === "all") ? "all" : "own-location") : null
  const inScope =
    input.locationId && granted
      ? scope === "all" || input.user.locationIds.includes(input.locationId)
      : input.locationId
        ? false
        : null
  const usable = input.user.status === "active"
  return {
    granted,
    allowed: granted && usable && inScope !== false,
    status: input.user.status,
    sources,
    scope,
    inScope,
    inactiveSources,
    otherRoles: [...others],
  }
}

export type LimitSource = {
  kind: ApprovalKind
  /** The highest value across the user's active roles; Infinity for unlimited */
  value: number
  /** The role that gives that value (null when every role has 0) */
  roleId: Id | null
}

/** The user's limit per kind and the role that sets it (highest across active roles). */
export function limitSources(input: {
  heldRoleIds: readonly Id[]
  roles: readonly Pick<RoleRow, "id" | "active">[]
  limits: readonly Pick<ApprovalLimitRow, "roleId" | "kind" | "value">[]
}): LimitSource[] {
  const active = new Set(input.roles.filter((r) => r.active).map((r) => r.id))
  const held = input.heldRoleIds.filter((id) => active.has(id))
  return APPROVAL_KINDS.map((kind) => {
    let value = 0
    let roleId: Id | null = null
    for (const row of input.limits) {
      if (row.kind !== kind || !held.includes(row.roleId)) continue
      const v = row.value < 0 ? Infinity : row.value
      if (v > value) {
        value = v
        roleId = row.roleId
      }
    }
    return { kind, value, roleId }
  })
}
