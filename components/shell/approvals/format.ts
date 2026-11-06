"use client"

import { docApp, docHref } from "@/components/shared/doc-routes"
import type { ApprovalRow, Id, UserRow } from "@/core/db/schema"
import type { Locale } from "@/lib/i18n/config"

type Fmt = {
  money: (poisha: number) => string
  pct: (value: number, digits?: number) => string
  tk: (key: string, params?: Record<string, string | number>) => string
}

/**
 * Display helpers shared by the approvals inbox, the approvals bell and the
 * cross-window toasts, so a row reads the same everywhere.
 */

/** "Vendor payment" (singular label of the approval's kind). */
export function kindLabel(kind: ApprovalRow["kind"], tk: Fmt["tk"]): string {
  return tk(`approvals.kinds.${kind}`)
}

/** The figure the approval is about: a percent for discounts, else money (none for a bare credit override). */
export function approvalFigure(approval: ApprovalRow, fmt: Fmt): string | null {
  if (approval.kind === "discount-pct") return approval.pct !== undefined ? fmt.pct(approval.pct, 0) : null
  return approval.amountP !== undefined ? fmt.money(approval.amountP) : null
}

/** Where the approval's document opens, and the app that owns it. */
export function approvalLink(approval: ApprovalRow): { href: string | null; app: string | null } {
  return {
    href: docHref(approval.docType, approval.docId) ?? null,
    app: docApp(approval.docType) ?? null,
  }
}

/** A user's display name from a map, falling back to the id. */
export function personName(users: Map<Id, UserRow>, id: Id | undefined, locale: Locale): string {
  if (!id) return ""
  const user = users.get(id)
  if (!user) return id
  return locale === "bn" ? user.nameBn : user.nameEn
}
