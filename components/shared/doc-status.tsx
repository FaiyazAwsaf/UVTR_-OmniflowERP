"use client"

import { StatusPill, StatusText, type Tone } from "@/components/shared/status"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Document status as coloured text with a dot (ui_guidelines.md §4
 * "Document status"): draft muted, pending approval warning, posted or issued
 * info, paid / matched / received / delivered success, partial info, on hold
 * warning, overdue or rejected destructive, cancelled or reversed muted.
 */
export const STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  "pending-approval": "warning",
  pending: "warning",
  posted: "info",
  issued: "info",
  sent: "info",
  submitted: "info",
  published: "success",
  paid: "success",
  "partially-paid": "info",
  credited: "muted",
  reversed: "muted",
  discarded: "muted",
  cancelled: "muted",
  archived: "muted",
  superseded: "muted",
  rejected: "destructive",
  approved: "success",
  accepted: "success",
  expired: "destructive",
  "on-hold": "warning",
  overdue: "destructive",
  open: "info",
  closed: "muted",
  booked: "info",
  "in-progress": "primary",
  qc: "warning",
  ready: "success",
  delivered: "success",
  invoiced: "info",
  received: "success",
  partial: "info",
  requested: "warning",
  dispatched: "info",
  ordered: "info",
  queued: "muted",
  done: "success",
  matched: "success",
  mismatch: "warning",
  "in-hand": "warning",
  deposited: "info",
  cleared: "success",
  bounced: "destructive",
  presented: "info",
  "timed-out": "destructive",
  imported: "info",
  reconciled: "success",
  counted: "info",
  held: "warning",
  returned: "muted",
  active: "success",
  inactive: "muted",
  locked: "destructive",
  disabled: "muted",
  blocked: "destructive",
  ok: "success",
  low: "warning",
  out: "destructive",
  quarantine: "primary",
  expiring: "warning",
  "in-transit": "info",
}

export function useStatusLabel() {
  const { tk } = useLocale()
  return (status: string) => {
    const key = `shared.status.${status}`
    const label = tk(key)
    return label === key ? status : label
  }
}

export function DocStatus({ status, className }: { status: string; className?: string }) {
  const label = useStatusLabel()
  return (
    <StatusText tone={STATUS_TONE[status] ?? "muted"} dot className={className} data-status={status}>
      {label(status)}
    </StatusText>
  )
}

/** The stock badge (ui_guidelines.md §4): soft pill, In stock / Low / Out / Quarantine / Expiring / In transit. */
export function StockBadge({
  status,
  className,
}: {
  status: "ok" | "low" | "out" | "quarantine" | "expiring" | "in-transit"
  className?: string
}) {
  const label = useStatusLabel()
  return (
    <StatusPill tone={STATUS_TONE[status] ?? "muted"} className={className} data-stock={status}>
      {label(status)}
    </StatusPill>
  )
}
