"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { BookCheck, FilePen, FileStack, Hourglass, Plus, Scale } from "lucide-react"

import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { JournalRow } from "@/core/db/schema"
import { trialBalance } from "@/core/ledger/statements"
import { useCan } from "@/core/security/useCan"
import { useUserMap, userName } from "@/core/security/users"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { useMonthLabel, useToday } from "../queries"
import { BalanceCheck } from "./common"

/**
 * Accounting home (plan §9 `/fa`): the KPI row (vouchers posted this month,
 * awaiting approval, drafts, the trial balance check), period status,
 * vouchers waiting for approval, drafts, and the latest postings from
 * every app with their source documents. Live in every window.
 */
export function FaHome() {
  const db = useDb()
  const { t, num, date, money, locale } = useLocale()
  const monthLabel = useMonthLabel(date)
  const today = useToday()
  const users = useUserMap()
  const canCreate = useCan("fa.journal.create")
  const month = today.slice(0, 7)

  const data = useLiveQuery(async () => {
    if (today < "2000") return null
    const period = await db.periods.where("month").equals(month).first()
    const monthJournals = period ? await db.journals.where("periodId").equals(period.id).toArray() : []
    const pending = await db.journals.where("status").equals("pending-approval").toArray()
    const drafts = await db.journals.where("status").equals("draft").toArray()
    const recent = await db.journals.orderBy("date").reverse().limit(40).toArray()
    const accounts = await db.accounts.toArray()
    const lines = await db.journalLines.where("date").belowOrEqual(today).toArray()
    const tb = trialBalance(accounts, lines, { from: `${month}-01`, to: today })
    const periods = (await db.periods.orderBy("startsOn").toArray()).filter((p) => p.startsOn <= today).slice(-2).reverse()
    return {
      postedThisMonth: monthJournals.filter((j) => j.status === "posted" || j.status === "reversed"),
      pending: pending.sort((a, b) => b.updatedAt - a.updatedAt),
      drafts: drafts.sort((a, b) => b.updatedAt - a.updatedAt),
      recent: recent
        .filter((j) => j.status === "posted" || j.status === "reversed")
        .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
        .slice(0, 12),
      tb,
      accountsCount: tb.rows.filter((r) => r.openingP || r.debitP || r.creditP).length,
      periods,
    }
  }, [db, today, month])

  const flash = useFlashOnChange(data?.tb.totalDebitP)
  const postedToday = data?.postedThisMonth.filter((j) => j.date === today).length ?? 0
  const tbBalanced = data ? data.tb.balanced : true

  return (
    <div className="flex flex-col gap-5" data-testid="fa-home">
      <PageHeader
        title={t("fa.home.title")}
        subtitle={t("fa.home.subtitle")}
        actions={
          canCreate ? (
            <Button nativeButton={false} render={<Link href="/fa/journals/new" />} data-testid="fa-new-voucher">
              <Plus />
              {t("fa.home.newVoucher")}
            </Button>
          ) : null
        }
      />

      <KpiGrid>
        <KpiCard
          variant="cyan"
          icon={BookCheck}
          title={t("fa.home.kpiPosted")}
          value={num(data?.postedThisMonth.length ?? 0)}
          caption={t("fa.home.kpiPostedCaption", { count: num(postedToday) })}
          href="/fa/journals"
        />
        <KpiCard
          variant="yellow"
          icon={Hourglass}
          title={t("fa.home.kpiPending")}
          value={num(data?.pending.length ?? 0)}
          caption={t("fa.home.kpiPendingCaption")}
          href="/fa/journals?status=pending-approval"
        />
        <KpiCard
          variant="pink"
          icon={FilePen}
          title={t("fa.home.kpiDrafts")}
          value={num(data?.drafts.length ?? 0)}
          caption={t("fa.home.kpiDraftsCaption")}
          href="/fa/journals?status=draft"
        />
        <KpiCard
          variant="purple"
          icon={Scale}
          title={t("fa.home.kpiTb")}
          value={tbBalanced ? `${t("fa.home.tbBalanced")} ✓` : t("fa.home.tbOff")}
          caption={t("fa.home.kpiTbCaption", { amount: money(data?.tb.totalDebitP ?? 0) })}
          href="/frs/trial-balance"
          className={flash}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard title={t("fa.home.pendingTitle")} seeAllHref="/fa/journals?status=pending-approval" icon={Hourglass}>
            {data && data.pending.length ? (
              <JournalList rows={data.pending.slice(0, 6)} testId="fa-home-pending" />
            ) : (
              <EmptyState icon={Hourglass} title={t("fa.home.pendingEmpty")} size="sm" />
            )}
          </SectionCard>
          <SectionCard title={t("fa.home.draftsTitle")} seeAllHref="/fa/journals?status=draft" icon={FilePen}>
            {data && data.drafts.length ? (
              <JournalList rows={data.drafts.slice(0, 6)} testId="fa-home-drafts" />
            ) : (
              <EmptyState icon={FilePen} title={t("fa.home.draftsEmpty")} size="sm" />
            )}
          </SectionCard>
          <SectionCard title={t("fa.home.recentTitle")} subtitle={t("fa.home.recentHint")} seeAllHref="/fa/journals" icon={FileStack}>
            <ul className="flex flex-col @container" data-testid="fa-home-recent">
              {(data?.recent ?? []).map((j) => (
                <RecentRow key={j.id} journal={j} />
              ))}
            </ul>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-5">
          <SectionCard title={t("fa.home.tbTitle")} icon={Scale} seeAllHref="/frs/trial-balance" seeAllLabel={t("fa.home.openTb")} size="sm">
            <div className={cn("flex flex-col gap-2 rounded-md", flash)}>
              <BalanceCheck
                debitP={data?.tb.totalDebitP ?? 0}
                creditP={data?.tb.totalCreditP ?? 0}
                balanced={tbBalanced}
                testId="tb-balanced"
                className="text-lg"
              />
              <p className="text-xs text-muted-foreground">
                {t("fa.home.tbDetail", {
                  debit: money(data?.tb.totalDebitP ?? 0),
                  credit: money(data?.tb.totalCreditP ?? 0),
                  count: num(data?.accountsCount ?? 0),
                })}
              </p>
            </div>
          </SectionCard>
          <SectionCard title={t("fa.home.periodsTitle")} subtitle={t("fa.home.periodsHint")} seeAllHref="/fa/periods" seeAllLabel={t("fa.home.closeLink")} size="sm">
            <ul className="flex flex-col" data-testid="fa-home-periods">
              {(data?.periods ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
                  <span className="flex flex-col">
                    <span className="font-medium">{monthLabel(p.month)}</span>
                    <span lang="en" className="font-mono text-xs text-muted-foreground">
                      {p.code}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <DocStatus status={p.status} />
                    {p.closedBy ? <span className="text-[0.6875rem] text-muted-foreground">{userName(users.get(p.closedBy), locale)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

function JournalList({ rows, testId }: { rows: JournalRow[]; testId: string }) {
  const { dmy, locale } = useLocale()
  const users = useUserMap()
  return (
    <ul className="flex flex-col" data-testid={testId}>
      {rows.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline py-2 text-[0.8125rem] last:border-b-0">
          <Link
            href={`/fa/journals/${j.id}`}
            lang="en"
            className="font-mono font-medium text-link hover:underline"
            data-testid="journal-row"
            data-journal-no={j.journalNo}
          >
            {j.journalNo}
          </Link>
          <span className="nums text-muted-foreground">{dmy(j.date)}</span>
          <span className="min-w-0 flex-1 truncate">{j.narration}</span>
          <span className="text-xs text-muted-foreground">{userName(users.get(j.preparedBy), locale)}</span>
          <MoneyText poisha={j.totalP} className="font-mono" />
          <DocStatus status={j.status} />
        </li>
      ))}
    </ul>
  )
}

function RecentRow({ journal: j }: { journal: JournalRow }) {
  const { t, tk, dmy } = useLocale()
  const flash = useFlashOnChange(j.version)
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline py-2 text-[0.8125rem] last:border-b-0", flash)}>
      <DocLink docType="journals" docId={j.id} docNo={j.journalNo} showApp={false} />
      <span className="hidden text-xs text-muted-foreground @[36rem]:inline">{tk(`fa.voucherTypes.${j.voucherType}`)}</span>
      <span className="nums text-muted-foreground">{dmy(j.date)}</span>
      <span className="min-w-0 flex-1 truncate">
        {j.source && j.source.docType !== "journals" ? (
          <span data-testid="drill-link">
            <DocLink docType={j.source.docType} docId={j.source.docId} docNo={j.source.docNo} />
          </span>
        ) : (
          <span className="text-muted-foreground">{t("fa.common.manual")}</span>
        )}
      </span>
      <MoneyText poisha={j.totalP} className="font-mono" />
    </li>
  )
}
