"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Bell, CheckCheck, ChevronRight, Inbox } from "lucide-react"

import { AppChip } from "@/components/shared/app-frame"
import { EmptyState } from "@/components/shared/empty-state"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useApprovalInbox } from "@/core/approvals/useInbox"
import { DAY } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { ApprovalRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { useUserMap } from "@/core/security/users"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { approvalFigure, approvalLink, kindLabel, personName } from "./approvals/format"

const SHOWN = 5

/** Decisions on this user's own requests in the last week (demo clock), newest first. */
function useRecentDecisions(): ApprovalRow[] {
  const db = useDb()
  const { user } = usePermissions()
  const nowMs = useNow(60_000)
  return (
    useLiveQuery(async () => {
      if (!user) return []
      const mine = await db.approvals.where("requestedBy").equals(user.id).toArray()
      return mine
        .filter((a) => !a.inline && a.status !== "pending" && (a.decidedAt ?? 0) >= nowMs - 7 * DAY)
        .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
        .slice(0, 3)
    }, [db, user, nowMs]) ?? []
  )
}

/**
 * The approvals bell in the top bar (ui_guidelines.md §3): a yellow count of
 * approvals waiting for this user (live: a request in any window, or an RBAC
 * or limit change, updates it at once), and a popover with the latest ones
 * and the decisions on the user's own requests.
 */
export function ApprovalsBell({ className }: { className?: string }) {
  const { t, tk, num, money, pct, relative, locale } = useLocale()
  const inbox = useApprovalInbox()
  const decisions = useRecentDecisions()
  const users = useUserMap()
  const [open, setOpen] = React.useState(false)
  const waiting = inbox?.forMe ?? []
  const count = waiting.length
  const flash = useFlashOnChange(count)
  const label = count
    ? `${t("shell.bell.title")} (${t("shell.bell.waiting", { count: num(count) })})`
    : t("shell.bell.title")
  const fmt = { money, pct, tk }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title={label}
            data-slot="approvals-bell"
            data-testid="approvals-bell"
            data-count={count}
            className={cn(
              "relative flex size-10 shrink-0 items-center justify-center rounded-md bg-card text-foreground shadow-(--card-shadow) transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40",
              flash,
              className
            )}
          />
        }
      >
        <Bell className="size-[1.125rem]" />
        {count > 0 ? (
          <span
            key={count}
            data-testid="approvals-count"
            className="count-badge nums absolute -top-1 -right-1 flex h-4.5 min-w-4.5 animate-in items-center justify-center px-1 text-[0.6875rem] leading-none font-semibold zoom-in-50"
          >
            {count > 99 ? `${num(99)}+` : num(count)}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(24rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <span className="flex-1 text-[0.9375rem] font-semibold">{t("shell.bell.title")}</span>
          {count ? (
            <span className="count-badge nums px-2 py-0.5 text-xs font-semibold">
              {t("shell.bell.waiting", { count: num(count) })}
            </span>
          ) : null}
        </div>
        {count === 0 ? (
          <EmptyState icon={CheckCheck} title={t("shell.bell.empty")} size="sm" />
        ) : (
          <ul className="flex max-h-[min(22rem,55svh)] flex-col overflow-y-auto p-1.5">
            {waiting.slice(0, SHOWN).map((approval) => {
              const { app } = approvalLink(approval)
              const figure = approvalFigure(approval, fmt)
              return (
                <li key={approval.id}>
                  <Link
                    href={`/approvals?focus=${approval.id}`}
                    onClick={() => setOpen(false)}
                    data-testid="bell-item"
                    className="flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <span className="icon-well flex size-9 shrink-0 items-center justify-center text-warning">
                      <Inbox className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span lang="en" className="truncate font-mono text-[0.8125rem] font-semibold">
                          {approval.docNo}
                        </span>
                        {app ? <AppChip app={app} /> : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          kindLabel(approval.kind, tk),
                          figure,
                          t("shell.bell.from", { name: personName(users, approval.requestedBy, locale) }),
                          relative(approval.requestedAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
            {count > SHOWN ? (
              <li className="px-3 py-1.5 text-xs text-muted-foreground">
                {t("shell.bell.more", { count: num(count - SHOWN) })}
              </li>
            ) : null}
          </ul>
        )}
        {decisions.length ? (
          <div className="border-t border-hairline px-4 py-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("shell.bell.yourRequests")}</p>
            <ul className="flex flex-col gap-1">
              {decisions.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      a.status === "approved" ? "bg-success" : "bg-destructive"
                    )}
                  />
                  <span lang="en" className="font-mono font-semibold">
                    {a.docNo}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {t(a.status === "approved" ? "shell.bell.approvedBy" : "shell.bell.rejectedBy", {
                      name: personName(users, a.decidedBy, locale),
                    })}
                    {a.decidedAt ? ` · ${relative(a.decidedAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="border-t border-hairline p-1.5">
          <Link
            href="/approvals"
            onClick={() => setOpen(false)}
            className="flex h-9 items-center justify-center rounded-md text-[0.8125rem] font-medium text-link transition-colors outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            {t("shell.bell.openInbox")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
