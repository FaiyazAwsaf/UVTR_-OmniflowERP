import type { EmailRow, Refs } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"

/**
 * Simulated email (plan §3.17): an outbox row; attachments are named, not
 * generated (PO to the vendor, scheduled reports). Shown with the Simulated
 * badge.
 */
export function queueEmail(
  tx: Tx,
  opts: {
    to: string[]
    subjectKey: string
    params?: Record<string, string | number>
    attachments?: string[]
    refs?: Refs
  }
): EmailRow {
  return tx.insert("emails", {
    to: opts.to,
    subjectKey: opts.subjectKey,
    params: opts.params ?? {},
    attachments: opts.attachments ?? [],
    status: "sent",
    at: tx.now(),
    refs: opts.refs ?? {},
  })
}
