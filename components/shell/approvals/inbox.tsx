"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  Banknote,
  BookOpenText,
  Check,
  CheckCheck,
  Inbox,
  PackageMinus,
  Percent,
  ReceiptText,
  Send,
  ShieldCheck,
  ShoppingCart,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AppChip } from "@/components/shared/app-frame"
import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { decideApproval } from "@/core/approvals/decide"
import { useApprovalInbox } from "@/core/approvals/useInbox"
import type { ApprovalRow, Id, UserRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import type { ApprovalKind } from "@/core/security/types"
import { nameOf, useLocations, useUserMap } from "@/core/security/users"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { approvalFigure, approvalLink, kindLabel, personName } from "./format"

const KIND_ICON: Record<ApprovalKind, LucideIcon> = {
  "discount-pct": Percent,
  journal: BookOpenText,
  payment: Banknote,
  purchase: ShoppingCart,
  "credit-note": ReceiptText,
  "stock-adjust": PackageMinus,
  "petty-cash": Wallet,
  "credit-override": ShieldCheck,
}

type Group = "forMe" | "requested" | "decided"
type Decision = { approval: ApprovalRow; decision: "approve" | "reject" }

/**
 * Ids that appeared after the first render (a request from another window),
 * so their rows flash turquoise for about 1.2 s (ui_guidelines.md §5).
 */
function useArrivals(ids: string[] | undefined): ReadonlySet<string> {
  const known = React.useRef<Set<string> | null>(null)
  const [fresh, setFresh] = React.useState<ReadonlySet<string>>(() => new Set())
  const key = ids?.join(",")
  React.useEffect(() => {
    if (ids === undefined) return
    if (known.current === null) {
      known.current = new Set(ids)
      return
    }
    const seen = known.current
    const arrived = ids.filter((id) => !seen.has(id))
    arrived.forEach((id) => seen.add(id))
    if (!arrived.length) return
    const show = window.setTimeout(() => setFresh(new Set(arrived)), 0)
    const hide = window.setTimeout(() => setFresh(new Set()), 1200)
    return () => {
      window.clearTimeout(show)
      window.clearTimeout(hide)
    }
    // `key` stands for the id list's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return fresh
}

/**
 * The approvals inbox (plan §3.7, §9 `/approvals`): what waits for me, what I
 * requested, what I decided. Live in every window: a request, a decision or
 * an RBAC change anywhere updates it at once. Deciding runs
 * `approvals.decide` with the row's version, so a stale decision shows the
 * conflict dialog; the engine refuses self-approval and decisions above the
 * decider's limit.
 */
export function ApprovalsInbox() {
  const { t, num } = useLocale()
  const inbox = useApprovalInbox()
  const users = useUserMap()
  const params = useSearchParams()
  const focus = params.get("focus")
  const [deciding, setDeciding] = React.useState<Decision | null>(null)
  const allIds = inbox
    ? [...inbox.forMe, ...inbox.requestedByMe, ...inbox.decidedByMe].map((a) => `${a.id}:${a.status}`)
    : undefined
  const arrivals = useArrivals(allIds)

  const groups: { id: Group; title: string; hint: string; rows: ApprovalRow[]; empty: string; icon: LucideIcon }[] = [
    {
      id: "forMe",
      title: t("approvals.inbox.groups.forMe"),
      hint: t("approvals.inbox.hints.forMe"),
      rows: inbox?.forMe ?? [],
      empty: t("approvals.inbox.empty.forMe"),
      icon: Inbox,
    },
    {
      id: "requested",
      title: t("approvals.inbox.groups.requested"),
      hint: t("approvals.inbox.hints.requested"),
      rows: inbox?.requestedByMe ?? [],
      empty: t("approvals.inbox.empty.requested"),
      icon: Send,
    },
    {
      id: "decided",
      title: t("approvals.inbox.groups.decided"),
      hint: t("approvals.inbox.hints.decided"),
      rows: inbox?.decidedByMe ?? [],
      empty: t("approvals.inbox.empty.decided"),
      icon: CheckCheck,
    },
  ]

  return (
    <div className="flex flex-col gap-5" data-testid="approvals-inbox">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.375rem] font-semibold">{t("approvals.inbox.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("approvals.inbox.subtitle")}</p>
        </div>
      </div>

      {groups.map((group) => (
        <section
          key={group.id}
          className="surface-card flex flex-col overflow-hidden"
          data-testid={`approvals-group-${group.id}`}
          aria-labelledby={`approvals-${group.id}`}
        >
          <header className="flex items-center gap-3 px-4 pt-4 pb-3 sm:px-6">
            <span className="icon-well flex size-9 shrink-0 items-center justify-center text-primary">
              <group.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={`approvals-${group.id}`} className="text-[1.0625rem] font-semibold">
                {group.title}
              </h2>
              <p className="truncate text-xs text-muted-foreground">{group.hint}</p>
            </div>
            <span
              className={cn(
                "nums rounded-full px-2.5 py-0.5 text-xs font-semibold",
                group.id === "forMe" && group.rows.length ? "count-badge" : "bg-surface-raised text-muted-foreground"
              )}
              data-testid={`approvals-group-count-${group.id}`}
            >
              {num(group.rows.length)}
            </span>
          </header>
          {inbox === undefined ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : group.rows.length === 0 ? (
            <EmptyState icon={group.icon} title={group.empty} size="sm" className="pt-2" />
          ) : (
            <ul className="flex flex-col border-t border-hairline">
              {group.rows.map((approval) => (
                <ApprovalItem
                  key={approval.id}
                  approval={approval}
                  group={group.id}
                  users={users}
                  focused={focus === approval.id}
                  fresh={arrivals.has(`${approval.id}:${approval.status}`)}
                  onDecide={(decision) => setDeciding({ approval, decision })}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      <DecideDialog
        decision={deciding}
        users={users}
        onClose={() => setDeciding(null)}
      />
    </div>
  )
}

function ApprovalItem({
  approval,
  group,
  users,
  focused,
  fresh,
  onDecide,
}: {
  approval: ApprovalRow
  group: Group
  users: Map<Id, UserRow>
  focused: boolean
  fresh: boolean
  onDecide: (decision: "approve" | "reject") => void
}) {
  const { t, tk, money, pct, relative, locale } = useLocale()
  const locations = useLocations()
  const flash = useFlashOnChange(approval.version)
  const ref = React.useRef<HTMLLIElement>(null)
  const { href, app } = approvalLink(approval)
  const figure = approvalFigure(approval, { money, pct, tk })
  const location = locations?.find((l) => l.id === approval.locationId)
  const Icon = KIND_ICON[approval.kind] ?? Inbox

  React.useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" })
  }, [focused])

  const routed = approval.routedTo
    .map((id) => personName(users, id, locale))
    .filter(Boolean)
    .slice(0, 3)
    .join(", ")
  const meta =
    group === "decided"
      ? [
          t("approvals.inbox.requestedBy", { name: personName(users, approval.requestedBy, locale) }),
          location ? location.code : null,
          approval.decidedAt ? t("approvals.inbox.decidedAt", { time: relative(approval.decidedAt) }) : null,
        ]
      : [
          group === "forMe"
            ? t("approvals.inbox.requestedBy", { name: personName(users, approval.requestedBy, locale) })
            : routed
              ? t("approvals.inbox.routedTo", { names: routed })
              : t("approvals.inbox.noApprover"),
          location ? nameOf(location, locale) : t("approvals.inbox.allLocations"),
          relative(approval.requestedAt),
        ]
  const reason = group === "decided" ? approval.decisionReason || approval.reason : approval.reason

  return (
    <li
      ref={ref}
      data-testid="approval-row"
      data-approval-id={approval.id}
      data-status={approval.status}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-4 py-3 last:border-b-0 sm:px-6",
        (fresh || focused) && "flash-sync",
        flash
      )}
    >
      <span className="icon-well flex size-9 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-[14rem]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {href ? (
            <Link
              href={href}
              lang="en"
              className="truncate font-mono text-[0.875rem] font-semibold text-link underline-offset-4 hover:underline"
              data-testid="approval-doc"
            >
              {approval.docNo}
            </Link>
          ) : (
            <span lang="en" className="truncate font-mono text-[0.875rem] font-semibold">
              {approval.docNo}
            </span>
          )}
          {app ? <AppChip app={app} /> : null}
          <span className="text-xs text-muted-foreground">{kindLabel(approval.kind, tk)}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{meta.filter(Boolean).join(" · ")}</p>
        {reason ? (
          <p className="truncate text-xs text-foreground/80" title={reason}>
            {t("approvals.inbox.reason", { reason })}
          </p>
        ) : null}
      </div>
      {figure ? (
        <span className="nums shrink-0 text-right font-mono text-[0.9375rem] font-semibold" data-testid="approval-figure">
          {figure}
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-2">
        {group === "forMe" ? (
          <>
            <Button size="sm" onClick={() => onDecide("approve")} data-testid="approval-approve">
              <Check />
              {t("common.approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDecide("reject")}
              data-testid="approval-reject"
            >
              <X />
              {t("common.reject")}
            </Button>
          </>
        ) : group === "requested" ? (
          <span
            className="rounded-full bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] px-2.5 py-1 text-xs font-medium text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning"
            data-testid="approval-you-requested"
          >
            {t("common.approval.youRequested")}
          </span>
        ) : (
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold",
              approval.status === "approved" ? "text-success" : "text-destructive"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                approval.status === "approved" ? "bg-success" : "bg-destructive"
              )}
            />
            {approval.status === "approved" ? t("common.statuses.approved") : t("common.statuses.rejected")}
          </span>
        )}
      </div>
    </li>
  )
}

function DecideDialog({
  decision,
  users,
  onClose,
}: {
  decision: Decision | null
  users: Map<Id, UserRow>
  onClose: () => void
}) {
  return (
    <Dialog open={!!decision} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="approval-dialog">
        {decision ? <DecideForm decision={decision} users={users} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function DecideForm({
  decision,
  users,
  onClose,
}: {
  decision: Decision
  users: Map<Id, UserRow>
  onClose: () => void
}) {
  const { t, tk, money, pct, locale } = useLocale()
  const command = useCommand(decideApproval)
  const [reason, setReason] = React.useState("")
  const { approval } = decision
  const approve = decision.decision === "approve"
  const figure = approvalFigure(approval, { money, pct, tk })
  const needsReason = !approve && !reason.trim()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (needsReason) return
    const result = await command.run({
      approvalId: approval.id,
      decision: decision.decision,
      reason: reason.trim(),
      expectedVersion: approval.version,
    })
    onClose()
    if (result) {
      toast.success(
        t(approve ? "approvals.inbox.approvedToast" : "approvals.inbox.rejectedToast", { docNo: approval.docNo })
      )
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {t(approve ? "approvals.inbox.approveTitle" : "approvals.inbox.rejectTitle", { docNo: approval.docNo })}
        </DialogTitle>
        <DialogDescription>
          {[
            kindLabel(approval.kind, tk),
            figure,
            t("approvals.inbox.requestedBy", { name: personName(users, approval.requestedBy, locale) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </DialogDescription>
      </DialogHeader>
      {approval.reason ? (
        <p className="rounded-md bg-surface-raised px-3 py-2 text-sm">
          {t("approvals.inbox.reason", { reason: approval.reason })}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="decision-reason">
          {approve ? t("approvals.inbox.reasonOptional") : t("approvals.inbox.reasonRequired")}
        </Label>
        <Textarea
          id="decision-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("common.approval.reasonPlaceholder")}
          rows={3}
          data-testid="approval-reason"
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          variant={approve ? "default" : "destructive"}
          disabled={command.pending || needsReason}
          data-testid="approval-confirm"
        >
          {approve ? <Check /> : <X />}
          {approve ? t("common.approve") : t("common.reject")}
        </Button>
      </DialogFooter>
    </form>
  )
}
