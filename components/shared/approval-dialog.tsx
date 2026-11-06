"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, KeyRound, ShieldCheck } from "lucide-react"

import { UserAvatar } from "@/components/shared/avatars"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { rules } from "@/config/rules.config"
import { approvalAmount, approveKeyFor, canDecide, type InlineApproval } from "@/core/approvals/approvals"
import { useDb } from "@/core/db/DbProvider"
import type { Id, Poisha, UserRow } from "@/core/db/schema"
import { resolveSecurity } from "@/core/security/resolve"
import type { ApprovalKind } from "@/core/security/types"
import { useSession } from "@/core/session/session"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

export type InlineApprovalRequest = {
  kind: ApprovalKind
  /** The document's table (picks the approve key, e.g. purchase → ptl.po.approve) */
  docType: string
  locationId?: Id | null
  amountP?: Poisha
  pct?: number
  /** What is being approved, shown in the dialog (amount, party, line) */
  description?: React.ReactNode
}

/**
 * Users who could approve this inline right now (live): active, holding the
 * kind's approve key with scope over the location and a covering limit,
 * never the requester (plan §3.7).
 */
function useEligibleApprovers(req: InlineApprovalRequest | null): UserRow[] | undefined {
  const db = useDb()
  const { userId } = useSession()
  return useLiveQuery(async () => {
    if (!req) return []
    const approval = {
      approveKey: approveKeyFor(req.kind, req.docType),
      locationId: req.locationId ?? undefined,
      kind: req.kind,
      amountP: req.amountP,
      pct: req.pct,
    }
    const users = await db.users.where("status").equals("active").toArray()
    const out: UserRow[] = []
    for (const user of users) {
      if (user.id === userId) continue
      const security = await resolveSecurity(db, user.id)
      if (canDecide(security, user.locationIds, approval)) out.push(user)
    }
    return out
  }, [db, userId, req?.kind, req?.docType, req?.locationId, req?.amountP, req?.pct])
}

/**
 * The inline approval dialog (MedCore's supervisor override, adapted): pick
 * an eligible approver, who types their PIN on this device (simulated,
 * rules.supervisorPin) and a reason. Resolves with `{ approverId, pin,
 * reason }` for the command's `inline` input; the COMMAND re-checks
 * everything (key, limit, scope, PIN, never self) in its commit.
 */
export function InlineApprovalDialog({
  request,
  onResolve,
}: {
  /** Open while non-null */
  request: InlineApprovalRequest | null
  onResolve: (approval: InlineApproval | null) => void
}) {
  const { t, tk, locale, money, num } = useLocale()
  const approvers = useEligibleApprovers(request)
  const [approverId, setApproverId] = React.useState<Id | null>(null)
  const [pin, setPin] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [wrongPin, setWrongPin] = React.useState(false)
  const selected = approvers?.find((u) => u.id === approverId) ?? approvers?.[0]
  const reset = () => {
    setApproverId(null)
    setPin("")
    setReason("")
    setWrongPin(false)
  }
  const amount = request
    ? request.kind === "discount-pct"
      ? `${num(request.pct ?? 0)}%`
      : request.kind === "credit-override"
        ? ""
        : money(request.amountP ?? 0)
    : ""
  const canApprove = !!selected && pin.length === 4 && reason.trim().length > 0

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected || !canApprove) return
    if (pin !== rules.supervisorPin) {
      setWrongPin(true)
      setPin("")
      return
    }
    onResolve({ approverId: selected.id, pin, reason: reason.trim() })
    reset()
  }

  return (
    <Dialog
      open={!!request}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onResolve(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="inline-approval">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="icon-well flex size-10 shrink-0 items-center justify-center text-link">
                <ShieldCheck className="size-5" />
              </span>
              <DialogTitle>{t("common.approval.title")}</DialogTitle>
            </div>
            <DialogDescription>
              {request
                ? t("common.approval.body", {
                    kind: tk(`common.approval.kinds.${request.kind}`),
                    amount: amount || "",
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          {request?.description ? (
            <div className="-mt-1 rounded-md bg-surface-raised px-3 py-2 text-[0.8125rem]">{request.description}</div>
          ) : null}
          {approvers && approvers.length === 0 ? (
            <p className="rounded-md bg-surface-raised px-4 py-3 text-[0.8125rem] text-muted-foreground">
              {t("common.approval.noApprover")}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t("shared.approval.eligible")}</Label>
                <div role="radiogroup" aria-label={t("common.approval.approver")} className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {(approvers ?? []).map((user) => {
                    const active = user.id === selected?.id
                    return (
                      <button
                        key={user.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-testid="approver-option"
                        data-user={user.username}
                        onClick={() => {
                          setApproverId(user.id)
                          setWrongPin(false)
                        }}
                        className={cn(
                          "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                          active ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-raised"
                        )}
                      >
                        <UserAvatar user={user} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{userName(user, locale)}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {nameOf({ nameEn: user.designationEn, nameBn: user.designationBn }, locale)}
                          </span>
                        </span>
                        {active ? <Check className="size-4 text-primary" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="approval-reason">{t("common.approval.reason")}</Label>
                <Textarea
                  id="approval-reason"
                  data-testid="approval-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("common.approval.reasonPlaceholder")}
                  className="min-h-16"
                />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="approval-pin">{t("common.approval.pin")}</Label>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t("common.approval.pinHint", { pin: rules.supervisorPin })}
                    <SimulatedBadge />
                  </span>
                </div>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="approval-pin"
                    data-testid="approval-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={4}
                    value={pin}
                    aria-invalid={wrongPin}
                    placeholder={t("shared.approval.pinPlaceholder")}
                    onChange={(event) => {
                      setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                      setWrongPin(false)
                    }}
                    className="pl-9 font-mono tracking-[0.5em]"
                  />
                </div>
                {wrongPin ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {t("common.approval.wrongPin")}
                  </p>
                ) : null}
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onResolve(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canApprove} data-testid="approval-submit">
              {t("common.approval.approve")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Ask for an inline approval from a command handler (plan §3.7):
 *
 *   const { requestApproval, dialog } = useInlineApproval()
 *   const inline = await requestApproval({ kind: "discount-pct", docType: "quotations", pct: 12, locationId })
 *   if (inline) await save.run({ ...input, inline })
 *   ...
 *   return <>{dialog}...</>
 */
export function useInlineApproval() {
  const [request, setRequest] = React.useState<InlineApprovalRequest | null>(null)
  const resolver = React.useRef<((value: InlineApproval | null) => void) | null>(null)
  const requestApproval = React.useCallback(
    (req: InlineApprovalRequest) =>
      new Promise<InlineApproval | null>((resolve) => {
        resolver.current = resolve
        setRequest(req)
      }),
    []
  )
  const dialog = (
    <InlineApprovalDialog
      request={request}
      onResolve={(value) => {
        resolver.current?.(value)
        resolver.current = null
        setRequest(null)
      }}
    />
  )
  return { requestApproval, dialog, approvalAmount }
}
