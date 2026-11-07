import { z } from "zod"

import { DEFAULT_SECURITY_POLICY, getSetting } from "@/core/db/settings"
import type { SecurityPolicy, UserRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { hashPassword } from "@/core/security/password"

import { tempPasswordFor } from "./temp-password"

/**
 * SAC commands (implementation_plan.md §6.2): users (create, edit, enable
 * and disable, unlock, password reset) and the security policy. Sign-in, MFA,
 * sign-out, the forced session end and the own password change live in
 * core/security/signin.ts and are used as they are.
 */

const USERNAME = /^[a-z][a-z0-9._-]{2,23}$/

const userFields = z.object({
  username: z.string().trim().toLowerCase(),
  nameEn: z.string().trim().min(2).max(60),
  nameBn: z.string().trim().min(1).max(60),
  designationEn: z.string().trim().max(60).default(""),
  designationBn: z.string().trim().max(60).default(""),
  email: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(20).default(""),
  employeeNo: z.string().trim().max(16).default(""),
  homeLocationId: z.string().min(1),
  locationIds: z.array(z.string().min(1)).min(1),
  mfaEnabled: z.boolean().default(false),
  sex: z.enum(["M", "F"]).default("M"),
})

async function checkLocations(tx: Tx, homeLocationId: string, locationIds: string[]): Promise<void> {
  for (const id of new Set([homeLocationId, ...locationIds])) {
    const location = await tx.find("locations", id)
    if (!location) tx.reject("SAC_LOCATION_UNKNOWN", { location: id })
  }
  if (!locationIds.includes(homeLocationId)) tx.reject("SAC_HOME_NOT_ALLOWED")
}

/** Ends every open session of a user (forced), so their windows return to /login. */
async function endSessionsOf(tx: Tx, user: UserRow): Promise<number> {
  const open = (await tx.list("sessions", "userId", user.id)).filter((s) => s.endedAt === undefined)
  for (const session of open) {
    await tx.update("sessions", session.id, { endedAt: tx.now(), endedReason: "forced", endedBy: tx.actor.userId })
    tx.emit("SessionEnded", {
      refs: { userId: user.id, sessionId: session.id },
      params: { user: user.nameEn },
      locationId: session.locationId,
    })
  }
  return open.length
}

/* ------------------------------------------------------------------ *
 * sac.saveUser
 * ------------------------------------------------------------------ */

export const saveUser = defineCommand({
  name: "sac.saveUser",
  /** New users need sac.user.create, edits sac.user.edit (checked below) */
  permission: ["sac.user.create", "sac.user.edit"],
  input: userFields.extend({
    id: z.string().optional(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const isNew = !input.id
    if (isNew && !tx.can("sac.user.create")) tx.reject("PERMISSION_DENIED", { permission: "sac.user.create" })
    if (!isNew && !tx.can("sac.user.edit")) tx.reject("PERMISSION_DENIED", { permission: "sac.user.edit" })
    if (!USERNAME.test(input.username)) tx.reject("SAC_USERNAME_INVALID", { username: input.username })
    const taken = (await tx.list("users", "username", input.username)).filter((u) => u.id !== input.id)
    if (taken.length) tx.reject("SAC_USERNAME_TAKEN", { username: input.username })
    await checkLocations(tx, input.homeLocationId, input.locationIds)

    const fields = {
      username: input.username,
      nameEn: input.nameEn,
      nameBn: input.nameBn,
      designationEn: input.designationEn,
      designationBn: input.designationBn,
      email: input.email,
      phone: input.phone,
      employeeNo: input.employeeNo,
      homeLocationId: input.homeLocationId,
      locationIds: [...new Set(input.locationIds)],
      mfaEnabled: input.mfaEnabled,
      sex: input.sex,
    }

    if (isNew) {
      const tempPassword = tempPasswordFor(tx.commitId)
      const user = tx.insert("users", {
        ...fields,
        status: "active",
        passwordHash: hashPassword(input.username, tempPassword),
        passwordSetAt: tx.now(),
        mustChangePassword: true,
        failedAttempts: 0,
        avatarSeed: input.username,
      })
      tx.emit("UserCreated", { refs: { userId: user.id }, params: { user: user.nameEn }, locationId: user.homeLocationId })
      return { userId: user.id, tempPassword: tempPassword as string | null }
    }

    const current = await tx.get("users", input.id!, { expectedVersion: input.expectedVersion })
    // The username is the sign-in id and part of the password hash: it never changes.
    if (current.username !== input.username) tx.reject("SAC_USERNAME_FIXED")
    const user = await tx.update("users", current.id, fields)
    tx.emit("UserUpdated", { refs: { userId: user.id }, params: { user: user.nameEn }, locationId: user.homeLocationId })
    return { userId: user.id, tempPassword: null as string | null }
  },
})

/* ------------------------------------------------------------------ *
 * sac.setUserStatus (deactivate or enable)
 * ------------------------------------------------------------------ */

export const setUserStatus = defineCommand({
  name: "sac.setUserStatus",
  permission: "sac.user.edit",
  input: z.object({
    userId: z.string().min(1),
    status: z.enum(["active", "disabled"]),
    reason: z.string().trim().max(200).optional(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    if (input.userId === tx.actor.userId) tx.reject("SAC_OWN_STATUS")
    const user = await tx.get("users", input.userId, { expectedVersion: input.expectedVersion })
    if (user.status === input.status) return { changed: false, sessionsEnded: 0 }
    if (input.status === "active" && user.status === "locked") tx.reject("SAC_USE_UNLOCK", { user: user.nameEn })
    const updated = await tx.update("users", user.id, {
      status: input.status,
      ...(input.status === "active" ? { failedAttempts: 0 } : {}),
    })
    if (input.reason) tx.auditContext({ reason: input.reason })
    const sessionsEnded = input.status === "disabled" ? await endSessionsOf(tx, updated) : 0
    tx.emit("UserUpdated", {
      refs: { userId: user.id },
      params: { user: user.nameEn, status: input.status },
      locationId: user.homeLocationId,
    })
    return { changed: true, sessionsEnded }
  },
})

/* ------------------------------------------------------------------ *
 * sac.unlockUser
 * ------------------------------------------------------------------ */

export const unlockUser = defineCommand({
  name: "sac.unlockUser",
  permission: "sac.user.edit",
  input: z.object({
    userId: z.string().min(1),
    reason: z.string().trim().max(200).optional(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const user = await tx.get("users", input.userId, { expectedVersion: input.expectedVersion })
    if (user.status !== "locked") tx.reject("SAC_NOT_LOCKED", { user: user.nameEn })
    await tx.update("users", user.id, { status: "active", failedAttempts: 0 })
    if (input.reason) tx.auditContext({ reason: input.reason })
    tx.emit("UserUnlocked", { refs: { userId: user.id }, params: { user: user.nameEn }, locationId: user.homeLocationId })
    return { unlocked: true }
  },
})

/* ------------------------------------------------------------------ *
 * sac.resetPassword
 * ------------------------------------------------------------------ */

export const resetPassword = defineCommand({
  name: "sac.resetPassword",
  permission: "sac.user.edit",
  input: z.object({
    userId: z.string().min(1),
    reason: z.string().trim().max(200).optional(),
  }),
  async run(tx, input) {
    if (input.userId === tx.actor.userId) tx.reject("SAC_OWN_RESET")
    const user = await tx.get("users", input.userId)
    if (user.status === "disabled") tx.reject("USER_DISABLED", { user: user.username })
    const tempPassword = tempPasswordFor(tx.commitId)
    await tx.update("users", user.id, {
      passwordHash: hashPassword(user.username, tempPassword),
      passwordSetAt: tx.now(),
      mustChangePassword: true,
      failedAttempts: 0,
    })
    if (input.reason) tx.auditContext({ reason: input.reason })
    tx.emit("PasswordReset", { refs: { userId: user.id }, params: { user: user.nameEn }, locationId: user.homeLocationId })
    // Shown once to the administrator (simulated delivery); never stored in clear.
    return { tempPassword }
  },
})

/* ------------------------------------------------------------------ *
 * sac.savePolicy
 * ------------------------------------------------------------------ */

export const POLICY_BOUNDS = {
  minLength: [6, 32],
  lockoutThreshold: [3, 10],
  idleTimeoutMin: [5, 1440],
  passwordExpiryDays: [0, 365],
} as const

export const savePolicy = defineCommand({
  name: "sac.savePolicy",
  permission: "sac.policy.configure",
  input: z.object({
    minLength: z.number().int().min(POLICY_BOUNDS.minLength[0]).max(POLICY_BOUNDS.minLength[1]),
    requireDigit: z.boolean(),
    lockoutThreshold: z.number().int().min(POLICY_BOUNDS.lockoutThreshold[0]).max(POLICY_BOUNDS.lockoutThreshold[1]),
    idleTimeoutMin: z.number().int().min(POLICY_BOUNDS.idleTimeoutMin[0]).max(POLICY_BOUNDS.idleTimeoutMin[1]),
    passwordExpiryDays: z
      .number()
      .int()
      .min(POLICY_BOUNDS.passwordExpiryDays[0])
      .max(POLICY_BOUNDS.passwordExpiryDays[1]),
    mfaRequiredRoles: z.array(z.string()),
    expectedVersion: z.number().int().optional(),
    reason: z.string().trim().max(200).optional(),
  }),
  async run(tx, input) {
    const value: SecurityPolicy = {
      minLength: input.minLength,
      requireDigit: input.requireDigit,
      lockoutThreshold: input.lockoutThreshold,
      idleTimeoutMin: input.idleTimeoutMin,
      passwordExpiryDays: input.passwordExpiryDays,
      mfaRequiredRoles: [...new Set(input.mfaRequiredRoles)].sort(),
    }
    const roles = await tx.all("roles")
    const codes = new Set(roles.map((r) => r.code))
    for (const code of value.mfaRequiredRoles) if (!codes.has(code)) tx.reject("SAC_ROLE_UNKNOWN", { role: code })

    const row = await tx.find("settings", "security")
    const before = row ? await getSetting(tx, "security") : DEFAULT_SECURITY_POLICY
    if (row) await tx.update("settings", "security", { value }, { expectedVersion: input.expectedVersion })
    else tx.insert("settings", { id: "security", value })

    // Users holding a role that requires MFA get the second step from now on.
    const required = new Set(roles.filter((r) => value.mfaRequiredRoles.includes(r.code)).map((r) => r.id))
    let mfaTurnedOn = 0
    if (required.size) {
      const holders = new Set<string>()
      for (const roleId of required) {
        for (const ur of await tx.list("userRoles", "roleId", roleId)) holders.add(ur.userId)
      }
      for (const userId of holders) {
        const user = await tx.get("users", userId)
        if (!user.mfaEnabled) {
          await tx.update("users", user.id, { mfaEnabled: true })
          mfaTurnedOn += 1
        }
      }
    }
    if (input.reason) tx.auditContext({ reason: input.reason })
    const changed = (Object.keys(value) as (keyof SecurityPolicy)[]).filter(
      (key) => JSON.stringify(value[key]) !== JSON.stringify(before[key])
    )
    tx.emit("PolicyChanged", { params: { fields: changed.join(", ") || "-" }, locationId: null })
    return { changed, mfaTurnedOn }
  },
})
