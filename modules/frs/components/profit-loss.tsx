"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { PageHeader } from "@/components/shared/page-header"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fiscalYearBounds, locations } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import type { AccountRow, JournalLineRow } from "@/core/db/schema"
import { profitAndLoss, type PlSectionKey, type ProfitAndLoss } from "@/core/ledger/statements"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { CsvButton, Toolbar } from "@/modules/fa/components/common"
import { PaperTable, PrintPreview } from "@/modules/fa/components/print-preview"
import { useMonthLabel } from "@/modules/fa/queries"

import { ledgerHref, monthEnd, useBooks } from "../queries"
import { DrillAmount, RangeControls, StatementTable, TD, TH, useStatementRange } from "./range"

type View = "studios" | "months" | "compare"
type Column = { key: string; label: string; pl: ProfitAndLoss; from: string; to: string; locationId?: string; link: boolean }

const SECTIONS: { key: PlSectionKey; after?: "netRevenue" | "grossProfit" | "operatingProfit" }[] = [
  { key: "serviceRevenue" },
  { key: "productSales" },
  { key: "discounts", after: "netRevenue" },
  { key: "costOfSales", after: "grossProfit" },
  { key: "operatingExpenses", after: "operatingProfit" },
  { key: "otherIncome" },
  { key: "financeCosts" },
]

/** Months of the fiscal year from its first month to `month`. */
function fiscalMonths(month: string): string[] {
  const out: string[] = []
  let m = fiscalYearBounds(`${month}-01`).startsOn.slice(0, 7)
  while (m <= month) {
    out.push(m)
    m = addDaysISO(`${monthEnd(m)}`, 1).slice(0, 7)
  }
  return out
}

function previousMonth(month: string): string {
  return addDaysISO(`${month}-01`, -1).slice(0, 7)
}

/**
 * Profit and loss (plan §9 `/frs/profit-loss`, accounting_rules.md §6): net
 * revenue, gross profit, operating profit and profit before tax; by studio
 * through the location dimension (HQ costs in their own column), by month
 * across the fiscal year, or against the prior month. The year-end closing
 * voucher (YC) is left out. Every figure drills to its ledger.
 */
export function ProfitLossPage() {
  const params = useSearchParams()
  const { t, tk, date, dmy, money, pct, locale } = useLocale()
  const monthLabel = useMonthLabel(date)
  const range = useStatementRange(params.get("month"))
  const [view, setView] = React.useState<View>((params.get("view") as View) ?? "studios")
  const priorFrom = range.month ? `${previousMonth(range.month)}-01` : ""
  const earliest = view === "months" && range.month ? fiscalYearBounds(`${range.month}-01`).startsOn : view === "compare" ? priorFrom : range.from
  const books = useBooks(range.to)

  const columns = React.useMemo<Column[]>(() => {
    if (!books || !range.from) return []
    const accounts = books.accounts
    const lines: JournalLineRow[] = books.lines.filter((l) => l.date >= (earliest || range.from))
    const pl = (from: string, to: string, locationId?: string) => profitAndLoss(accounts, lines, { from, to, locationId })
    if (view === "studios") {
      const total = pl(range.from, range.to)
      const cols: Column[] = locations.map((l) => ({
        key: l.code,
        label: l.code,
        pl: pl(range.from, range.to, l.id),
        from: range.from,
        to: range.to,
        locationId: l.id,
        link: true,
      }))
      const assigned = cols.reduce((s, c) => s + c.pl.profitBeforeTaxP, 0)
      const unassignedPl = subtract(total, cols.map((c) => c.pl))
      if (assigned !== total.profitBeforeTaxP || hasAny(unassignedPl)) {
        cols.push({ key: "none", label: t("frs.pl.unassigned"), pl: unassignedPl, from: range.from, to: range.to, link: false })
      }
      cols.push({ key: "total", label: t("frs.pl.total"), pl: total, from: range.from, to: range.to, link: true })
      return cols
    }
    if (view === "months") {
      const cols: Column[] = fiscalMonths(range.month).map((m) => {
        const end = monthEnd(m) > range.to ? range.to : monthEnd(m)
        return { key: m, label: date(`${m}-15T12:00:00+06:00`, { month: "short" }), pl: pl(`${m}-01`, end), from: `${m}-01`, to: end, link: true }
      })
      const start = fiscalYearBounds(`${range.month}-01`).startsOn
      cols.push({ key: "ytd", label: t("frs.pl.ytd"), pl: pl(start, range.to), from: start, to: range.to, link: true })
      return cols
    }
    const prior = previousMonth(range.month)
    return [
      { key: "current", label: monthLabel(range.month), pl: pl(`${range.month}-01`, range.to), from: `${range.month}-01`, to: range.to, link: true },
      { key: "prior", label: monthLabel(prior), pl: pl(`${prior}-01`, monthEnd(prior)), from: `${prior}-01`, to: monthEnd(prior), link: true },
    ]
  }, [books, range.from, range.to, range.month, view, earliest, t, date, monthLabel])

  // Accounts with any amount in any column, per section, in code order.
  const rowsOf = (section: PlSectionKey): AccountRow[] => {
    const ids = new Set<string>()
    for (const c of columns) for (const r of c.pl.sections[section]) if (r.amountP) ids.add(r.account.id)
    return (books?.accounts ?? []).filter((a) => ids.has(a.id))
  }
  const amountOf = (c: Column, section: PlSectionKey, accountId: string) =>
    c.pl.sections[section].find((r) => r.account.id === accountId)?.amountP ?? 0
  const compare = view === "compare"
  const total = columns.find((c) => c.key === "total" || c.key === "ytd" || c.key === "current")

  const csvRows = () => {
    const out: Record<string, string | number>[] = []
    for (const s of SECTIONS) {
      for (const a of rowsOf(s.key)) {
        out.push({ line: `${a.code} ${nameOf(a, locale)}`, ...Object.fromEntries(columns.map((c) => [c.key, amountOf(c, s.key, a.id)])) })
      }
      out.push({ line: tk(`frs.pl.sections.${s.key}`), ...Object.fromEntries(columns.map((c) => [c.key, c.pl.totals[s.key]])) })
      if (s.after) out.push({ line: tk(`frs.pl.${s.after}`), ...Object.fromEntries(columns.map((c) => [c.key, c.pl[`${s.after!}P`]])) })
    }
    out.push({ line: t("frs.pl.profitBeforeTax"), ...Object.fromEntries(columns.map((c) => [c.key, c.pl.profitBeforeTaxP])) })
    return out
  }

  const figureRows: { label: string; strong?: boolean; values: number[]; accountId?: string; section?: PlSectionKey; total?: boolean }[] = []
  for (const s of SECTIONS) {
    const accounts = rowsOf(s.key)
    for (const a of accounts) {
      figureRows.push({ label: `${a.code} ${nameOf(a, locale)}`, values: columns.map((c) => amountOf(c, s.key, a.id)), accountId: a.id, section: s.key })
    }
    figureRows.push({ label: tk(`frs.pl.sections.${s.key}`), values: columns.map((c) => c.pl.totals[s.key]), strong: true })
    if (s.after) figureRows.push({ label: tk(`frs.pl.${s.after}`), values: columns.map((c) => c.pl[`${s.after!}P`]), strong: true, total: true })
  }
  figureRows.push({ label: t("frs.pl.profitBeforeTax"), values: columns.map((c) => c.pl.profitBeforeTaxP), strong: true, total: true })

  const title = `${t("frs.pl.title")}, ${range.scope === "ytd" && view !== "months" ? t("frs.common.fiscalYtd") : monthLabel(range.month)}`
  const margin = total && total.pl.netRevenueP ? (total.pl.grossProfitP / total.pl.netRevenueP) * 100 : 0

  return (
    <div className="flex flex-col gap-5" data-testid="frs-pl-page">
      <PageHeader
        title={t("frs.pl.title")}
        subtitle={t("frs.pl.subtitle")}
        actions={
          columns.length ? (
            <>
              <CsvButton
                exportKey="frs.export"
                fileName={`profit-and-loss-${view}-${range.from}-${range.to}`}
                columns={[{ key: "line", label: t("frs.common.account") }, ...columns.map((c) => ({ key: c.key, label: c.label }))]}
                rows={csvRows}
              />
              <PrintPreview title={title} meta={`${dmy(range.from)} - ${dmy(range.to)}`} testId="pl-print">
                <PaperTable
                  head={[t("frs.common.account"), ...columns.map((c) => c.label)]}
                  align={["l", ...columns.map(() => "r" as const)]}
                  rows={figureRows.map((r) => [
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
        <Toolbar>
          <RangeControls {...range} periods={books?.periods} showScope={view === "studios"} />
          <ToggleGroup
            value={[view]}
            onValueChange={(v) => {
              const next = (Array.isArray(v) ? v[0] : v) as View | undefined
              if (next) setView(next)
            }}
            className="rounded-md bg-surface-raised p-0.5"
          >
            {(["studios", "months", "compare"] as View[]).map((v) => (
              <ToggleGroupItem key={v} value={v} className="h-8 px-3 text-xs" data-testid={`pl-view-${v}`}>
                {tk(`frs.pl.views.${v}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {total ? (
            <span className="ml-auto text-xs text-muted-foreground" data-testid="pl-margin">
              {t("frs.pl.grossMargin", { pct: pct(margin, 1) })}
            </span>
          ) : null}
        </Toolbar>

        <StatementTable testId="frs-pl">
          <thead>
            <tr>
              <th className={cn(TH, "sticky left-0 z-10 min-w-56 text-left")}>{t("frs.common.account")}</th>
              {columns.map((c) => (
                <th key={c.key} className={cn(TH, "text-right")} data-col={c.key}>
                  {c.label}
                </th>
              ))}
              {compare ? (
                <>
                  <th className={cn(TH, "text-right")}>{t("frs.pl.change")}</th>
                  <th className={cn(TH, "hidden text-right @[40rem]/st:table-cell")}>{t("frs.pl.changePct")}</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {figureRows.map((r, i) => {
              const change = compare ? r.values[0] - r.values[1] : 0
              return (
                <tr
                  key={i}
                  className={cn("hover:bg-primary-soft", r.total && "bg-surface-raised/40")}
                  data-testid={r.total ? "pl-total" : r.strong ? "pl-section" : "pl-row"}
                >
                  <td className={cn(TD, "sticky left-0 bg-card", r.strong ? "font-semibold" : "pl-6 text-[0.8125rem]", r.total && "bg-surface-raised")}>
                    <span className="line-clamp-1">{r.label}</span>
                  </td>
                  {r.values.map((v, ci) => {
                    const c = columns[ci]
                    return (
                      <td key={c.key} className={cn(TD, "text-right whitespace-nowrap")}>
                        <DrillAmount
                          poisha={v}
                          strong={r.strong}
                          href={r.accountId && c.link ? ledgerHref(r.accountId, c.from, c.to, c.locationId) : undefined}
                        />
                      </td>
                    )
                  })}
                  {compare ? (
                    <>
                      <td className={cn(TD, "text-right font-mono")}>
                        <DrillAmount poisha={change} strong={r.strong} />
                      </td>
                      <td className={cn(TD, "hidden text-right font-mono text-xs @[40rem]/st:table-cell")}>
                        {r.values[1] ? pct((change / Math.abs(r.values[1])) * 100, 1) : ""}
                      </td>
                    </>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </StatementTable>
        <p className="text-xs text-muted-foreground">{t("frs.common.sourceNote")}</p>
      </section>
    </div>
  )
}

/** The part of a total not in any location column (lines without a location). */
function subtract(total: ProfitAndLoss, parts: ProfitAndLoss[]): ProfitAndLoss {
  const sections = Object.fromEntries(
    (Object.keys(total.sections) as PlSectionKey[]).map((k) => [
      k,
      total.sections[k].map((r) => ({
        account: r.account,
        amountP: r.amountP - parts.reduce((s, p) => s + (p.sections[k].find((x) => x.account.id === r.account.id)?.amountP ?? 0), 0),
      })),
    ])
  ) as ProfitAndLoss["sections"]
  const totals = Object.fromEntries(
    (Object.keys(total.totals) as PlSectionKey[]).map((k) => [k, total.totals[k] - parts.reduce((s, p) => s + p.totals[k], 0)])
  ) as ProfitAndLoss["totals"]
  const minus = (key: "netRevenueP" | "grossProfitP" | "operatingProfitP" | "profitBeforeTaxP") =>
    total[key] - parts.reduce((s, p) => s + p[key], 0)
  return {
    sections,
    totals,
    netRevenueP: minus("netRevenueP"),
    grossProfitP: minus("grossProfitP"),
    operatingProfitP: minus("operatingProfitP"),
    profitBeforeTaxP: minus("profitBeforeTaxP"),
  }
}

function hasAny(pl: ProfitAndLoss): boolean {
  return Object.values(pl.totals).some((v) => v !== 0)
}
