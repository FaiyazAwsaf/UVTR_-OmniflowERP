"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarClock, ChevronDown, ChevronRight, Repeat } from "lucide-react"
import { toast } from "sonner"

import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { closeReaderFromDb, recurringStatus } from "../close"
import { runRecurring } from "../commands"
import { useMonthLabel, usePeriods, useToday } from "../queries"
import { PeriodSelect } from "./common"
import { DraftLines } from "./draft-lines"

const freshKey = () =>
  `fa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Recurring journals (plan §9 `/fa/recurring`): the monthly templates
 * (depreciation, salary accrual, prepaid amortisation) and "post for
 * period": every due template posts once for the chosen open month (R25),
 * dated its last day, without a further approval.
 */
export function RecurringPage() {
  const db = useDb()
  const params = useSearchParams()
  const { t, tk, date, dmy, num, locale, narration } = useLocale()
  const monthLabel = useMonthLabel(date)
  const today = useToday()
  const periods = usePeriods()
  const canRun = useCan("fa.recurring.run")
  const command = useCommand(runRecurring)
  const open = (periods ?? []).filter((p) => p.status === "open")
  const [month, setMonth] = React.useState("")
  const [expanded, setExpanded] = React.useState<string | null>(
    params.get("id")
  )
  const period =
    open.find((p) => p.month === month) ??
    open.find((p) => p.startsOn <= today && p.endsOn >= today) ??
    open[open.length - 1]

  const data = useLiveQuery(async () => {
    const templates = (await db.recurringJournals.toArray()).sort((a, b) =>
      a.code.localeCompare(b.code)
    )
    const reader = closeReaderFromDb(db)
    const status = period
      ? await Promise.all(
          templates.map(async (tpl) => ({
            id: tpl.id,
            ...(await recurringStatus(reader, period, tpl)),
          }))
        )
      : []
    const history = (await db.journals.where("rule").equals("R25").toArray())
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || a.journalNo.localeCompare(b.journalNo)
      )
      .slice(0, 24)
    const lastPosted = new Map(
      (await db.periods.toArray()).map((p) => [p.id, p])
    )
    return {
      templates,
      status: new Map(status.map((s) => [s.id, s])),
      history,
      lastPosted,
    }
  }, [db, period?.id])

  const due = period
    ? (data?.templates ?? []).filter((tpl) => data?.status.get(tpl.id)?.due)
    : []

  const post = async () => {
    if (!period) return
    const result = await command.run({
      periodId: period.id,
      idempotencyKey: freshKey(),
    })
    if (result)
      toast.success(
        t("fa.recurring.posted", {
          count: num(result.posted.length),
          period: result.period,
        })
      )
  }

  return (
    <div className="flex flex-col gap-5" data-testid="fa-recurring">
      <PageHeader
        title={t("fa.recurring.title")}
        subtitle={t("fa.recurring.subtitle")}
      />

      <SectionCard
        title={
          period
            ? t("fa.recurring.postTitle", { month: monthLabel(period.month) })
            : t("fa.recurring.postFor")
        }
        subtitle={
          period
            ? t("fa.recurring.postBody", { date: dmy(period.endsOn) })
            : t("fa.recurring.noOpenPeriods")
        }
        icon={CalendarClock}
        action={
          <PeriodSelect
            periods={open}
            value={period?.month ?? ""}
            onChange={setMonth}
            testId="recurring-period"
          />
        }
      >
        <ul className="@container flex flex-col">
          {(data?.templates ?? []).map((tpl) => {
            const s = data?.status.get(tpl.id)
            return (
              <li
                key={tpl.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline py-2 last:border-b-0"
                data-testid="recurring-status"
                data-code={tpl.code}
              >
                <span
                  lang="en"
                  className="w-20 font-mono text-xs text-muted-foreground"
                >
                  {tpl.code}
                </span>
                <span className="min-w-0 flex-1">{nameOf(tpl, locale)}</span>
                {s?.posted ? (
                  <span className="flex items-center gap-2 text-xs">
                    <StatusText tone="success" dot>
                      {t("fa.recurring.postedStatus")}
                    </StatusText>
                    <DocLink
                      docType="journals"
                      docId={s.posted.id}
                      docNo={s.posted.journalNo}
                      showApp={false}
                    />
                  </span>
                ) : s?.due ? (
                  <StatusText tone="warning" dot>
                    {t("fa.recurring.due")}
                  </StatusText>
                ) : (
                  <StatusText tone="muted" dot>
                    {t("fa.recurring.notDue")}
                  </StatusText>
                )}
              </li>
            )
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            onClick={post}
            disabled={!canRun || !period || !due.length || command.pending}
            data-testid="recurring-post"
          >
            <Repeat />
            {t("fa.recurring.postAction", { count: num(due.length) })}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title={t("fa.recurring.template")} size="sm">
        <ul className="flex flex-col">
          {(data?.templates ?? []).map((tpl) => {
            const total = tpl.lines.reduce((s, l) => s + l.debitP, 0)
            const last = tpl.lastPostedPeriodId
              ? data?.lastPosted.get(tpl.lastPostedPeriodId)
              : undefined
            const isOpen = expanded === tpl.id
            return (
              <li
                key={tpl.id}
                className={cn(
                  "border-b border-hairline last:border-b-0",
                  isOpen && "pb-3"
                )}
                data-testid="recurring-template"
              >
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-left hover:text-link"
                  onClick={() => setExpanded(isOpen ? null : tpl.id)}
                >
                  {isOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                  <span
                    lang="en"
                    className="w-20 font-mono text-xs text-muted-foreground"
                  >
                    {tpl.code}
                  </span>
                  <span className="min-w-0 flex-1 font-medium">
                    {nameOf(tpl, locale)}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {tk(`fa.recurring.kinds.${tpl.kind}`)}
                  </span>
                  <MoneyText poisha={total} className="font-mono" />
                  <span className="w-36 text-right text-xs text-muted-foreground">
                    {last ? monthLabel(last.month) : t("fa.recurring.never")}
                  </span>
                  <DocStatus status={tpl.active ? "active" : "inactive"} />
                </button>
                {isOpen ? <DraftLines lines={tpl.lines} /> : null}
              </li>
            )
          })}
        </ul>
      </SectionCard>

      <SectionCard title={t("fa.recurring.history")} size="sm">
        <ul className="flex flex-col">
          {(data?.history ?? []).map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline py-2 text-[0.8125rem] last:border-b-0"
            >
              <DocLink
                docType="journals"
                docId={j.id}
                docNo={j.journalNo}
                showApp={false}
              />
              <span className="nums text-muted-foreground">{dmy(j.date)}</span>
              <span className="min-w-0 flex-1 truncate">
                {narration(j.narration)}
              </span>
              <MoneyText poisha={j.totalP} className="font-mono" />
              <DocStatus status={j.status} />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}
