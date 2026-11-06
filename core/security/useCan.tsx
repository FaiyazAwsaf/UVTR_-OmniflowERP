"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { Id, UserRow } from "@/core/db/schema"
import type { SecurityContext } from "@/core/engine/types"
import { useSession } from "@/core/session/session"

import { EMPTY_SECURITY, grantAllows, resolveSecurity } from "./resolve"

type PermissionsValue = {
  /** undefined while loading */
  security: SecurityContext | undefined
  user: UserRow | undefined
  /** The user's allowed locations */
  locationIds: readonly Id[]
  can: (permission: string, locationId?: Id | null) => boolean
  loading: boolean
}

const PermissionsContext = React.createContext<PermissionsValue | null>(null)

/**
 * One live permissions query per window, shared through context (plan §17):
 * it re-runs whenever `userRoles`, `rolePermissions`, `approvalLimits`,
 * `roles` or the user's row change in ANY window, so the UI hides or disables
 * actions the moment RBAC changes (plan §3.8).
 */
export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const db = useDb()
  const { userId } = useSession()
  const data = useLiveQuery(async () => {
    if (!userId) return { security: EMPTY_SECURITY, user: undefined }
    const [security, user] = await Promise.all([resolveSecurity(db, userId), db.users.get(userId)])
    return { security, user }
  }, [db, userId])

  const value = React.useMemo<PermissionsValue>(() => {
    const security = data?.security
    const user = data?.user
    const locationIds = user?.locationIds ?? []
    return {
      security,
      user,
      locationIds,
      loading: data === undefined,
      can: (permission, locationId) => {
        if (permission === "authenticated") return !!user
        if (!security) return false
        return grantAllows(security, permission, locationIds, locationId)
      },
    }
  }, [data])

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsValue {
  const value = React.useContext(PermissionsContext)
  if (!value) throw new Error("usePermissions must be used inside <PermissionsProvider>")
  return value
}

/** Live: whether this window's user holds a key (at a location when given). */
export function useCan(permission: string, locationId?: Id | null): boolean {
  return usePermissions().can(permission, locationId)
}

/** Live: the user's approval limit for a kind (Infinity unlimited, 0 none). */
export function useLimit(kind: keyof SecurityContext["limits"]): number {
  return usePermissions().security?.limits[kind] ?? 0
}
