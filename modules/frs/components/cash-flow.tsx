"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { PageHeader } from "@/components/shared/page-header"
import type { AccountTag } from "@/core/db/schema"
import { cashFlow } from "@/core/ledger/statements"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { BalanceCheck, CsvButton, Toolbar } from "@/modules/fa/components/common"
import { PaperTable, PrintPreview } from "@/modules/fa/components/print-preview"
import { useMonthLabel } from "@/modules/fa/queries"

import { accountOfTag, ledgerHref, useBooks } from "../queries"
import { DrillAmount, RangeControls, StatementTable, TD, TH, useStatementRange } from "./range"

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

type Row = { label: string; amountP: number; tag?: AccountTag; strong?: boolean; total?: boolean; testId?: string; indent?: boolean }

/**
 * Cash flow, indirect method (plan §9 `/frs/cash-flow`, accounting_rules.md
 * §6): profit before tax, depreciation added back, the working-capital
 * changes, investing and financing; the net change is checked against the
 * actual change in cash, bank, MFS wallets and card clearing ("Balanced ✓").
 * Opening and year-end closing vouchers are not flows.
 */
export function CashFlowPage() {
  const params = useSearchParams()
  const { t, date, dmy, money, locale } = useLocale()
  const monthLabel = useMonthLabel(date)
  const range = useStatementRange(params.get("month"))
  const books = useBooks(range.to)

  const cf = React.useMemo(() => (books && range.from ? cashFlow(books.accounts, books.lines, { from: range.from, to: range.to }) : null), [books, range.from, range.to])
  const cash = React.useMemo(() => {
    if (!books || !range.from) return null
    const ids = new Set(CASH_TAGS.map((tag) => books.map[tag]))
    let opening = 0
    let closing = 0
    for (const l of books.lines) {
      if (!ids.has(l.accountId)) continue
      // Opening balances (OB) are where the books start, not a flow.
      if (l.date < range.from || l.voucherType === "OB") opening += l.debitP - l.creditP
      closing += l.debitP - l.creditP
    }
    return { opening, closing }
  }, [books, range.from])

  const label = (tag: AccountTag) => {
    const account = books ? accountOfTag(books, tag) : undefined
    return account ? `${account.code} ${nameOf(account, locale)}` : tag
  }
  const rows: Row[] = []
  if (cf) {
    rows.push({ label: t("frs.cf.operating"), amountP: 0, strong: true, testId: "cf-heading" })
    rows.push({ label: t("frs.cf.profitBeforeTax"), amountP: cf.profitBeforeTaxP, indent: true })
    rows.push({ label: t("frs.cf.depreciation"), amountP: cf.depreciationP, indent: true })
    for (const w of cf.workingCapital) if (w.amountP) rows.push({ label: label(w.tag), amountP: w.amountP, tag: w.tag, indent: true })
    rows.push({ label: t("frs.cf.operatingTotal"), amountP: cf.operatingP, strong: true, testId: "cf-operating" })
    rows.push({ label: t("frs.cf.investing"), amountP: 0, strong: true, testId: "cf-heading" })
    for (const w of cf.investing) if (w.amountP) rows.push({ label: label(w.tag), amountP: w.amountP, tag: w.tag, indent: true })
    rows.push({ label: t("frs.cf.investingTotal"), amountP: cf.investingP, strong: true })
    rows.push({ label: t("frs.cf.financing"), amountP: 0, strong: true, testId: "cf-heading" })
    for (const w of cf.financing) if (w.amountP) rows.push({ label: label(w.tag), amountP: w.amountP, tag: w.tag, indent: true })
    rows.push({ label: t("frs.cf.financingTotal"), amountP: cf.financingP, strong: true })
    if (cf.otherP) rows.push({ label: t("frs.cf.other"), amountP: -cf.otherP, strong: true })
    rows.push({ label: t("frs.cf.netChange"), amountP: cf.netChangeP, strong: true, total: true, testId: "cf-net" })
    rows.push({ label: t("frs.cf.cashChange"), amountP: cf.cashChangeP, strong: true, total: true, testId: "cf-cash" })
  }
  const title = `${t("frs.cf.title")}, ${range.scope === "ytd" ? t("frs.common.fiscalYtd") : monthLabel(range.month)}`

  return (
    <div className="flex flex-col gap-5" data-testid="frs-cf-page">
      <PageHeader
        title={t("frs.cf.title")}
        subtitle={t("frs.cf.subtitle")}
        actions={
          cf ? (
            <>
              <CsvButton
                exportKey="frs.export"
                fileName={`cash-flow-${range.from}-${range.to}`}
                columns={[
                  { key: "line", label: t("frs.common.account") },
                  { key: "amountP", label: t("frs.common.amount") },
                ]}
                rows={() => rows.filter((r) => r.testId !== "cf-heading").map((r) => ({ line: r.label, amountP: r.amountP }))}
              />
              <PrintPreview title={title} meta={`${dmy(range.from)} - ${dmy(range.to)}`} testId="cf-print">
                <PaperTable
                  head={[t("frs.common.account"), t("frs.common.amount")]}
                  align={["l", "r"]}
                  rows={rows.map((r) => [
                    <span key="l" className={r.strong ? "font-semibold" : "pl-3"}>
                      {r.label}
                    </span>,
                    r.testId === "cf-heading" ? "" : money(r.amountP),
                  ])}
                />
              </PrintPreview>
            </>
          ) : null
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 sm:p-6">
        <Toolbar>
          <RangeControls {...range} periods={books?.periods} />
          {cf ? (
            <span className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("frs.cf.check")}</span>
              <BalanceCheck debitP={cf.netChangeP} creditP={cf.cashChangeP} balanced={cf.balanced} testId="cf-balanced" />
            </span>
          ) : null}
        </Toolbar>
        <StatementTable testId="frs-cf">
          <thead>
            <tr>
              <th className={cn(TH, "text-left")}>{t("frs.common.account")}</th>
              <th className={cn(TH, "text-right")}>{t("frs.common.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn("hover:bg-primary-soft", r.total && "bg-surface-raised/40")} data-testid={r.testId ?? "cf-row"}>
                <td className={cn(TD, r.strong ? "font-semibold" : "", r.indent && "pl-6")}>
                  <span className="line-clamp-1">{r.label}</span>
                </td>
                <td className={cn(TD, "text-right whitespace-nowrap")}>
                  {r.testId === "cf-heading" ? null : (
                    <DrillAmount
                      poisha={r.amountP}
                      strong={r.strong}
                      href={r.tag && books ? ledgerHref(books.map[r.tag], range.from, range.to) : undefined}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </StatementTable>
        {cash ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-surface-raised/60 p-3">
              <div className="text-xs text-muted-foreground">{t("frs.cf.openingCash")}</div>
              <div className="font-mono font-semibold">{money(cash.opening)}</div>
            </div>
            <div className="rounded-md bg-surface-raised/60 p-3">
              <div className="text-xs text-muted-foreground">{t("frs.cf.closingCash")}</div>
              <div className="font-mono font-semibold" data-testid="cf-closing-cash">
                {money(cash.closing)}
              </div>
            </div>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("frs.common.sourceNote")}</p>
      </section>
    </div>
  )
}
