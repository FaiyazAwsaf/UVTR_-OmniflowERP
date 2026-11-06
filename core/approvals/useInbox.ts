"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { ApprovalRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"

import { canDecide } from "./approvals"

export type ApprovalInbox = {
  /** Pending approvals this user may decide now (live: grants, limits, scope), never their own */
  forMe: ApprovalRow[]
  /** Pending approvals this user requested ("You requested this") */
  requestedByMe: ApprovalRow[]
  /** Approvals this user decided, newest first */
  decidedByMe: ApprovalRow[]
}

/**
 * The approvals inbox data (plan §3.7, §9 `/approvals`), live in every
 * window: an RBAC or limit change, a new request or a decision in another
 * window updates it at once. `undefined` while loading.
 */
export function useApprovalInbox(): ApprovalInbox | undefined {
  const db = useDb()
  const { user, security } = usePermissions()
  return useLiveQuery(async () => {
    if (!user || !security) return { forMe: [], requestedByMe: [], decidedByMe: [] }
    const pending = await db.approvals.where("status").equals("pending").toArray()
    const byTime = (a: ApprovalRow, b: ApprovalRow) => b.requestedAt - a.requestedAt
    const forMe = pending
      .filter((a) => a.requestedBy !== user.id && canDecide(security, user.locationIds, a))
      .sort(byTime)
    const requestedByMe = pending.filter((a) => a.requestedBy === user.id).sort(byTime)
    const decidedByMe = (await db.approvals.where("status").anyOf("approved", "rejected").toArray())
      .filter((a) => a.decidedBy === user.id)
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
      .slice(0, 50)
    return { forMe, requestedByMe, decidedByMe }
  }, [db, user, security])
}

/** Live count of approvals waiting for this user (the bell and the sidebar badge). */
export function usePendingApprovalCount(): number {
  return useApprovalInbox()?.forMe.length ?? 0
}
