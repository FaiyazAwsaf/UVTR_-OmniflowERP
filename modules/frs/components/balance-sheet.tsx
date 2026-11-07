"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { DateField } from "@/components/shared/date-field"
import { PageHeader } from "@/components/shared/page-header"
import { Switch } from "@/components/ui/switch"
import { fiscalYearBounds } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import { balanceSheet, type BalanceSheet } from "@/core/ledger/statements"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { BalanceCheck, CsvButton, Field, Toolbar } from "@/modules/fa/components/common"
import { PaperTable, PrintPreview } from "@/modules/fa/components/print-preview"
import { useToday } from "@/modules/fa/queries"

import { ledgerHref, useBooks } from "../queries"
import { DrillAmount, StatementTable, TD, TH } from "./range"

type Row = { label: string; values: number[]; accountId?: string; strong?: boolean; total?: boolean; testId?: string }

/**
 * Balance sheet (plan §9 `/frs/balance-sheet`, accounting_rules.md §6) at a
 * date: non-current assets net of accumulated depreciation, current assets,
 * current and non-current liabilities, equity with the result of an earlier
 * year not yet closed and the current year's result (computed, not posted);
 * "Balanced ✓" when assets equal liabilities plus equity. Optional
 * comparison with the end of the previous month. Every figure drills down.
 */
export function BalanceSheetPage() {
  const params = useSearchParams()
  const { t, dmy, money, locale } = useLocale()
  const today = useToday()
  const ready = today > "2000"
  const [asOfInput, setAsOf] = React.useState(params.get("asOf") ?? "")
  const asOf = asOfInput || (ready ? today : "")
  const [comparing, setComparing] = React.useState(true)
  const priorEnd = asOf ? addDaysISO(`${asOf.slice(0, 7)}-01`, -1) : ""
  const books = useBooks(asOf)

  const sheets = React.useMemo(() => {
    if (!books || !asOf) return null
    const at = (day: string): BalanceSheet =>
      balanceSheet(books.accounts, books.lines, { asOf: day, fiscalYearStart: fiscalYearBounds(day).startsOn })
    return comparing ? [at(asOf), at(priorEnd)] : [at(asOf)]
  }, [books, asOf, priorEnd, comparing])

  const fyStart = asOf ? fiscalYearBounds(asOf).startsOn : ""
  const priorYearEnd = fyStart ? addDaysISO(fyStart, -1) : ""
  const historyStart = books?.periods[0]?.startsOn ?? fyStart

  const rows: Row[] = []
  if (sheets) {
    const [now] = sheets
    const section = (key: "nonCurrentAssets" | "currentAssets" | "currentLiabilities" | "nonCurrentLiabilities" | "equity") => {
      for (const r of now[key]) {
        const values = sheets.map((s) => s[key].find((x) => x.account.id === r.account.id)?.amountP ?? 0)
        if (values.every((v) => v === 0)) continue
        rows.push({ label: `${r.account.code} ${nameOf(r.account, locale)}`, values, accountId: r.account.id })
      }
      rows.push({ label: t(`frs.bs.${key}`), values: sheets.map((s) => s[key].reduce((sum, x) => sum + x.amountP, 0)), strong: true })
    }
    section("nonCurrentAssets")
    section("currentAssets")
    rows.push({ label: t("frs.bs.totalAssets"), values: sheets.map((s) => s.totalAssetsP), strong: true, total: true, testId: "bs-total-assets" })
    section("currentLiabilities")
    section("nonCurrentLiabilities")
    rows.push({ label: t("frs.bs.totalLiabilities"), values: sheets.map((s) => s.totalLiabilitiesP), strong: true })
    for (const r of now.equity) {
      const values = sheets.map((s) => s.equity.find((x) => x.account.id === r.account.id)?.amountP ?? 0)
      rows.push({ label: `${r.account.code} ${nameOf(r.account, locale)}`, values, accountId: r.account.id })
    }
    if (sheets.some((s) => s.unclosedEarlierResultP !== 0)) {
      rows.push({ label: t("frs.bs.unclosedYear", { date: dmy(priorYearEnd) }), values: sheets.map((s) => s.unclosedEarlierResultP), testId: "bs-unclosed" })
    }
    rows.push({ label: t("frs.bs.currentYear", { date: dmy(fyStart) }), values: sheets.map((s) => s.currentYearResultP), testId: "bs-current-year" })
    rows.push({ label: t("frs.bs.totalEquity"), values: sheets.map((s) => s.totalEquityP), strong: true })
    rows.push({
      label: t("frs.bs.liabilitiesAndEquity"),
      values: sheets.map((s) => s.totalLiabilitiesP + s.totalEquityP),
      strong: true,
      total: true,
      testId: "bs-total-le",
    })
  }
  const heads = [dmy(asOf), ...(comparing ? [dmy(priorEnd)] : [])]
  const balanced = sheets ? sheets[0].balanced : true

  return (
    <div className="flex flex-col gap-5" data-testid="frs-bs-page">
      <PageHeader
        title={t("frs.bs.title")}
        subtitle={t("frs.bs.subtitle")}
        actions={
          sheets ? (
            <>
              <CsvButton
                exportKey="frs.export"
                fileName={`balance-sheet-${asOf}`}
                columns={[{ key: "line", label: t("frs.common.account") }, ...heads.map((h, i) => ({ key: `v${i}`, label: h }))]}
                rows={() => rows.map((r) => ({ line: r.label, ...Object.fromEntries(r.values.map((v, i) => [`v${i}`, v])) }))}
              />
              <PrintPreview title={`${t("frs.bs.title")}, ${dmy(asOf)}`} testId="bs-print">
                <PaperTable
                  head={[t("frs.common.account"), ...heads]}
                  align={["l", ...heads.map(() => "r" as const)]}
                  rows={rows.map((r) => [
                    <span key="l" className={r.strong ? "font-semibold" : "pl-3"}>
                      {r.label}
                    </span>,
                    ...r.values.map((v) => money(v)),
                  ])}
                />
              </PrintPreview>
            </>
          ) : null
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 sm:p-6">
        <Toolbar className="items-end">
          <Field label={t("frs.common.asAt")} className="w-40">
            <DateField value={asOf} max={ready ? today : undefined} onChange={(iso) => iso && setAsOf(iso)} data-testid="bs-asof" />
          </Field>
          <label className="flex h-10 items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={comparing} onCheckedChange={setComparing} data-testid="bs-compare" />
            {t("frs.bs.compare")}: {comparing ? t("frs.bs.priorMonthEnd") : t("frs.bs.noCompare")}
          </label>
          <span className="ml-auto self-center">
            <BalanceCheck
              debitP={sheets?.[0].totalAssetsP ?? 0}
              creditP={(sheets?.[0].totalLiabilitiesP ?? 0) + (sheets?.[0].totalEquityP ?? 0)}
              balanced={balanced}
              testId="bs-balanced"
            />
          </span>
        </Toolbar>
        <StatementTable testId="frs-bs">
          <thead>
            <tr>
              <th className={cn(TH, "text-left")}>{t("frs.common.account")}</th>
              {heads.map((h, i) => (
                <th key={i} className={cn(TH, "text-right", i > 0 && "hidden @[36rem]/st:table-cell")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn("hover:bg-primary-soft", r.total && "bg-surface-raised/40")} data-testid={r.testId ?? (r.accountId ? "bs-row" : "bs-section")}>
                <td className={cn(TD, r.strong ? "font-semibold" : "pl-6")}>
                  <span className="line-clamp-1">{r.label}</span>
                </td>
                {r.values.map((v, vi) => (
                  <td key={vi} className={cn(TD, "text-right whitespace-nowrap", vi > 0 && "hidden @[36rem]/st:table-cell")}>
                    <DrillAmount
                      poisha={v}
                      strong={r.strong}
                      href={r.accountId ? ledgerHref(r.accountId, historyStart, vi === 0 ? asOf : priorEnd) : undefined}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </StatementTable>
        <p className="text-xs text-muted-foreground">{t("frs.common.sourceNote")}</p>
      </section>
    </div>
  )
}
