"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import { usePermissions } from "@/core/security/useCan"

/**
 * Yellow count badges in the sidebar (ui_guidelines.md §3), by href. Phase 0
 * counts the approvals waiting for this user; WS-Shell adds the per-app
 * counts (jobs in QC, bills on hold, items below reorder, PDCs due).
 */
export function useNavCounts(): Record<string, number> {
  const db = useDb()
  const { user } = usePermissions()
  const pending = useLiveQuery(async () => {
    if (!user) return 0
    return db.approvals
      .where("routedTo")
      .equals(user.id)
      .filter((a) => a.status === "pending" && a.requestedBy !== user.id)
      .count()
  }, [db, user?.id])
  return { "/approvals": pending ?? 0 }
}
