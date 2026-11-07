"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { PageHeader } from "@/components/shared/page-header"
import { Switch } from "@/components/ui/switch"
import type { AccountRow, Id } from "@/core/db/schema"
import { trialBalance, type TrialBalanceRow } from "@/core/ledger/statements"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { BalanceCheck, CsvButton, DrCr, LocationFilter, Toolbar } from "@/modules/fa/components/common"
import { PaperTable, PrintPreview } from "@/modules/fa/components/print-preview"
import { useMonthLabel } from "@/modules/fa/queries"

import { ledgerHref, useBooks } from "../queries"
import { RangeControls, StatementTable, TD, TH, useStatementRange } from "./range"

type Sums = { openingP: number; debitP: number; creditP: number; closingP: number }
type TbNode = { account: AccountRow; depth: number; sums: Sums; row?: TrialBalanceRow; children: TbNode[] }

const zero = (): Sums => ({ openingP: 0, debitP: 0, creditP: 0, closingP: 0 })
const add = (a: Sums, b: Sums): Sums => ({
  openingP: a.openingP + b.openingP,
  debitP: a.debitP + b.debitP,
  creditP: a.creditP + b.creditP,
  closingP: a.closingP + b.closingP,
})

/** Group subtotals: each group sums the accounts under it. */
function tbTree(accounts: AccountRow[], rows: TrialBalanceRow[]): TbNode[] {
  const rowOf = new Map(rows.map((r) => [r.account.id, r]))
  const children = new Map<string, AccountRow[]>()
  for (const a of accounts) children.set(a.parentId ?? "", [...(children.get(a.parentId ?? "") ?? []), a])
  const make = (a: AccountRow, depth: number): TbNode => {
    const kids = (children.get(a.id) ?? []).sort((x, y) => x.code.localeCompare(y.code)).map((c) => make(c, depth + 1))
    const row = rowOf.get(a.id)
    const own = row ? { openingP: row.openingP, debitP: row.debitP, creditP: row.creditP, closingP: row.closingP } : zero()
    return { account: a, depth, row, children: kids, sums: kids.reduce((s, k) => add(s, k.sums), own) }
  }
  return (children.get("") ?? []).sort((x, y) => x.code.localeCompare(y.code)).map((a) => make(a, 0))
}

const empty = (s: Sums) => !s.openingP && !s.debitP && !s.creditP && !s.closingP

/**
 * Trial balance (plan §9 `/frs/trial-balance`, accounting_rules.md §6):
 * every postable account with opening balance, the period's debits and
 * credits and the closing balance, group subtotals, "Balanced ✓" when total
 * debits equal total credits and closing balances net to zero. Month or
 * fiscal year to date, optionally one location. Each account drills to its
 * ledger, each ledger line to its voucher and source.
 */
export function TrialBalancePage() {
  const params = useSearchParams()
  const { t, date, dmy, money, locale } = useLocale()
  const monthLabel = useMonthLabel(date)
  const range = useStatementRange(params.get("month"))
  const books = useBooks(range.to)
  const [location, setLocation] = React.useState("")
  const [hideZero, setHideZero] = React.useState(true)

  const tb = React.useMemo(() => {
    if (!books || !range.from) return null
    const lines = location ? books.lines.filter((l) => l.locationId === location) : books.lines
    return trialBalance(books.accounts, lines, { from: range.from, to: range.to })
  }, [books, range.from, range.to, location])
  const tree = React.useMemo(() => (books && tb ? tbTree(books.accounts, tb.rows) : []), [books, tb])

  const flat: TbNode[] = []
  const walk = (nodes: TbNode[]) =>
    nodes.forEach((n) => {
      if (hideZero && empty(n.sums)) return
      flat.push(n)
      walk(n.children)
    })
  walk(tree)

  const href = (id: Id) => ledgerHref(id, range.from, range.to, location)
  const title = `${t("frs.tb.title")}, ${range.scope === "ytd" ? t("frs.common.fiscalYtd") : monthLabel(range.month)}`

  return (
    <div className="flex flex-col gap-5" data-testid="frs-tb-page">
      <PageHeader
        title={t("frs.tb.title")}
        subtitle={t("frs.tb.subtitle")}
        actions={
          tb ? (
            <>
              <CsvButton
                exportKey="frs.export"
                fileName={`trial-balance-${range.from}-${range.to}`}
                columns={[
                  { key: "code", label: t("frs.common.account") },
                  { key: "name", label: t("frs.common.account") },
                  { key: "openingP", label: t("frs.common.opening") },
                  { key: "debitP", label: t("frs.common.debit") },
                  { key: "creditP", label: t("frs.common.credit") },
                  { key: "closingP", label: t("frs.common.closing") },
                ]}
                rows={() =>
                  flat.map((n) => ({
                    code: n.account.code,
                    name: nameOf(n.account, locale),
                    openingP: n.sums.openingP,
                    debitP: n.sums.debitP,
                    creditP: n.sums.creditP,
                    closingP: n.sums.closingP,
                  }))
                }
              />
              <PrintPreview title={title} meta={`${dmy(range.from)} - ${dmy(range.to)}`} testId="tb-print">
                <PaperTable
                  head={[t("frs.common.account"), t("frs.common.opening"), t("frs.common.debit"), t("frs.common.credit"), t("frs.common.closing")]}
                  align={["l", "r", "r", "r", "r"]}
                  rows={flat.map((n) => [
                    <span key="a" style={{ paddingLeft: `${n.depth * 0.8}rem` }} className={n.row ? "" : "font-semibold"}>
                      <span lang="en" className="font-mono">
                        {n.account.code}
                      </span>{" "}
                      {nameOf(n.account, locale)}
                    </span>,
                    money(n.sums.openingP),
                    money(n.sums.debitP),
                    money(n.sums.creditP),
                    money(n.sums.closingP),
                  ])}
                  foot={[t("frs.common.total"), "", money(tb.totalDebitP), money(tb.totalCreditP), money(tb.closingNetP)]}
                />
              </PrintPreview>
            </>
          ) : null
        }
      />

      <section className="surface-card flex flex-col gap-4 p-4 sm:p-6">
        <Toolbar>
          <RangeControls {...range} periods={books?.periods} />
          <LocationFilter value={location} onChange={setLocation} testId="tb-location" />
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={hideZero} onCheckedChange={setHideZero} />
            {t("frs.common.hideZero")}
          </label>
        </Toolbar>
        {location ? <p className="text-xs text-muted-foreground">{t("frs.common.locationNote")}</p> : null}

        <StatementTable testId="frs-tb">
          <thead>
            <tr>
              <th className={cn(TH, "text-left")}>{t("frs.common.account")}</th>
              <th className={cn(TH, "hidden text-right @[44rem]/st:table-cell")}>{t("frs.common.opening")}</th>
              <th className={cn(TH, "text-right")}>{t("frs.common.debit")}</th>
              <th className={cn(TH, "text-right")}>{t("frs.common.credit")}</th>
              <th className={cn(TH, "text-right")}>{t("frs.common.closing")}</th>
            </tr>
          </thead>
          <tbody>
            {flat.map((n) => {
              const group = !n.row
              return (
                <tr key={n.account.id} className={cn("hover:bg-primary-soft", group && "bg-surface-raised/30")} data-testid={group ? "tb-group" : "tb-row"} data-code={n.account.code}>
                  <td className={cn(TD, group && "font-semibold")}>
                    <span className="flex items-center gap-2" style={{ paddingLeft: `${n.depth * 1}rem` }}>
                      <span lang="en" className="w-10 shrink-0 font-mono text-muted-foreground">
                        {n.account.code}
                      </span>
                      {group ? (
                        <span>{nameOf(n.account, locale)}</span>
                      ) : (
                        <Link href={href(n.account.id)} className="truncate hover:text-link hover:underline" data-testid="drill-link">
                          {nameOf(n.account, locale)}
                        </Link>
                      )}
                    </span>
                  </td>
                  <td className={cn(TD, "hidden text-right font-mono @[44rem]/st:table-cell", group && "font-semibold")}>
                    <DrCr balanceP={n.sums.openingP} />
                  </td>
                  <td className={cn(TD, "text-right font-mono", group && "font-semibold")}>{n.sums.debitP ? money(n.sums.debitP) : ""}</td>
                  <td className={cn(TD, "text-right font-mono", group && "font-semibold")}>{n.sums.creditP ? money(n.sums.creditP) : ""}</td>
                  <td className={cn(TD, "text-right font-mono", group && "font-semibold")}>
                    <DrCr balanceP={n.sums.closingP} />
                  </td>
                </tr>
              )
            })}
          </tbody>
          {tb ? (
            <tfoot>
              <tr className="font-semibold">
                <td className="h-10 rounded-l-md bg-surface-raised px-3">
                  {location ? (
                    t("frs.common.total")
                  ) : (
                    <BalanceCheck debitP={tb.totalDebitP} creditP={tb.totalCreditP} balanced={tb.balanced} testId="tb-balanced" />
                  )}
                </td>
                <td className="hidden h-10 bg-surface-raised px-3 @[44rem]/st:table-cell" />
                <td className="h-10 bg-surface-raised px-3 text-right font-mono">{money(tb.totalDebitP)}</td>
                <td className="h-10 bg-surface-raised px-3 text-right font-mono">{money(tb.totalCreditP)}</td>
                <td className="h-10 rounded-r-md bg-surface-raised px-3 text-right font-mono">
                  <DrCr balanceP={tb.closingNetP} />
                </td>
              </tr>
            </tfoot>
          ) : null}
        </StatementTable>
        <p className="text-xs text-muted-foreground">{t("frs.common.sourceNote")}</p>
      </section>
    </div>
  )
}
