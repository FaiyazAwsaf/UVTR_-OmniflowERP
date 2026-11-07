import type { Id, SodRuleRow } from "@/core/db/schema"
import { PERMISSION_BY_KEY } from "@/core/security/registry"

/**
 * Segregation of duties (plan §3.8, seed_data.md §2.3). A rule pairs two
 * sides; a side is a catalogue key or `*.approve` (any approve-column key).
 * A set of keys breaks a rule when it holds a key matching each side (two
 * different keys). Pure: the RBAC commands, the matrix warnings and the
 * conflicts report share it.
 */

export const ANY_APPROVE = "*.approve"

export type SodRuleLike = Pick<SodRuleRow, "code" | "permissionA" | "permissionB" | "mode" | "active">

/** Whether a key matches one side of a rule. */
export function sideMatches(side: string, key: string): boolean {
  if (side === ANY_APPROVE) return PERMISSION_BY_KEY.get(key)?.column === "approve"
  return side === key
}

/** The keys of a set that match one side. */
export function matching(side: string, keys: Iterable<string>): string[] {
  const out: string[] = []
  for (const key of keys) if (sideMatches(side, key)) out.push(key)
  return out
}

export type SodHit<R extends SodRuleLike = SodRuleLike> = {
  rule: R
  /** Keys matching side A */
  a: string[]
  /** Keys matching side B */
  b: string[]
}

/** The active rules a set of keys breaks, with the keys on each side. */
export function sodHits<R extends SodRuleLike>(keys: Iterable<string>, rules: readonly R[]): SodHit<R>[] {
  const list = [...new Set(keys)]
  const hits: SodHit<R>[] = []
  for (const rule of rules) {
    if (!rule.active) continue
    const a = matching(rule.permissionA, list)
    const b = matching(rule.permissionB, list)
    if (!a.length || !b.length) continue
    // Two different keys are needed (a rule never matches one key against itself).
    if (a.length === 1 && b.length === 1 && a[0] === b[0]) continue
    hits.push({ rule, a, b })
  }
  return hits
}

/** Rules broken by `after` that `before` did not break (by rule code). */
export function newHits<R extends SodRuleLike>(
  before: Iterable<string>,
  after: Iterable<string>,
  rules: readonly R[]
): SodHit<R>[] {
  const had = new Set(sodHits(before, rules).map((h) => h.rule.code))
  return sodHits(after, rules).filter((h) => !had.has(h.rule.code))
}

/** The keys a set of roles grants together (active roles only). */
export function keysOfRoles(
  roleIds: readonly Id[],
  keysByRole: ReadonlyMap<Id, ReadonlySet<string> | readonly string[]>,
  activeRoles?: ReadonlySet<Id>
): Set<string> {
  const out = new Set<string>()
  for (const roleId of roleIds) {
    if (activeRoles && !activeRoles.has(roleId)) continue
    for (const key of keysByRole.get(roleId) ?? []) out.add(key)
  }
  return out
}

export type ConflictRow<R extends SodRuleLike = SodRuleLike> = {
  kind: "role" | "user"
  /** Role id or user id */
  subjectId: Id
  /** For users: the roles whose keys combine into the conflict */
  roleIds: Id[]
  hit: SodHit<R>
}

/**
 * The conflicts report (plan §9 /rbac/sod): every role that breaks a rule on
 * its own, and every user whose combined roles break one (users whose single
 * role already breaks it are listed under the role, not again).
 */
export function conflictsReport<R extends SodRuleLike>(input: {
  rules: readonly R[]
  roles: readonly { id: Id; active: boolean }[]
  keysByRole: ReadonlyMap<Id, ReadonlySet<string> | readonly string[]>
  rolesByUser: ReadonlyMap<Id, readonly Id[]>
}): ConflictRow<R>[] {
  const active = new Set(input.roles.filter((r) => r.active).map((r) => r.id))
  const rows: ConflictRow<R>[] = []
  const roleHits = new Map<Id, Set<string>>()
  for (const role of input.roles) {
    if (!role.active) continue
    const hits = sodHits(input.keysByRole.get(role.id) ?? [], input.rules)
    roleHits.set(role.id, new Set(hits.map((h) => h.rule.code)))
    for (const hit of hits) rows.push({ kind: "role", subjectId: role.id, roleIds: [role.id], hit })
  }
  for (const [userId, roleIds] of input.rolesByUser) {
    const held = roleIds.filter((id) => active.has(id))
    if (held.length < 2) continue
    const combined = keysOfRoles(held, input.keysByRole, active)
    for (const hit of sodHits(combined, input.rules)) {
      if (held.some((id) => roleHits.get(id)?.has(hit.rule.code))) continue
      rows.push({ kind: "user", subjectId: userId, roleIds: [...held], hit })
    }
  }
  return rows
}
