"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { canDecide } from "@/core/approvals/approvals"
import { useDb } from "@/core/db/DbProvider"
import type { UserRow } from "@/core/db/schema"
import { subscribe, type BusEvent } from "@/core/events/bus"
import { usePermissions } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"

const ACCESS_EVENTS = new Set(["PermissionGranted", "PermissionRevoked", "RoleAssigned", "RoleUnassigned", "LimitChanged"])

/**
 * User-relevant toasts for commits made in OTHER windows (plan §3.12), in
 * this window's language: "New approval: PO-2627-0042 from Nusrat Jahan" for
 * the users it is routed to (or who could decide it now), the decision for
 * its requester, and a notice when an administrator changes this user's
 * access. Data itself syncs through liveQuery; this is only the nudge.
 */
export function CrossWindowToasts() {
  const db = useDb()
  const router = useRouter()
  const { user, security } = usePermissions()
  const { t, locale } = useLocale()
  const latest = React.useRef({ user, security, t, locale })
  React.useEffect(() => {
    latest.current = { user, security, t, locale }
  })

  React.useEffect(() => {
    const nameOf = (row: UserRow | undefined, fallback: string) =>
      row ? (latest.current.locale === "bn" ? row.nameBn : row.nameEn) : fallback

    const handle = async (event: BusEvent) => {
      const { user: me, security: mine, t: tr } = latest.current
      if (!me || !mine) return
      const approvalId = event.refs.approvalId
      if (event.type === "ApprovalRequested" && approvalId) {
        const approval = await db.approvals.get(approvalId)
        if (!approval || approval.status !== "pending" || approval.requestedBy === me.id) return
        if (!approval.routedTo.includes(me.id) && !canDecide(mine, me.locationIds, approval)) return
        const requester = await db.users.get(approval.requestedBy)
        toast.info(tr("approvals.notify.requested", { docNo: approval.docNo, by: nameOf(requester, approval.requestedBy) }), {
          action: {
            label: tr("shell.toasts.open"),
            onClick: () => router.push(`/approvals?focus=${approval.id}`),
          },
        })
        return
      }
      if (event.type === "ApprovalDecided" && approvalId) {
        const approval = await db.approvals.get(approvalId)
        if (!approval || approval.inline || approval.requestedBy !== me.id || approval.status === "pending") return
        const decider = await db.users.get(approval.decidedBy ?? "")
        const approved = approval.status === "approved"
        const text = tr(approved ? "approvals.notify.approved" : "approvals.notify.rejected", {
          docNo: approval.docNo,
          by: nameOf(decider, approval.decidedBy ?? ""),
        })
        if (approved) toast.success(text)
        else toast.warning(text)
        return
      }
      if (ACCESS_EVENTS.has(event.type)) {
        const mineRole = event.refs.roleId ? mine.roleIds.includes(event.refs.roleId) : false
        if (mineRole || event.refs.userId === me.id) toast.info(tr("shell.toasts.accessChanged"))
      }
    }

    return subscribe((message) => {
      if (message.kind !== "commit" || message.local) return
      for (const event of message.events) {
        void handle(event).catch(() => undefined)
      }
    })
  }, [db, router])

  return null
}
