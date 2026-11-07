"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { locationById } from "@/config/brand.config"
import type { Tone } from "@/components/shared/status"
import { useDb } from "@/core/db/DbProvider"
import type { Id, LoginEventRow, RoleRow, SessionRow, UserRow } from "@/core/db/schema"
import type { Locale } from "@/lib/i18n/config"

/**
 * SAC live queries (useDb + useLiveQuery) and display helpers. Every list
 * re-renders when another window commits (a lockout, a forced sign-out, an
 * RBAC change).
 */

export type UserDirectory = {
  users: UserRow[]
  roles: RoleRow[]
  roleById: Map<Id, RoleRow>
  /** Role rows per user (active and inactive), in role code order */
  rolesByUser: Map<Id, RoleRow[]>
  userById: Map<Id, UserRow>
}

/** Users with their roles, live. */
export function useUserDirectory(): UserDirectory | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [users, roles, userRoles] = await Promise.all([
      db.users.orderBy("username").toArray(),
      db.roles.toArray(),
      db.userRoles.toArray(),
    ])
    const roleById = new Map(roles.map((r) => [r.id, r]))
    const rolesByUser = new Map<Id, RoleRow[]>()
    for (const ur of userRoles) {
      const role = roleById.get(ur.roleId)
      if (!role) continue
      const list = rolesByUser.get(ur.userId) ?? []
      list.push(role)
      rolesByUser.set(ur.userId, list)
    }
    for (const list of rolesByUser.values()) list.sort((a, b) => a.code.localeCompare(b.code))
    return { users, roles, roleById, rolesByUser, userById: new Map(users.map((u) => [u.id, u])) }
  }, [db])
}

/** Open sessions (no end), newest first. */
export function useOpenSessions(): SessionRow[] | undefined {
  const db = useDb()
  return useLiveQuery(
    async () =>
      (await db.sessions.filter((s) => s.endedAt === undefined).toArray()).sort((a, b) => b.startedAt - a.startedAt),
    [db]
  )
}

/** Login events at or after a moment, newest first. */
export function useLoginEventsSince(since: number | null): LoginEventRow[] | undefined {
  const db = useDb()
  return useLiveQuery(
    async () => (since === null ? [] : db.loginEvents.where("at").aboveOrEqual(since).reverse().sortBy("at")),
    [db, since]
  )
}

/** Wall-clock time that ticks (idle time of sessions is measured in wall-clock time, plan §3.8). */
export function useWallNow(intervalMs = 15_000): number {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const timer = setInterval(onChange, intervalMs)
      return () => clearInterval(timer)
    },
    [intervalMs]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0
  )
}

export const USER_STATUS_TONE: Record<UserRow["status"], Tone> = {
  active: "success",
  locked: "destructive",
  disabled: "muted",
}

export const LOGIN_RESULT_TONE: Record<LoginEventRow["result"], Tone> = {
  success: "success",
  "bad-password": "warning",
  locked: "destructive",
  disabled: "muted",
  "mfa-failed": "warning",
  "unknown-user": "destructive",
}

/** A location's name in the window's language ("Gulshan Studio"), or the id. */
export function locationName(id: Id | null | undefined, locale: Locale): string {
  if (!id) return ""
  return locationById(id)?.name[locale] ?? id
}

/** A location's code ("GUL"). */
export function locationCodeOf(id: Id | null | undefined): string {
  if (!id) return ""
  return locationById(id)?.code ?? id
}

/** A role's name in the window's language. */
export function roleName(role: Pick<RoleRow, "nameEn" | "nameBn"> | undefined, locale: Locale): string {
  if (!role) return ""
  return locale === "bn" && role.nameBn ? role.nameBn : role.nameEn
}

/** A user's name in the window's language. */
export function personName(user: Pick<UserRow, "nameEn" | "nameBn"> | undefined, locale: Locale): string {
  if (!user) return ""
  return locale === "bn" && user.nameBn ? user.nameBn : user.nameEn
}
