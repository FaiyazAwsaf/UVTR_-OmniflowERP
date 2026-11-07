"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { BookOpenText } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { AccountPicker } from "@/components/shared/pickers"
import { Button } from "@/components/ui/button"
import { fiscalYearBounds } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { JournalLineRow, JournalRow } from "@/core/db/schema"
import { ledgerWithRunningBalance, trialBalance } from "@/core/ledger/statements"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { useAccounts, useToday } from "../queries"
import { CsvButton, DrCr, Field, LocationFilter, Toolbar } from "./common"
import { PaperTable, PrintPreview } from "./print-preview"

type LedgerRow = JournalLineRow & { runningP: number; journal?: JournalRow; party?: string }

function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`
}
function lastMonthRange(day: string): [string, string] {
  const end = addDaysISO(monthStart(day), -1)
  return [monthStart(end), end]
}

/**
 * General ledger and account ledger (plan §9 `/fa/ledger`): an account, a
 * date range (DD-MM-YYYY) and an optional location; the opening balance,
 * every line with its running balance, and each line opening its voucher
 * and source document. Without an account, the general ledger lists every
 * account's movement in the range. `?account=&from=&to=&location=` deep
 * links from the chart, statements and DocLinks.
 */
export function LedgerPage() {
  const db = useDb()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { t, dmy, num, money, locale } = useLocale()
  const today = useToday()
  const accounts = useAccounts()
  const ready = today > "2000"

  const accountId = params.get("account")
  const from = params.get("from") ?? (ready ? monthStart(today) : "")
  const to = params.get("to") ?? (ready ? today : "")
  const location = params.get("location") ?? ""

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router]
  )

  const account = accounts?.find((a) => a.id === accountId)

  const data = useLiveQuery(async () => {
    if (!accountId || !to) return null
    const all = await db.journalLines.where("accountId").equals(accountId).toArray()
    const scoped = location ? all.filter((l) => l.locationId === location) : all
    let openingP = 0
    const inRange: JournalLineRow[] = []
    for (const l of scoped) {
      if (l.date < from) openingP += l.debitP - l.creditP
      else if (l.date <= to) inRange.push(l)
    }
    const journals = new Map(
      (await db.journals.bulkGet([...new Set(inRange.map((l) => l.journalId))])).filter(Boolean).map((j) => [j!.id, j!])
    )
    inRange.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (journals.get(a.journalId)?.postedAt ?? 0) - (journals.get(b.journalId)?.postedAt ?? 0) ||
        a.lineNo - b.lineNo
    )
    const parties = new Map(
      (await db.parties.bulkGet([...new Set(inRange.flatMap((l) => (l.partyId ? [l.partyId] : [])))]))
        .filter(Boolean)
        .map((p) => [p!.id, p!])
    )
    const rows: LedgerRow[] = ledgerWithRunningBalance(openingP, inRange).map((l) => ({
      ...l,
      journal: journals.get(l.journalId),
      party: l.partyId ? nameOf(parties.get(l.partyId), locale) : undefined,
    }))
    return { openingP, rows }
  }, [db, accountId, from, to, location, locale])

  const general = useLiveQuery(async () => {
    if (accountId || !to || !accounts) return null
    const lines = await db.journalLines.where("date").belowOrEqual(to).toArray()
    const scoped = location ? lines.filter((l) => l.locationId === location) : lines
    return trialBalance(accounts, scoped, { from, to }).rows.filter((r) => r.openingP || r.debitP || r.creditP)
  }, [db, accountId, from, to, location, accounts])

  const columns = React.useMemo<ColumnDef<LedgerRow, unknown>[]>(
    () => [
      { id: "date", header: t("fa.common.date"), accessorKey: "date", cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span> },
      {
        id: "voucher",
        header: t("fa.ledger.voucher"),
        cell: ({ row }) =>
          row.original.journal ? (
            <span data-testid="ledger-row" data-journal-no={row.original.journal.journalNo}>
              <DocLink docType="journals" docId={row.original.journalId} docNo={row.original.journal.journalNo} showApp={false} />
            </span>
          ) : null,
      },
      {
        id: "narration",
        header: t("fa.common.narration"),
        meta: { hideBelow: "lg" },
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-[24rem]">
            {row.original.description || row.original.journal?.narration}
            {row.original.party ? <span className="text-muted-foreground"> · {row.original.party}</span> : null}
          </span>
        ),
      },
      {
        id: "source",
        header: t("fa.common.source"),
        meta: { hideBelow: "md" },
        cell: ({ row }) => {
          const s = row.original.journal?.source
          return s && s.docType !== "journals" ? (
            <span data-testid="drill-link">
              <DocLink docType={s.docType} docId={s.docId} docNo={s.docNo} />
            </span>
          ) : (
            <span className="text-muted-foreground">{t("fa.common.manual")}</span>
          )
        },
      },
      {
        id: "debit",
        header: t("fa.common.debit"),
        accessorKey: "debitP",
        meta: { align: "right", className: "font-mono" },
        cell: ({ row }) => (row.original.debitP ? <MoneyText poisha={row.original.debitP} /> : null),
      },
      {
        id: "credit",
        header: t("fa.common.credit"),
        accessorKey: "creditP",
        meta: { align: "right", className: "font-mono" },
        cell: ({ row }) => (row.original.creditP ? <MoneyText poisha={row.original.creditP} /> : null),
      },
      {
        id: "running",
        header: t("fa.ledger.running"),
        accessorKey: "runningP",
        enableSorting: false,
        meta: { align: "right", className: "font-mono" },
        cell: ({ row }) => <DrCr balanceP={row.original.runningP} />,
      },
    ],
    [t, dmy]
  )

  const rows = data?.rows ?? []
  const debitP = rows.reduce((s, r) => s + r.debitP, 0)
  const creditP = rows.reduce((s, r) => s + r.creditP, 0)
  const closingP = (data?.openingP ?? 0) + debitP - creditP
  const fy = ready ? fiscalYearBounds(today) : null

  const quick = (range: [string, string]) => setParams({ from: range[0], to: range[1] })

  return (
    <div className="flex flex-col gap-5" data-testid="fa-ledger">
      <PageHeader
        title={account ? `${account.code} ${nameOf(account, locale)}` : t("fa.ledger.general")}
        subtitle={account ? t("fa.ledger.subtitle") : t("fa.ledger.generalHint")}
        actions={
          account && data ? (
            <>
              <CsvButton
                exportKey="fa.export"
                fileName={`ledger-${account.code}-${from}-${to}`}
                columns={[
                  { key: "date", label: t("fa.common.date") },
                  { key: "voucher", label: t("fa.ledger.voucher") },
                  { key: "narration", label: t("fa.common.narration") },
                  { key: "source", label: t("fa.common.source") },
                  { key: "debitP", label: t("fa.common.debit") },
                  { key: "creditP", label: t("fa.common.credit") },
                  { key: "runningP", label: t("fa.ledger.running") },
                ]}
                rows={() => [
                  { date: from, voucher: "", narration: t("fa.ledger.opening"), source: "", debitP: "", creditP: "", runningP: data.openingP },
                  ...rows.map((r) => ({
                    date: r.date,
                    voucher: r.journal?.journalNo ?? "",
                    narration: r.description || r.journal?.narration || "",
                    source: r.journal?.source?.docNo ?? "",
                    debitP: r.debitP,
                    creditP: r.creditP,
                    runningP: r.runningP,
                  })),
                ]}
              />
              <PrintPreview
                title={`${t("fa.ledger.title")} ${account.code} ${nameOf(account, locale)}`}
                meta={`${dmy(from)} - ${dmy(to)}`}
                testId="ledger-print"
              >
                <PaperTable
                  head={[t("fa.common.date"), t("fa.ledger.voucher"), t("fa.common.narration"), t("fa.common.debit"), t("fa.common.credit"), t("fa.ledger.running")]}
                  align={["l", "l", "l", "r", "r", "r"]}
                  rows={[
                    ["", "", t("fa.ledger.opening"), "", "", money(data.openingP)],
                    ...rows.map((r) => [
                      dmy(r.date),
                      <span key="n" lang="en" className="font-mono">
                        {r.journal?.journalNo}
                      </span>,
                      r.description || r.journal?.narration || "",
                      r.debitP ? money(r.debitP) : "",
                      r.creditP ? money(r.creditP) : "",
                      money(r.runningP),
                    ]),
                  ]}
                  foot={["", "", t("fa.ledger.closing"), money(debitP), money(creditP), money(closingP)]}
                />
              </PrintPreview>
            </>
          ) : null
        }
      />

      <section className="surface-card @container flex flex-col gap-3 p-4 sm:p-5">
        <Toolbar className="items-end">
          <Field label={t("fa.common.account")} className="w-full max-w-[26rem] min-w-56 flex-1">
            <AccountPicker value={accountId} onChange={(id) => setParams({ account: id })} testId="ledger-account" />
          </Field>
          <Field label={t("fa.common.from")} className="w-36">
            <DateField value={from} onChange={(iso) => iso && setParams({ from: iso })} data-testid="ledger-from" />
          </Field>
          <Field label={t("fa.common.to")} className="w-36">
            <DateField value={to} onChange={(iso) => iso && setParams({ to: iso })} data-testid="ledger-to" />
          </Field>
          <Field label={t("fa.common.location")}>
            <LocationFilter value={location} onChange={(id) => setParams({ location: id || null })} testId="ledger-location" />
          </Field>
        </Toolbar>
        {ready ? (
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" size="xs" onClick={() => quick([monthStart(today), today])}>
              {t("fa.ledger.thisMonth")}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => quick(lastMonthRange(today))}>
              {t("fa.ledger.lastMonth")}
            </Button>
            {fy ? (
              <Button variant="ghost" size="xs" onClick={() => quick([fy.startsOn, today])}>
                {t("fa.ledger.fiscalYear")}
              </Button>
            ) : null}
            {accountId ? (
              <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setParams({ account: null })}>
                {t("fa.ledger.general")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      {accountId ? (
        <>
          <div className="grid grid-cols-2 gap-3 @container min-[1100px]:grid-cols-4">
            {[
              [t("fa.ledger.opening"), <DrCr key="o" balanceP={data?.openingP ?? 0} />],
              [t("fa.common.debit"), <MoneyText key="d" poisha={debitP} />],
              [t("fa.common.credit"), <MoneyText key="c" poisha={creditP} />],
              [t("fa.ledger.closing"), <DrCr key="cl" balanceP={closingP} />],
            ].map(([label, value], i) => (
              <div key={i} className="surface-card flex flex-col gap-1 p-4" data-testid={i === 3 ? "ledger-closing" : undefined}>
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="font-mono text-base font-semibold">{value}</span>
              </div>
            ))}
          </div>
          <DataTable
            data={rows}
            columns={columns}
            rowId={(r) => r.id}
            density="compact"
            pageSize={100}
            emptyIcon={<BookOpenText />}
            emptyTitle={t("fa.ledger.noLines")}
            toolbar={<span className="text-xs text-muted-foreground">{t("fa.ledger.lines", { count: num(rows.length) })}</span>}
          />
        </>
      ) : general && general.length ? (
        <section className="surface-card @container overflow-x-auto p-4 sm:p-5">
          <table className="w-full border-separate border-spacing-0 text-[0.8125rem]" data-testid="general-ledger">
            <thead>
              <tr>
                <th className="h-9 rounded-l-md bg-surface-raised px-3 text-left font-medium">{t("fa.common.account")}</th>
                <th className="hidden h-9 bg-surface-raised px-3 text-right font-medium @[44rem]:table-cell">{t("fa.ledger.opening")}</th>
                <th className="h-9 bg-surface-raised px-3 text-right font-medium">{t("fa.common.debit")}</th>
                <th className="h-9 bg-surface-raised px-3 text-right font-medium">{t("fa.common.credit")}</th>
                <th className="h-9 rounded-r-md bg-surface-raised px-3 text-right font-medium">{t("fa.ledger.closing")}</th>
              </tr>
            </thead>
            <tbody>
              {general.map((r) => (
                <tr key={r.account.id} className="hover:bg-primary-soft">
                  <td className="h-9 border-b border-hairline px-3">
                    <Link
                      href={`/fa/ledger?account=${r.account.id}&from=${from}&to=${to}${location ? `&location=${location}` : ""}`}
                      className="hover:text-link hover:underline"
                      data-testid="drill-link"
                    >
                      <span lang="en" className="font-mono text-muted-foreground">
                        {r.account.code}
                      </span>{" "}
                      {nameOf(r.account, locale)}
                    </Link>
                  </td>
                  <td className="hidden h-9 border-b border-hairline px-3 text-right font-mono @[44rem]:table-cell">
                    <DrCr balanceP={r.openingP} />
                  </td>
                  <td className="h-9 border-b border-hairline px-3 text-right font-mono">{r.debitP ? <MoneyText poisha={r.debitP} /> : null}</td>
                  <td className="h-9 border-b border-hairline px-3 text-right font-mono">{r.creditP ? <MoneyText poisha={r.creditP} /> : null}</td>
                  <td className="h-9 border-b border-hairline px-3 text-right font-mono">
                    <DrCr balanceP={r.closingP} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState icon={BookOpenText} title={general ? t("fa.ledger.noLines") : t("fa.ledger.chooseAccount")} />
      )}
    </div>
  )
}
