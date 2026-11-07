"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowRight,
  CalendarClock,
  ChartColumn,
  FileSpreadsheet,
  Landmark,
  Receipt,
  Scale,
  TrendingUp,
  Wallet,
  Waves,
  type LucideIcon,
} from "lucide-react"

import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { fiscalYearBounds } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { AccountTag } from "@/core/db/schema"
import { balanceSheet, cashFlow, profitAndLoss, trialBalance } from "@/core/ledger/statements"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { BalanceCheck } from "@/modules/fa/components/common"
import { useLiveFlash, useMonthLabel, useToday } from "@/modules/fa/queries"

import { loadBooks, loadVatMonth } from "../queries"
import { depositDue, dueDateOf, type TaxKind } from "../vat"

const CASH_TAGS: AccountTag[] = [
  "CASH_TILL_GUL",
  "CASH_TILL_UTT",
  "PETTY_HQ",
  "PETTY_GUL",
  "PETTY_UTT",
  "BANK_MAIN",
  "BANK_COLLECTION",
  "MFS_BKASH",
  "MFS_NAGAD",
  "CARD_CLEARING",
]

/**
 * Reporting home (plan §9 `/frs`): the KPI row (net revenue and profit this
 * month, cash and bank, VAT payable), tiles for every statement with its
 * check, and the tax calendar: last month's VAT return and the VAT, VDS and
 * AIT deposits due on the 15th.
 */
export function FrsHome() {
  const db = useDb()
  const { t, tk, date, dmy, money, pct } = useLocale()
  const monthLabel = useMonthLabel(date)
  const today = useToday()
  const ready = today > "2000"
  const month = today.slice(0, 7)
  const lastMonth = ready ? addDaysISO(`${month}-01`, -1).slice(0, 7) : ""

  const data = useLiveQuery(async () => {
    if (!ready) return null
    const books = await loadBooks(db, today)
    const fy = fiscalYearBounds(today).startsOn
    const pl = profitAndLoss(books.accounts, books.lines, { from: `${month}-01`, to: today })
    const tb = trialBalance(books.accounts, books.lines, { from: `${month}-01`, to: today })
    const bs = balanceSheet(books.accounts, books.lines, { asOf: today, fiscalYearStart: fy })
    const cf = cashFlow(books.accounts, books.lines, { from: `${month}-01`, to: today })
    const cashIds = new Set(CASH_TAGS.map((tag) => books.map[tag]))
    let cash = 0
    let vatPayable = 0
    for (const l of books.lines) {
      if (cashIds.has(l.accountId)) cash += l.debitP - l.creditP
      if (l.accountId === books.map.VAT_OUTPUT) vatPayable += l.creditP - l.debitP
    }
    const [figures, vatReturn, deposits] = await Promise.all([
      loadVatMonth(db, lastMonth),
      db.vatReturns.where("month").equals(lastMonth).first(),
      db.taxDeposits.where("forMonth").equals(lastMonth).toArray(),
    ])
    return { pl, tb, bs, cf, cash, vatPayable, figures, vatReturn, deposits }
  }, [db, today, month, lastMonth, ready])

  const flash = useLiveFlash(data?.tb.totalDebitP)
  const margin = data && data.pl.netRevenueP ? (data.pl.profitBeforeTaxP / data.pl.netRevenueP) * 100 : 0
  const due = lastMonth ? dueDateOf(lastMonth) : ""
  const overdue = !!due && today > due

  const tiles: { href: string; icon: LucideIcon; title: string; body: string; check?: React.ReactNode; testId: string }[] = [
    {
      href: "/frs/trial-balance",
      icon: Scale,
      title: t("frs.home.tbTile"),
      body: t("frs.home.tbTileBody", { amount: money(data?.tb.totalDebitP ?? 0) }),
      check: data ? <BalanceCheck debitP={data.tb.totalDebitP} creditP={data.tb.totalCreditP} balanced={data.tb.balanced} testId="tb-balanced" /> : null,
      testId: "frs-tile-tb",
    },
    { href: "/frs/profit-loss", icon: TrendingUp, title: t("frs.home.plTile"), body: t("frs.home.plTileBody"), testId: "frs-tile-pl" },
    {
      href: "/frs/balance-sheet",
      icon: FileSpreadsheet,
      title: t("frs.home.bsTile"),
      body: t("frs.home.bsTileBody", { amount: money(data?.bs.totalAssetsP ?? 0) }),
      check: data ? (
        <BalanceCheck debitP={data.bs.totalAssetsP} creditP={data.bs.totalLiabilitiesP + data.bs.totalEquityP} balanced={data.bs.balanced} testId="bs-balanced" />
      ) : null,
      testId: "frs-tile-bs",
    },
    {
      href: "/frs/cash-flow",
      icon: Waves,
      title: t("frs.home.cfTile"),
      body: t("frs.home.cfTileBody"),
      check: data ? <BalanceCheck debitP={data.cf.netChangeP} creditP={data.cf.cashChangeP} balanced={data.cf.balanced} testId="cf-balanced" /> : null,
      testId: "frs-tile-cf",
    },
    { href: "/frs/vat", icon: Receipt, title: t("frs.home.vatTile"), body: t("frs.home.vatTileBody"), testId: "frs-tile-vat" },
    { href: "/frs/withholding", icon: Landmark, title: t("frs.home.whtTile"), body: t("frs.home.whtTileBody"), testId: "frs-tile-wht" },
  ]

  return (
    <div className="flex flex-col gap-5" data-testid="frs-home">
      <PageHeader title={t("frs.home.title")} subtitle={t("frs.home.subtitle")} />
      <KpiGrid>
        <KpiCard
          variant="cyan"
          icon={ChartColumn}
          title={t("frs.home.kpiRevenue")}
          value={money(data?.pl.netRevenueP ?? 0)}
          caption={t("frs.home.kpiRevenueCaption", { month: ready ? monthLabel(month) : "" })}
          href="/frs/profit-loss"
          className={flash}
        />
        <KpiCard
          variant="yellow"
          icon={TrendingUp}
          title={t("frs.home.kpiProfit")}
          value={money(data?.pl.profitBeforeTaxP ?? 0)}
          caption={t("frs.home.kpiProfitCaption", { pct: pct(margin, 1) })}
          href="/frs/profit-loss?view=compare"
        />
        <KpiCard
          variant="pink"
          icon={Wallet}
          title={t("frs.home.kpiCash")}
          value={money(data?.cash ?? 0)}
          caption={t("frs.home.kpiCashCaption")}
          href="/frs/cash-flow"
        />
        <KpiCard
          variant="purple"
          icon={Receipt}
          title={t("frs.home.kpiVat")}
          value={money(data?.vatPayable ?? 0)}
          caption={t("frs.home.kpiVatCaption")}
          href="/frs/vat"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_24rem]">
        <SectionCard title={t("frs.home.statements")}>
          <div className="grid grid-cols-1 gap-3 @container sm:grid-cols-2">
            {tiles.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                data-testid={tile.testId}
                className="group flex flex-col gap-2 rounded-md bg-surface-raised/50 p-4 transition-colors hover:bg-primary-soft"
              >
                <span className="flex items-center gap-3">
                  <span className="icon-well flex size-9 items-center justify-center text-link">
                    <tile.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">{tile.title}</span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-xs text-muted-foreground">{tile.body}</span>
                {tile.check ? <span className="text-sm">{tile.check}</span> : null}
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title={t("frs.home.taxCalendar")}
          icon={CalendarClock}
          size="sm"
        >
          {lastMonth ? (
            <p className="text-xs text-muted-foreground">{t("frs.home.taxCalendarHint", { month: monthLabel(lastMonth), date: dmy(due) })}</p>
          ) : null}
          <ul className="flex flex-col" data-testid="tax-calendar">
            <li className="flex items-start justify-between gap-3 border-b border-hairline py-2.5" data-testid="tax-calendar-vat">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{t("frs.home.vatReturn", { month: lastMonth ? monthLabel(lastMonth) : "" })}</span>
                <span className={cn("text-xs", !data?.vatReturn && overdue ? "text-destructive" : "text-muted-foreground")}>
                  {data?.vatReturn
                    ? t("frs.common.submittedOn", { date: dmy(data.vatReturn.submittedAt) })
                    : overdue
                      ? t("frs.common.overdue", { date: dmy(due) })
                      : t("frs.common.dueOn", { date: dmy(due) })}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                {data?.vatReturn ? (
                  <StatusText tone="success" dot>
                    {t("frs.home.submitted")}
                  </StatusText>
                ) : (
                  <Link href={`/frs/vat?month=${lastMonth}`} className="text-xs font-medium text-link hover:underline">
                    {t("frs.home.open")}
                  </Link>
                )}
                <MoneyText poisha={data?.vatReturn?.netPayableP ?? data?.figures.netPayableP ?? 0} className="font-mono text-xs" />
              </span>
            </li>
            {(["vat", "vds", "ait"] as TaxKind[]).map((kind) => {
              const d = data ? depositDue(kind, lastMonth, data.figures, data.vatReturn, data.deposits) : { dueP: 0, paidP: 0, leftP: 0 }
              const amount = kind === "vat" && !data?.vatReturn ? (data?.figures.netPayableP ?? 0) : d.dueP
              return (
                <li key={kind} className="flex items-start justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0" data-testid="tax-calendar-deposit" data-kind={kind}>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{t("frs.home.deposit", { kind: tk(`frs.deposits.kinds.${kind}`), month: lastMonth ? monthLabel(lastMonth) : "" })}</span>
                    <span className="text-xs text-muted-foreground">{t("frs.common.dueOn", { date: dmy(due) })}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {amount <= 0 ? (
                      <StatusText tone="muted" dot>
                        {t("frs.home.notDue")}
                      </StatusText>
                    ) : d.dueP > 0 && d.leftP === 0 ? (
                      <StatusText tone="success" dot>
                        {t("frs.home.paid")}
                      </StatusText>
                    ) : (
                      <StatusText tone={overdue ? "destructive" : "warning"} dot>
                        {t("frs.home.due")}
                      </StatusText>
                    )}
                    <MoneyText poisha={amount} className="font-mono text-xs" />
                  </span>
                </li>
              )
            })}
          </ul>
          <Link href={`/frs/vat?month=${lastMonth}`} className="mt-3 inline-block text-[0.8125rem] font-medium text-link hover:underline">
            {t("frs.home.open")}
          </Link>
        </SectionCard>
      </div>
    </div>
  )
}
