"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { CircleAlert, CircleCheck, CircleX, Info, Lock, LockOpen, ListChecks } from "lucide-react"
import { toast } from "sonner"

import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type { FiscalYearRow, PeriodRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { useUserMap, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { buildCloseChecklist, closeReaderFromDb } from "../close"
import { closePeriod, reopenPeriod } from "../commands"
import { useMonthLabel, useToday } from "../queries"
import { closeAllowed, type CloseChecklistItem } from "../types"

/**
 * Periods (plan §9 `/fa/periods`): fiscal years and their months, open or
 * closed; the close checklist of accounting_rules.md §7 for the chosen
 * month with its blocking items as links; close (fa.period.close) and
 * reopen with a reason (fa.period.reopen). Live: discarding a draft or
 * deciding an approval in another window clears its line at once.
 */
export function PeriodsPage() {
  const db = useDb()
  const params = useSearchParams()
  const { t, date, dmy, time, locale } = useLocale()
  const monthLabel = useMonthLabel(date)
  const today = useToday()
  const users = useUserMap()
  const canClose = useCan("fa.period.close")
  const canReopen = useCan("fa.period.reopen")
  const data = useLiveQuery(async () => {
    const years = await db.fiscalYears.orderBy("startsOn").reverse().toArray()
    const periods = await db.periods.orderBy("startsOn").toArray()
    return { years, periods }
  }, [db])
  const [selected, setSelected] = React.useState<string | null>(params.get("id"))
  const [closing, setClosing] = React.useState<PeriodRow | null>(null)
  const [reopening, setReopening] = React.useState<PeriodRow | null>(null)

  // Default: the earliest open month that has ended (the one to close next), else the current month.
  const periods = data?.periods ?? []
  const fallback =
    periods.find((p) => p.status === "open" && p.endsOn < today) ?? periods.find((p) => p.startsOn <= today && p.endsOn >= today)
  const current = periods.find((p) => p.id === selected) ?? fallback

  return (
    <div className="flex flex-col gap-5" data-testid="fa-periods">
      <PageHeader title={t("fa.periods.title")} subtitle={t("fa.periods.subtitle")} />
      <div className="grid grid-cols-1 gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          {(data?.years ?? []).map((year: FiscalYearRow) => (
            <SectionCard
              key={year.id}
              title={t("fa.periods.fiscalYear", { code: year.code })}
              subtitle={`${dmy(year.startsOn)} - ${dmy(year.endsOn)}`}
              action={<DocStatus status={year.status} />}
              size="sm"
            >
              <ul className="flex flex-col @container">
                {periods
                  .filter((p) => p.fiscalYearId === year.id)
                  .map((p) => {
                    const ended = p.endsOn < today
                    const isCurrent = current?.id === p.id
                    return (
                      <li
                        key={p.id}
                        data-testid="period-row"
                        data-period={p.code}
                        data-month={p.month}
                        data-status={p.status}
                        className={cn(
                          "flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-2 py-2.5 last:border-b-0",
                          isCurrent && "rounded-md bg-primary-soft"
                        )}
                      >
                        <span className="flex w-40 min-w-0 flex-col">
                          <span className="font-medium">{monthLabel(p.month)}</span>
                          <span lang="en" className="font-mono text-xs text-muted-foreground">
                            {p.code}
                          </span>
                        </span>
                        <span className="hidden text-xs text-muted-foreground @[36rem]:inline">
                          {dmy(p.startsOn)} - {dmy(p.endsOn)}
                        </span>
                        <DocStatus status={p.status} />
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {p.status === "closed" && p.closedBy
                            ? `${userName(users.get(p.closedBy), locale)}${p.closedAt ? `, ${dmy(p.closedAt)} ${time(p.closedAt)}` : ""}`
                            : p.reopenReason
                              ? t("fa.periods.reopenReason", { reason: p.reopenReason })
                              : !ended
                                ? t("fa.periods.notEnded", { date: dmy(p.endsOn) })
                                : ""}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {p.status === "open" ? (
                            <Button
                              variant={isCurrent ? "secondary" : "ghost"}
                              size="xs"
                              onClick={() => setSelected(p.id)}
                              data-testid="period-checklist"
                            >
                              <ListChecks />
                              {t("fa.periods.showChecklist")}
                            </Button>
                          ) : null}
                          {p.status === "closed" && canReopen && year.status === "open" ? (
                            <Button variant="outline" size="xs" onClick={() => setReopening(p)} data-testid="period-reopen">
                              <LockOpen />
                              {t("fa.periods.reopenAction")}
                            </Button>
                          ) : p.status === "closed" ? (
                            <Lock className="size-3.5 text-muted-foreground" />
                          ) : null}
                        </span>
                      </li>
                    )
                  })}
              </ul>
            </SectionCard>
          ))}
        </div>

        {current ? (
          <Checklist
            period={current}
            ended={current.endsOn < today}
            canClose={canClose}
            onClose={() => setClosing(current)}
            label={monthLabel(current.month)}
          />
        ) : null}
      </div>

      <CloseDialog period={closing} label={closing ? monthLabel(closing.month) : ""} onDone={() => setClosing(null)} />
      <ReopenDialog period={reopening} label={reopening ? monthLabel(reopening.month) : ""} onDone={() => setReopening(null)} />
    </div>
  )
}

const ICON = {
  ok: CircleCheck,
  yes: CircleX,
  warning: CircleAlert,
  info: Info,
}

function Checklist({
  period,
  ended,
  canClose,
  onClose,
  label,
}: {
  period: PeriodRow
  ended: boolean
  canClose: boolean
  onClose: () => void
  label: string
}) {
  const db = useDb()
  const { t, tk, num, dmy } = useLocale()
  const checklist = useLiveQuery(() => buildCloseChecklist(closeReaderFromDb(db), period), [db, period])
  const allowed = checklist ? closeAllowed(checklist) : false

  return (
    <SectionCard
      title={t("fa.periods.checklistFor", { month: label })}
      subtitle={t("fa.periods.checklistHint")}
      icon={ListChecks}
      className="self-start min-[1200px]:sticky min-[1200px]:top-4"
    >
      <ol className="flex flex-col gap-2.5" data-testid="close-checklist" data-period={period.code} data-allowed={allowed ? "true" : "false"}>
        {(checklist ?? []).map((c) => (
          <CheckRow key={c.key} check={c} />
        ))}
      </ol>
      {checklist ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          {period.status === "open" ? (
            <>
              <Button onClick={onClose} disabled={!canClose || !ended} data-testid="period-close">
                <Lock />
                {t("fa.periods.closeAction")}
              </Button>
              <span className={cn("text-xs", allowed ? "text-success" : "text-muted-foreground")}>
                {!ended
                  ? t("fa.periods.notEnded", { date: dmy(period.endsOn) })
                  : allowed
                    ? t("fa.periods.allClear")
                    : t("fa.periods.itemsCount", {
                        count: num(checklist.filter((c) => c.blocking === "yes" && !c.ok).reduce((s, c) => s + (c.count ?? 0), 0)),
                      })}
              </span>
            </>
          ) : (
            <StatusText tone="muted" dot>
              {tk("shared.status.closed")}
            </StatusText>
          )}
        </div>
      ) : null}
    </SectionCard>
  )
}

function CheckRow({ check }: { check: CloseChecklistItem }) {
  const { t, tk, num, money } = useLocale()
  const tone = check.ok ? "ok" : check.blocking
  const Icon = ICON[tone]
  const color = check.ok
    ? "text-success"
    : check.blocking === "yes"
      ? "text-destructive"
      : check.blocking === "warning"
        ? "text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning"
        : "text-info"
  return (
    <li className="flex gap-3 rounded-md bg-surface-raised/50 p-3" data-testid="close-check" data-key={check.key} data-ok={check.ok ? "true" : "false"}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[0.8125rem] font-medium">{tk(`fa.periods.checks.${check.key}`)}</span>
          <span className={cn("text-[0.6875rem] font-semibold uppercase", color)}>
            {check.ok ? t("fa.periods.checkOk") : tk(`fa.periods.blocking.${check.blocking}`)}
          </span>
        </div>
        {check.key === "grni" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("fa.periods.grniBalance", { amount: money(check.amountP ?? 0) })}{" "}
            <Link href={`/fa/ledger?account=${check.items[0]?.docId ?? ""}`} className="text-link hover:underline" data-testid="drill-link">
              {t("fa.ledger.title")}
            </Link>
          </p>
        ) : null}
        {check.key === "vatReturn" && !check.ok ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("fa.periods.vatMissing")}{" "}
            <Link href="/frs/vat" className="text-link hover:underline">
              {t("fa.periods.openVat")}
            </Link>
          </p>
        ) : null}
        {check.key === "recurring" && !check.ok ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {check.items.map((i) => i.docNo).join(", ")}{" "}
            <Link href="/fa/recurring" className="text-link hover:underline">
              {t("fa.periods.postRecurring")}
            </Link>
          </p>
        ) : null}
        {check.key === "bankRecon" && !check.ok ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("fa.periods.bankMissing", { accounts: check.items.map((i) => i.docNo).join(", ") })}
          </p>
        ) : null}
        {(check.key === "journals" || check.key === "approvals") && check.items.length ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {check.items.map((i) => (
              <li key={i.docId} className="flex flex-wrap items-center gap-x-2 text-xs" data-testid="close-check-item">
                <DocLink docType={i.docType} docId={i.docId} docNo={i.docNo} />
                {i.kind ? <span className="text-muted-foreground">{tk(`approvals.kinds.${i.kind}`)}</span> : null}
                {i.amountP ? <MoneyText poisha={i.amountP} className="ml-auto font-mono" /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!check.ok && (check.key === "journals" || check.key === "approvals") ? (
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">{t("fa.periods.itemsCount", { count: num(check.count ?? 0) })}</p>
        ) : null}
      </div>
    </li>
  )
}

function CloseDialog({ period, label, onDone }: { period: PeriodRow | null; label: string; onDone: () => void }) {
  const { t } = useLocale()
  const command = useCommand(closePeriod)
  const run = async () => {
    if (!period) return
    const result = await command.run({ periodId: period.id, expectedVersion: period.version })
    onDone()
    if (result) toast.success(t("fa.periods.closed", { period: result.period }))
  }
  return (
    <Dialog open={!!period} onOpenChange={(o) => !o && onDone()}>
      <DialogContent data-testid="period-close-dialog">
        <DialogHeader>
          <DialogTitle>{t("fa.periods.closeTitle", { month: label })}</DialogTitle>
          <DialogDescription>{t("fa.periods.closeBody", { month: label })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="neutral" onClick={onDone}>
            {t("fa.common.cancel")}
          </Button>
          <Button onClick={run} disabled={command.pending} data-testid="period-close-confirm">
            <Lock />
            {t("fa.periods.closeAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReopenDialog({ period, label, onDone }: { period: PeriodRow | null; label: string; onDone: () => void }) {
  const { t } = useLocale()
  const command = useCommand(reopenPeriod)
  const [reason, setReason] = React.useState("")
  const run = async () => {
    if (!period) return
    const result = await command.run({ periodId: period.id, expectedVersion: period.version, reason: reason.trim() })
    onDone()
    setReason("")
    if (result) toast.success(t("fa.periods.reopened", { period: result.period }))
  }
  return (
    <Dialog open={!!period} onOpenChange={(o) => !o && onDone()}>
      <DialogContent data-testid="period-reopen-dialog">
        <DialogHeader>
          <DialogTitle>{t("fa.periods.reopenTitle", { month: label })}</DialogTitle>
          <DialogDescription>{t("fa.periods.reopenBody", { month: label })}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("fa.common.reasonPlaceholder")}
          data-testid="period-reopen-reason"
        />
        <DialogFooter>
          <Button variant="neutral" onClick={onDone}>
            {t("fa.common.cancel")}
          </Button>
          <Button onClick={run} disabled={command.pending || reason.trim().length < 3} data-testid="period-reopen-confirm">
            <LockOpen />
            {t("fa.periods.reopenAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
