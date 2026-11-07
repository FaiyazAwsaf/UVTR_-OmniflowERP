import { z } from "zod"

import type { Id, RoleRow, SodRuleRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { PERMISSION_BY_KEY } from "@/core/security/registry"
import { APPROVAL_KINDS, type ApprovalKind } from "@/core/security/types"

import { ANY_APPROVE, keysOfRoles, newHits, type SodHit } from "./sod"

/**
 * RBAC commands (implementation_plan.md §6.2): grants with scope, role
 * assignment, approval limits, roles and SoD rules. Every change applies to
 * the very next commit in every window (the engine reads RBAC live) and to
 * the UI at once (the live permission hooks). A user never changes their own
 * roles, limits or the grants of a role they hold.
 */

const scope = z.enum(["all", "own-location"])

/** English label of an approval kind, for event params (names stay as stored). */
export const KIND_LABEL_EN: Record<ApprovalKind, string> = {
  "discount-pct": "Discount",
  journal: "Journal",
  payment: "Payment",
  purchase: "Purchase",
  "credit-note": "Credit note",
  "stock-adjust": "Stock adjustment",
  "petty-cash": "Petty cash",
  "credit-override": "Credit override",
}

/** Keys granted per role (committed data plus this commit's own writes). */
async function keysByRole(tx: Tx, roleIds: readonly Id[]): Promise<Map<Id, Set<string>>> {
  const out = new Map<Id, Set<string>>()
  for (const roleId of new Set(roleIds)) {
    const rows = await tx.list("rolePermissions", "roleId", roleId)
    out.set(roleId, new Set(rows.map((r) => r.permission)))
  }
  return out
}

async function activeRules(tx: Tx): Promise<SodRuleRow[]> {
  return (await tx.all("sodRules")).filter((r) => r.active)
}

async function activeRoleIds(tx: Tx): Promise<Set<Id>> {
  return new Set((await tx.all("roles")).filter((r) => r.active).map((r) => r.id))
}

/**
 * Refuses on a newly broken block rule; flags each newly broken warn rule
 * with SodConflictFlagged. Returns the warn codes flagged.
 */
function applySod(
  tx: Tx,
  hits: SodHit<SodRuleRow>[],
  subject: { name: string; refs: { roleId?: Id; userId?: Id } }
): string[] {
  const block = hits.find((h) => h.rule.mode === "block")
  if (block) {
    tx.reject("SOD_BLOCKED", {
      rule: block.rule.code,
      subject: subject.name,
      a: block.a.join(", "),
      b: block.b.join(", "),
    })
  }
  for (const hit of hits) {
    tx.emit("SodConflictFlagged", {
      refs: subject.refs,
      params: { rule: hit.rule.code, subject: subject.name },
      locationId: null,
    })
  }
  return hits.map((h) => h.rule.code)
}

/* ------------------------------------------------------------------ *
 * rbac.setPermission
 * ------------------------------------------------------------------ */

export const setPermission = defineCommand({
  name: "rbac.setPermission",
  permission: "rbac.role.edit",
  input: z.object({
    roleId: z.string().min(1),
    /** Desired state per key: a scope grants (or rescopes), null revokes */
    changes: z
      .array(z.object({ permission: z.string().min(1), scope: scope.nullable() }))
      .min(1),
    reason: z.string().max(200).optional(),
  }),
  async run(tx, input) {
    const role = await tx.get("roles", input.roleId)
    if (tx.security.roleIds.includes(role.id)) tx.reject("RBAC_OWN_ROLE", { role: role.nameEn })

    const before = await tx.list("rolePermissions", "roleId", role.id)
    const beforeKeys = new Set(before.map((r) => r.permission))
    const byKey = new Map(before.map((r) => [r.permission, r]))
    const granted: string[] = []
    const revoked: string[] = []
    const seen = new Set<string>()
    for (const change of input.changes) {
      if (!PERMISSION_BY_KEY.has(change.permission)) {
        tx.reject("RBAC_UNKNOWN_KEY", { permission: change.permission })
      }
      if (seen.has(change.permission)) continue
      seen.add(change.permission)
      const existing = byKey.get(change.permission)
      const params = { permission: change.permission, role: role.nameEn }
      if (change.scope === null) {
        if (!existing) continue
        await tx.remove("rolePermissions", existing.id)
        revoked.push(change.permission)
        tx.emit("PermissionRevoked", { refs: { roleId: role.id }, params, locationId: null })
      } else if (!existing) {
        tx.insert("rolePermissions", { roleId: role.id, permission: change.permission, scope: change.scope })
        granted.push(change.permission)
        tx.emit("PermissionGranted", {
          refs: { roleId: role.id },
          params: { ...params, scope: change.scope },
          locationId: null,
        })
      } else if (existing.scope !== change.scope) {
        await tx.update("rolePermissions", existing.id, { scope: change.scope })
        granted.push(change.permission)
        tx.emit("PermissionGranted", {
          refs: { roleId: role.id },
          params: { ...params, scope: change.scope },
          locationId: null,
        })
      }
    }

    // Segregation of duties: the role on its own, then every user holding it.
    const rules = await activeRules(tx)
    const afterKeys = new Set((await tx.list("rolePermissions", "roleId", role.id)).map((r) => r.permission))
    const flagged = new Set<string>()
    if (role.active) {
      for (const code of applySod(tx, newHits(beforeKeys, afterKeys, rules), {
        name: role.nameEn,
        refs: { roleId: role.id },
      })) {
        flagged.add(code)
      }
      const holders = await tx.list("userRoles", "roleId", role.id)
      const active = await activeRoleIds(tx)
      for (const holder of holders) {
        const held = (await tx.list("userRoles", "userId", holder.userId)).map((r) => r.roleId)
        const others = await keysByRole(tx, held.filter((id) => id !== role.id))
        const beforeMap = new Map(others).set(role.id, beforeKeys)
        const afterMap = new Map(others).set(role.id, afterKeys)
        const hits = newHits(
          keysOfRoles(held, beforeMap, active),
          keysOfRoles(held, afterMap, active),
          rules
        ).filter((h) => !flagged.has(h.rule.code))
        if (!hits.length) continue
        const user = await tx.get("users", holder.userId)
        for (const code of applySod(tx, hits, { name: user.nameEn, refs: { userId: user.id, roleId: role.id } })) {
          flagged.add(code)
        }
      }
    }
    if (input.reason) tx.auditContext({ reason: input.reason })
    return { granted, revoked, flagged: [...flagged] }
  },
})

/* ------------------------------------------------------------------ *
 * rbac.assignRole
 * ------------------------------------------------------------------ */

export const assignRole = defineCommand({
  name: "rbac.assignRole",
  permission: "rbac.assign.edit",
  input: z.object({
    userId: z.string().min(1),
    roleId: z.string().min(1),
    assign: z.boolean(),
    reason: z.string().max(200).optional(),
  }),
  async run(tx, input) {
    if (input.userId === tx.actor.userId) tx.reject("RBAC_OWN_ASSIGNMENT")
    const user = await tx.get("users", input.userId)
    const role = await tx.get("roles", input.roleId)
    const existing = await tx.list("userRoles", "[userId+roleId]", [user.id, role.id])
    const params = { role: role.nameEn, user: user.nameEn }
    if (input.reason) tx.auditContext({ reason: input.reason })

    if (!input.assign) {
      if (!existing.length) return { changed: false, flagged: [] as string[] }
      for (const row of existing) await tx.remove("userRoles", row.id)
      tx.emit("RoleUnassigned", { refs: { userId: user.id, roleId: role.id }, params, locationId: null })
      return { changed: true, flagged: [] as string[] }
    }

    if (existing.length) return { changed: false, flagged: [] as string[] }
    if (!role.active) tx.reject("RBAC_ROLE_INACTIVE", { role: role.nameEn })
    const held = (await tx.list("userRoles", "userId", user.id)).map((r) => r.roleId)
    tx.insert("userRoles", { userId: user.id, roleId: role.id, grantedBy: tx.actor.userId, grantedAt: tx.now() })
    const rules = await activeRules(tx)
    const active = await activeRoleIds(tx)
    const keys = await keysByRole(tx, [...held, role.id])
    const hits = newHits(keysOfRoles(held, keys, active), keysOfRoles([...held, role.id], keys, active), rules)
    const flagged = applySod(tx, hits, { name: user.nameEn, refs: { userId: user.id, roleId: role.id } })
    tx.emit("RoleAssigned", { refs: { userId: user.id, roleId: role.id }, params, locationId: null })
    return { changed: true, flagged }
  },
})

/* ------------------------------------------------------------------ *
 * rbac.setLimit
 * ------------------------------------------------------------------ */

/** The valid range of a limit value per kind (plan §5.2: -1 = unlimited). */
export function limitValueValid(kind: ApprovalKind, value: number): boolean {
  if (!Number.isInteger(value)) return false
  if (kind === "credit-override") return value === 0 || value === 1
  if (kind === "discount-pct") return value >= 0 && value <= 100
  return value === -1 || value >= 0
}

export const setLimit = defineCommand({
  name: "rbac.setLimit",
  permission: "rbac.limits.edit",
  input: z.object({
    roleId: z.string().min(1),
    kind: z.enum(APPROVAL_KINDS),
    /** Poisha, or percent for discount-pct; -1 unlimited; credit-override 1 = yes */
    value: z.number().int(),
    expectedVersion: z.number().int().optional(),
    reason: z.string().max(200).optional(),
  }),
  async run(tx, input) {
    const role = await tx.get("roles", input.roleId)
    if (tx.security.roleIds.includes(role.id)) tx.reject("RBAC_OWN_LIMIT", { role: role.nameEn })
    if (!limitValueValid(input.kind, input.value)) {
      tx.reject("RBAC_LIMIT_INVALID", { kind: KIND_LABEL_EN[input.kind] })
    }
    const [row] = await tx.list("approvalLimits", "[roleId+kind]", [role.id, input.kind])
    let before = 0
    if (row) {
      before = row.value
      if (row.value === input.value) return { changed: false }
      await tx.update("approvalLimits", row.id, { value: input.value }, { expectedVersion: input.expectedVersion })
    } else {
      tx.insert("approvalLimits", { roleId: role.id, kind: input.kind, value: input.value })
    }
    if (input.reason) tx.auditContext({ reason: input.reason })
    tx.emit("LimitChanged", {
      refs: { roleId: role.id },
      params: { kind: KIND_LABEL_EN[input.kind], role: role.nameEn, from: before, to: input.value },
      locationId: null,
    })
    return { changed: true }
  },
})

/* ------------------------------------------------------------------ *
 * rbac.saveRole
 * ------------------------------------------------------------------ */

const ROLE_CODE = /^[A-Z][A-Z0-9_]{1,23}$/

export const saveRole = defineCommand({
  name: "rbac.saveRole",
  permission: "rbac.role.edit",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: z.number().int().optional(),
    code: z.string().trim().toUpperCase(),
    nameEn: z.string().trim().min(2).max(60),
    nameBn: z.string().trim().min(1).max(60),
    descriptionEn: z.string().trim().max(200).default(""),
    descriptionBn: z.string().trim().max(200).default(""),
    active: z.boolean().default(true),
    /** New roles only: copy grants and limits from this role */
    copyFrom: z.string().optional(),
  }),
  async run(tx, input) {
    if (!ROLE_CODE.test(input.code)) tx.reject("RBAC_ROLE_CODE_INVALID", { code: input.code })
    const sameCode = (await tx.list("roles", "code", input.code)).filter((r) => r.id !== input.id)
    if (sameCode.length) tx.reject("RBAC_ROLE_CODE_TAKEN", { code: input.code })
    const fields = {
      code: input.code,
      nameEn: input.nameEn,
      nameBn: input.nameBn,
      descriptionEn: input.descriptionEn,
      descriptionBn: input.descriptionBn,
      active: input.active,
    }

    let role: RoleRow
    if (input.id) {
      const current = await tx.get("roles", input.id, { expectedVersion: input.expectedVersion })
      if (current.isSystem && current.code !== input.code) tx.reject("RBAC_SYSTEM_ROLE_CODE", { role: current.nameEn })
      if (!input.active && tx.security.roleIds.includes(current.id)) tx.reject("RBAC_OWN_ROLE", { role: current.nameEn })
      role = await tx.update("roles", current.id, fields)
    } else {
      role = tx.insert("roles", { ...fields, isSystem: false })
      const source = input.copyFrom ? await tx.get("roles", input.copyFrom) : null
      const sourceLimits = source ? await tx.list("approvalLimits", "roleId", source.id) : []
      for (const kind of APPROVAL_KINDS) {
        const value = sourceLimits.find((l) => l.kind === kind)?.value ?? 0
        tx.insert("approvalLimits", { roleId: role.id, kind, value })
      }
      if (source) {
        for (const rp of await tx.list("rolePermissions", "roleId", source.id)) {
          tx.insert("rolePermissions", { roleId: role.id, permission: rp.permission, scope: rp.scope })
        }
      }
    }
    tx.emit("RoleSaved", { refs: { roleId: role.id }, params: { role: role.nameEn }, locationId: null })
    return { roleId: role.id }
  },
})

/* ------------------------------------------------------------------ *
 * rbac.saveSodRule
 * ------------------------------------------------------------------ */

export const saveSodRule = defineCommand({
  name: "rbac.saveSodRule",
  permission: "rbac.sod.edit",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: z.number().int().optional(),
    code: z.string().trim().toUpperCase(),
    permissionA: z.string().min(1),
    permissionB: z.string().min(1),
    mode: z.enum(["warn", "block"]),
    descriptionEn: z.string().trim().min(2).max(160),
    descriptionBn: z.string().trim().min(1).max(160),
    active: z.boolean().default(true),
  }),
  async run(tx, input) {
    if (!/^[A-Z0-9][A-Z0-9-]{2,15}$/.test(input.code)) tx.reject("RBAC_SOD_CODE_INVALID", { code: input.code })
    if (!PERMISSION_BY_KEY.has(input.permissionA)) tx.reject("RBAC_UNKNOWN_KEY", { permission: input.permissionA })
    if (input.permissionB !== ANY_APPROVE && !PERMISSION_BY_KEY.has(input.permissionB)) {
      tx.reject("RBAC_UNKNOWN_KEY", { permission: input.permissionB })
    }
    if (input.permissionA === input.permissionB) tx.reject("RBAC_SOD_SAME_KEY")
    const sameCode = (await tx.list("sodRules", "code", input.code)).filter((r) => r.id !== input.id)
    if (sameCode.length) tx.reject("RBAC_SOD_CODE_TAKEN", { code: input.code })
    const fields = {
      code: input.code,
      permissionA: input.permissionA,
      permissionB: input.permissionB,
      mode: input.mode,
      descriptionEn: input.descriptionEn,
      descriptionBn: input.descriptionBn,
      active: input.active,
    }
    const rule = input.id
      ? await (async () => {
          await tx.get("sodRules", input.id!, { expectedVersion: input.expectedVersion })
          return tx.update("sodRules", input.id!, fields)
        })()
      : tx.insert("sodRules", fields)
    tx.emit("SodRuleSaved", { params: { rule: rule.code }, locationId: null })
    return { ruleId: rule.id }
  },
})
