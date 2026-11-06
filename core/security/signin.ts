import { z } from "zod"

import { rules } from "@/config/rules.config"
import type { SweepJob } from "@/core/clock/types"
import { getSetting, readSetting } from "@/core/db/settings"
import type { Id, UserRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"

import { hashPassword } from "./password"

/**
 * Sign-in, MFA, sign-out and session end (plan §3.8). Sign-in runs as the
 * system actor (the window has no session yet); a failed attempt still
 * commits, so the failure, the attempt count and a lockout are recorded.
 */

export type SignInResult =
  | { status: "ok"; userId: Id; sessionId: Id; locationId: Id }
  | { status: "mfa"; userId: Id }
  | {
      status: "failed"
      reason: "bad-credentials" | "locked" | "disabled" | "mfa-failed"
      attemptsLeft?: number
    }

function userLabel(user: UserRow): string {
  return user.nameEn
}

async function openSession(
  tx: Tx,
  user: UserRow,
  input: { windowId: string; locationId?: string },
  method: "password" | "demo-quick"
): Promise<SignInResult> {
  const locationId =
    input.locationId && user.locationIds.includes(input.locationId)
      ? input.locationId
      : user.homeLocationId
  const session = tx.insert("sessions", {
    userId: user.id,
    windowId: input.windowId,
    locationId,
    startedAt: tx.now(),
    lastActivityRealAt: Date.now(),
    method,
  })
  await tx.update("users", user.id, { failedAttempts: 0, lastLoginAt: tx.now() })
  tx.insert("loginEvents", {
    username: user.username,
    userId: user.id,
    at: tx.now(),
    result: "success",
    method,
    windowId: input.windowId,
  })
  tx.emit("SignedIn", {
    refs: { userId: user.id, sessionId: session.id },
    params: { user: userLabel(user) },
    locationId,
  })
  return { status: "ok", userId: user.id, sessionId: session.id, locationId }
}

async function recordFailure(
  tx: Tx,
  user: UserRow,
  windowId: string,
  result: "bad-password" | "mfa-failed",
  method: "password" | "mfa"
): Promise<SignInResult> {
  const policy = await getSetting(tx, "security")
  const attempts = user.failedAttempts + 1
  const lock = attempts >= policy.lockoutThreshold
  await tx.update("users", user.id, {
    failedAttempts: attempts,
    ...(lock ? { status: "locked" as const } : {}),
  })
  tx.insert("loginEvents", {
    username: user.username,
    userId: user.id,
    at: tx.now(),
    result,
    method,
    windowId,
  })
  tx.emit("SignInFailed", {
    refs: { userId: user.id },
    params: { user: userLabel(user), attempts },
    locationId: null,
  })
  if (lock) {
    tx.emit("UserLocked", {
      refs: { userId: user.id },
      params: { user: userLabel(user) },
      locationId: null,
    })
    return { status: "failed", reason: "locked" }
  }
  return {
    status: "failed",
    reason: result === "mfa-failed" ? "mfa-failed" : "bad-credentials",
    attemptsLeft: policy.lockoutThreshold - attempts,
  }
}

export const signIn = defineCommand({
  name: "sac.signIn",
  permission: "system",
  input: z.object({
    username: z.string().min(1),
    password: z.string().optional(),
    windowId: z.string().min(1),
    method: z.enum(["password", "demo-quick"]),
    locationId: z.string().optional(),
  }),
  async run(tx, input): Promise<SignInResult> {
    const username = input.username.trim().toLowerCase()
    const [user] = await tx.list("users", "username", username)
    if (!user) {
      tx.insert("loginEvents", {
        username,
        at: tx.now(),
        result: "unknown-user",
        method: input.method,
        windowId: input.windowId,
      })
      tx.emit("SignInFailed", { params: { user: username, attempts: 0 }, locationId: null })
      return { status: "failed", reason: "bad-credentials" }
    }
    if (user.status !== "active") {
      const result = user.status === "locked" ? "locked" : "disabled"
      tx.insert("loginEvents", {
        username,
        userId: user.id,
        at: tx.now(),
        result,
        method: input.method,
        windowId: input.windowId,
      })
      return { status: "failed", reason: result }
    }
    if (input.method === "password") {
      if (hashPassword(username, input.password ?? "") !== user.passwordHash) {
        return recordFailure(tx, user, input.windowId, "bad-password", "password")
      }
      if (user.mfaEnabled) {
        // Simulated SMS: "your code is 123456". The session opens after the code.
        return { status: "mfa", userId: user.id }
      }
    }
    return openSession(tx, user, input, input.method)
  },
})

export const verifyMfa = defineCommand({
  name: "sac.verifyMfa",
  permission: "system",
  input: z.object({
    userId: z.string(),
    code: z.string(),
    windowId: z.string().min(1),
    locationId: z.string().optional(),
  }),
  async run(tx, input): Promise<SignInResult> {
    const user = await tx.get("users", input.userId)
    if (user.status !== "active") {
      return { status: "failed", reason: user.status === "locked" ? "locked" : "disabled" }
    }
    if (input.code.trim() !== rules.mfaCode) {
      return recordFailure(tx, user, input.windowId, "mfa-failed", "mfa")
    }
    return openSession(tx, user, input, "password")
  },
})

export const signOut = defineCommand({
  name: "sac.signOut",
  permission: "authenticated",
  input: z.object({}),
  async run(tx) {
    const sessionId = tx.actor.sessionId
    if (!sessionId || sessionId.startsWith("scenario:")) return { ended: false }
    const session = await tx.get("sessions", sessionId)
    if (session.endedAt !== undefined) return { ended: false }
    await tx.update("sessions", sessionId, {
      endedAt: tx.now(),
      endedReason: "sign-out",
      endedBy: tx.actor.userId,
    })
    tx.emit("SignedOut", {
      refs: { userId: tx.actor.userId, sessionId },
      params: { user: tx.actor.name },
    })
    return { ended: true }
  },
})

export const endSession = defineCommand({
  name: "sac.endSession",
  permission: "sac.session.end",
  input: z.object({ sessionId: z.string(), reason: z.string().optional() }),
  async run(tx, input) {
    const session = await tx.get("sessions", input.sessionId)
    if (session.endedAt !== undefined) tx.reject("SESSION_ALREADY_ENDED")
    if (session.id === tx.actor.sessionId) tx.reject("CANNOT_END_OWN_SESSION")
    const user = await tx.get("users", session.userId)
    await tx.update("sessions", session.id, {
      endedAt: tx.now(),
      endedReason: "forced",
      endedBy: tx.actor.userId,
    })
    tx.auditContext({ reason: input.reason })
    tx.emit("SessionEnded", {
      refs: { userId: user.id, sessionId: session.id },
      params: { user: user.nameEn },
    })
    return { ended: true }
  },
})

/** System command for the idle sweeper. */
export const timeoutSessions = defineCommand({
  name: "sac.timeoutSessions",
  permission: "system",
  input: z.object({ ids: z.array(z.string()) }),
  async run(tx, input) {
    for (const id of input.ids) {
      const session = await tx.get("sessions", id)
      if (session.endedAt !== undefined) continue
      await tx.update("sessions", id, { endedAt: tx.now(), endedReason: "timeout" })
      const user = await tx.find("users", session.userId)
      tx.emit("SessionEnded", {
        refs: { userId: session.userId, sessionId: id },
        params: { user: user?.nameEn ?? session.userId },
        locationId: session.locationId,
      })
    }
  },
})

/**
 * `sac.idleSessions` (plan §3.13): ends sessions idle longer than the policy,
 * measured in WALL-CLOCK time so demo-clock jumps never sign anyone out.
 * Quick demo sessions are skipped.
 */
export const securityJobs: SweepJob[] = [
  {
    id: "sac.idleSessions",
    async run(ctx) {
      const policy = await readSetting(ctx.db, "security")
      const limitMs = policy.idleTimeoutMin * 60_000
      const wall = Date.now()
      const due = await ctx.db.sessions
        .filter(
          (s) =>
            s.endedAt === undefined &&
            s.method !== "demo-quick" &&
            wall - s.lastActivityRealAt > limitMs
        )
        .toArray()
      if (due.length) await ctx.commitSystem(timeoutSessions, { ids: due.map((s) => s.id) })
    },
  },
]
