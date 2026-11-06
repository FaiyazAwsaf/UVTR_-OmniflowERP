import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"

import { approvalAmount } from "./approvals"
import { APPROVAL_HANDLERS } from "./registry"

/**
 * `approvals.decide` (plan §3.7, core): approve or reject a pending approval.
 * Checks INV-07 (never the requester), the kind's approve key with scope over
 * the document's location, and a covering limit; then runs the module's
 * handler for the document type IN THE SAME COMMIT, so the document posts (or
 * is rejected) atomically with the decision.
 */
export const decideApproval = defineCommand({
  name: "approvals.decide",
  permission: "authenticated",
  input: z.object({
    approvalId: z.string(),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().default(""),
    expectedVersion: z.number().int(),
  }),
  async run(tx, input) {
    const approval = await tx.get("approvals", input.approvalId, {
      expectedVersion: input.expectedVersion,
    })
    if (approval.status !== "pending") tx.reject("APPROVAL_DECIDED")
    if (approval.requestedBy === tx.actor.userId) tx.reject("SELF_APPROVAL", {}, { audit: true })
    const amount = approvalAmount(approval.kind, approval.amountP, approval.pct)
    if (!tx.can(approval.approveKey, approval.locationId) || tx.limit(approval.kind) < amount) {
      tx.reject("NOT_APPROVER", { permission: approval.approveKey, amount }, { audit: true })
    }
    const approved = input.decision === "approve"
    const decided = await tx.update("approvals", approval.id, {
      status: approved ? "approved" : "rejected",
      decidedBy: tx.actor.userId,
      decidedAt: tx.now(),
      decisionReason: input.reason,
    })
    tx.auditContext({ reason: input.reason || undefined, approvedBy: approved ? tx.actor.userId : undefined })

    const handler = APPROVAL_HANDLERS[approval.docType]
    if (!handler) tx.reject("NO_APPROVAL_HANDLER", { docType: approval.docType })
    if (approved) await handler.onApproved(tx, approval.docId, decided)
    else await handler.onRejected(tx, approval.docId, decided)

    // The approvers' inbox notices for this approval are done.
    const notices = await tx.list("notifications", "userId", tx.actor.userId)
    for (const n of notices) {
      if (!n.read && n.refs.approvalId === approval.id) await tx.update("notifications", n.id, { read: true })
    }
    // Tell the requester the outcome.
    tx.insert("notifications", {
      userId: approval.requestedBy,
      kind: "approval-decided",
      titleKey: approved ? "approvals.notify.approved" : "approvals.notify.rejected",
      params: { docNo: approval.docNo, by: tx.actor.name },
      refs: { approvalId: approval.id },
      href: "/approvals",
      read: false,
      at: tx.now(),
    })
    tx.emit("ApprovalDecided", {
      refs: { approvalId: approval.id },
      params: { docNo: approval.docNo, decision: approved ? "approved" : "rejected", kind: approval.kind },
      locationId: approval.locationId ?? null,
    })
    return { status: decided.status }
  },
})
