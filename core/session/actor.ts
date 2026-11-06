"use client"

import * as React from "react"

import type { Actor } from "@/core/engine/types"
import { usePermissions } from "@/core/security/useCan"

import { useSession } from "./session"

/**
 * This window's acting identity for commits (plan §3.3): the signed-in user,
 * the window's session and current location. Null before sign-in.
 */
export function useActor(): Actor | null {
  const { userId, sessionId, locationId } = useSession()
  const { user } = usePermissions()
  return React.useMemo(() => {
    if (!userId || !sessionId || !user || user.id !== userId) return null
    return {
      userId: user.id,
      username: user.username,
      name: user.nameEn,
      nameBn: user.nameBn,
      sessionId,
      locationId: locationId ?? user.homeLocationId,
      locationIds: user.locationIds,
    }
  }, [userId, sessionId, locationId, user])
}
