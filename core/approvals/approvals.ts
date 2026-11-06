import { rules } from "@/config/rules.config"
import { notifyUser } from "@/core/comms/sms"
import type { ApprovalRow, Id, Poisha } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import { grantAllows, resolveSecurity } from "@/core/security/resolve"
import type { ApprovalKind } from "@/core/security/types"

/**
 * Approvals and maker-checker (plan §3.7). A maker's document within their
 * own limit posts at once; above it, either an inline approval (another user
 * with the kind's approve key, a covering limit and scope over the
 * document's location confirms with a PIN on this device) or a queued
 * approval routed to such users' inbox. Nobody approves their own work.
 */

/** Kinds that are only ever approved inline (no pending state). */
export const INLINE_ONLY: readonly ApprovalKind[] = ["discount-pct", "credit-override"]

/** The approve key a decider must hold, by kind and document table (§3.7 table). */
export function approveKeyFor(kind: ApprovalKind, docType: string): string {
  switch (kind) {
    case "discount-pct":
      return "stl.discount.approve"
    case "credit-override":
      return "ar.credit.override"
    case "credit-note":
      return "si.creditnote.approve"
    case "journal":
      return "fa.journal.approve"
    case "payment":
      return "ap.payment.approve"
    case "petty-cash":
      return "cab.pettycash.approve"
    case "stock-adjust":
      return docType === "stockCounts" ? "ic.count.approve" : "st.adjust.approve"
    case "purchase":
      if (docType === "purchaseRequisitions") return "ptl.pr.approve"
      if (docType === "purchaseOrders") return "ptl.po.approve"
      return "ap.bill.approve"
  }
}

/** The figure a limit is compared with: percent for discounts, 1 for credit overrides, else poisha. */
export function approvalAmount(kind: ApprovalKind, amountP?: Poisha, pct?: number): number {
  if (kind === "discount-pct") return pct ?? 0
  if (kind === "credit-override") return 1
  return amountP ?? 0
}

export type InlineApproval = {
  approverId: Id
  /** Simulated PIN (rules.supervisorPin) typed by the approver on this device */
  pin: string
  reason: string
}

export type ApprovalRequest = {
  kind: ApprovalKind
  /** The document's table, e.g. "vendorPayments" */
  docType: string
  docId: Id
  docNo: string
  locationId?: Id
  amountP?: Poisha
  pct?: number
  /** The maker's reason (shown to the approver) */
  reason?: string
  /** Approver and PIN when the approval happens on the spot */
  inline?: InlineApproval
}

export type ApprovalOutcome =
  /** Within the maker's own limit: no approval row, post at once */
  | { status: "within-limit" }
  /** Approved inline: post at once, record the approval id on the document */
  | { status: "approved"; approvalId: Id }
  /** Queued: save the document pending-approval with this approval id */
  | { status: "pending"; approvalId: Id }

/** Whether a user (by security) may decide an approval of this kind, amount and location. */
export function canDecide(
  security: Awaited<ReturnType<typeof resolveSecurity>>,
  locationIds: readonly Id[],
  approval: Pick<ApprovalRow, "approveKey" | "locationId" | "kind" | "amountP" | "pct">
): boolean {
  if (!grantAllows(security, approval.approveKey, locationIds, approval.locationId)) return false
  const limit = security.limits[approval.kind] ?? 0
  return limit >= approvalAmount(approval.kind, approval.amountP, approval.pct)
}

/**
 * Users who could decide an approval now (active, holding the approve key
 * with scope over the location and a covering limit), never the requester.
 * Reads committed security data.
 */
export async function eligibleApprovers(
  tx: Tx,
  approval: Pick<ApprovalRow, "approveKey" | "locationId" | "kind" | "amountP" | "pct" | "requestedBy">
): Promise<Id[]> {
  const users = await tx.db.users.where("status").equals("active").toArray()
  const out: Id[] = []
  for (const user of users) {
    if (user.id === approval.requestedBy) continue
    const security = await resolveSecurity(tx.db, user.id)
    if (canDecide(security, user.locationIds, approval)) out.push(user.id)
  }
  return out
}

/**
 * Decide whether a maker's document needs approval, and record it (plan
 * §3.7). Call it inside the maker's command once the document row exists:
 *
 *   const outcome = await requireApproval(tx, { kind: "payment", docType: "vendorPayments", ... })
 *   if (outcome.status === "pending") ... save pending-approval
 *   else ... post now (store outcome.approvalId when "approved")
 *
 * Inline-only kinds (discounts, credit overrides) above the limit without an
 * inline approver are refused with APPROVAL_LIMIT (the UI then opens the
 * approval dialog and retries with `inline`).
 */
export async function requireApproval(tx: Tx, req: ApprovalRequest): Promise<ApprovalOutcome> {
  const amount = approvalAmount(req.kind, req.amountP, req.pct)
  if (amount <= tx.limit(req.kind)) return { status: "within-limit" }

  const approveKey = approveKeyFor(req.kind, req.docType)
  const base = {
    kind: req.kind,
    docType: req.docType,
    docId: req.docId,
    docNo: req.docNo,
    locationId: req.locationId,
    amountP: req.amountP,
    pct: req.pct,
    requestedBy: tx.actor.userId,
    requestedAt: tx.now(),
    approveKey,
  }

  if (req.inline) {
    const { approverId, pin, reason } = req.inline
    if (approverId === tx.actor.userId) tx.reject("SELF_APPROVAL", {}, { audit: true })
    const approver = await tx.find("users", approverId)
    if (!approver || approver.status !== "active") tx.reject("NOT_APPROVER", { permission: approveKey, amount })
    if (pin !== rules.supervisorPin) tx.reject("BAD_PIN", {}, { audit: true })
    const security = await resolveSecurity(tx.db, approver.id)
    if (!canDecide(security, approver.locationIds, base)) {
      tx.reject("NOT_APPROVER", { permission: approveKey, amount }, { audit: true })
    }
    const row = tx.insert("approvals", {
      ...base,
      status: "approved",
      decidedBy: approver.id,
      decidedAt: tx.now(),
      reason,
      decisionReason: reason,
      inline: true,
      pinVerified: true,
      routedTo: [approver.id],
    })
    tx.auditContext({ reason, approvedBy: approver.id })
    tx.emit("ApprovalDecided", {
      refs: { approvalId: row.id },
      params: { docNo: req.docNo, decision: "approved", kind: req.kind },
      locationId: req.locationId ?? null,
    })
    return { status: "approved", approvalId: row.id }
  }

  if (INLINE_ONLY.includes(req.kind)) {
    tx.reject("APPROVAL_LIMIT", { kind: req.kind, amount })
  }

  const routedTo = await eligibleApprovers(tx, { ...base })
  const row = tx.insert("approvals", {
    ...base,
    status: "pending",
    reason: req.reason ?? "",
    inline: false,
    pinVerified: false,
    routedTo,
  })
  for (const userId of routedTo) {
    notifyUser(tx, {
      userId,
      kind: "approval-requested",
      titleKey: "approvals.notify.requested",
      params: { docNo: req.docNo, by: tx.actor.name },
      refs: { approvalId: row.id },
      href: "/approvals",
    })
  }
  tx.emit("ApprovalRequested", {
    refs: { approvalId: row.id },
    params: { docNo: req.docNo, kind: req.kind },
    locationId: req.locationId ?? null,
  })
  return { status: "pending", approvalId: row.id }
}
