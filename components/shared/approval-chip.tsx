"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { StatusPill } from "@/components/shared/status"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { useUserMap, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The approval chip (ui_guidelines.md §4), live: pending in warning tint with
 * who can decide it; after the decision "Approved by Farzana Haque, 10:42" in
 * success (or rejected in destructive), "on the spot" for inline approvals.
 */
export function ApprovalChip({ approvalId, className }: { approvalId: Id; className?: string }) {
  const db = useDb()
  const { t, time } = useLocale()
  const users = useUserMap()
  const { locale } = useLocale()
  const approval = useLiveQuery(() => db.approvals.get(approvalId), [db, approvalId])
  if (!approval) return null
  if (approval.status === "pending") {
    const names = approval.routedTo
      .map((id) => users.get(id))
      .filter(Boolean)
      .slice(0, 3)
      .map((u) => userName(u, locale))
      .join(", ")
    return (
      <StatusPill tone="warning" dot className={className} data-testid="approval-chip" data-status="pending">
        {t("shared.approval.pendingWith", { names })}
      </StatusPill>
    )
  }
  const by = userName(users.get(approval.decidedBy ?? ""), locale)
  const at = approval.decidedAt ? time(approval.decidedAt) : ""
  const approved = approval.status === "approved"
  return (
    <StatusPill tone={approved ? "success" : "destructive"} dot className={className} data-testid="approval-chip" data-status={approval.status}>
      {t(approved ? "shared.approval.approvedBy" : "shared.approval.rejectedBy", { name: by, time: at })}
      {approval.inline ? ` · ${t("shared.approval.inline")}` : ""}
    </StatusPill>
  )
}
