"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { Id, LocationRow, RoleRow, UserRow } from "@/core/db/schema"
import type { Locale } from "@/lib/i18n/config"

/**
 * Live user lookups from the `users` table (replacing MedCore's static
 * personas). The static directory for the launcher is `SEED_USERS`.
 */

export function useUser(userId: Id | null | undefined): UserRow | undefined {
  const db = useDb()
  return useLiveQuery(
    () => (userId && userId !== "system" ? db.users.get(userId) : undefined),
    [db, userId]
  )
}

export function useUsers(): UserRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.users.orderBy("username").toArray(), [db])
}

export function useRoles(): RoleRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.roles.toArray(), [db])
}

export function useLocations(): LocationRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.locations.toArray(), [db])
}

/** A user's display name in the window's language. */
export function userName(
  user: Pick<UserRow, "nameEn" | "nameBn"> | undefined,
  locale: Locale
): string {
  if (!user) return ""
  return locale === "bn" ? user.nameBn : user.nameEn
}

/** "Farzana" from "Farzana Haque" (greetings). */
export function firstName(user: Pick<UserRow, "nameEn" | "nameBn"> | undefined, locale: Locale) {
  return userName(user, locale).split(" ")[0] ?? ""
}

/** Any bilingual row's name in the window's language. */
export function nameOf(
  row: { nameEn: string; nameBn: string } | undefined,
  locale: Locale
): string {
  if (!row) return ""
  return locale === "bn" && row.nameBn ? row.nameBn : row.nameEn
}

/** A map of user id to row, for name lookups in lists. */
export function useUserMap(): Map<Id, UserRow> {
  const users = useUsers()
  return new Map((users ?? []).map((u) => [u.id, u]))
}
