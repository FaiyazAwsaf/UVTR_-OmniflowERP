"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCircle2, XCircle } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { useDb } from "@/core/db/DbProvider"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { CsvButton, ListTable, Pills, SearchBox, useToday, type Column } from "@/modules/par/components/kit"

import { BUCKETS, type Bucket } from "../lib"
import { loadAging, type AgingRow } from "../queries"

/**
 * AR or AP aging (accounting_rules.md §6): open amounts by party in buckets
 * of days PAST the due date (0 to 30, 31 to 60, 61 to 90, over 90), not yet
 * due separate; the total ties to the control account, and for AR the
 * customer advances (beside) tie to 2130.
 */
export function AgingView({ side }: { side: "ar" | "ap" }) {
  const db = useDb()
  const today = useToday()
  const { t, tk, locale, num, money, dmy } = useLocale()
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState("all")
  const data = useLiveQuery(async () => (today ? loadAging(db, today, side) : undefined), [db, today, side])
  const ns = side === "ar" ? "ar" : "ap"

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.rows ?? []).filter((r) => {
      if (filter === "overdue" && r.buckets.total - r.buckets.current <= 0) return false
      if (side === "ap" && r.buckets.total === 0) return false
      if (!q) return true
      return (r.party?.nameEn.toLowerCase().includes(q) ?? false) || (r.party?.code.toLowerCase().includes(q) ?? false) || (r.party?.nameBn.includes(query.trim()) ?? false)
    })
  }, [data, query, filter, side])

  const bucketCol = (b: Bucket): Column<AgingRow> => ({
    key: b,
    header: tk(`reports.enum.bucket.${b}`),
    align: "right",
    hide: b === "current" ? "md" : b === "d0_30" ? "sm" : "lg",
    sortValue: (r) => r.buckets[b],
    cell: (r) =>
      r.buckets[b] ? (
        <MoneyText poisha={r.buckets[b]} className={cn("font-mono", b === "over90" || b === "d61_90" ? "text-destructive" : undefined)} />
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  })
  const columns: Column<AgingRow>[] = [
    {
      key: "party",
      header: t(`${ns}.aging.colParty` as "ar.aging.colParty"),
      sortValue: (r) => r.party?.nameEn ?? "",
      cell: (r) => (
        <Link href={side === "ar" ? `/par/${r.partyId}` : `/par/${r.partyId}`} className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-link hover:underline">{nameOf(r.party, locale)}</span>
          <span lang="en" className="font-mono text-xs text-muted-foreground">
            {r.party?.code}
          </span>
        </Link>
      ),
    },
    ...BUCKETS.map(bucketCol),
    {
      key: "total",
      header: t("ar.aging.colTotal"),
      align: "right",
      sortValue: (r) => r.buckets.total,
      cell: (r) => <MoneyText poisha={r.buckets.total} className="font-mono font-semibold" />,
    },
    ...(side === "ar"
      ? [
          {
            key: "advance",
            header: t("ar.aging.colAdvance"),
            align: "right" as const,
            hide: "md" as const,
            sortValue: (r: AgingRow) => r.advanceP,
            cell: (r: AgingRow) => (r.advanceP ? <MoneyText poisha={r.advanceP} className="font-mono text-info" /> : <span className="text-muted-foreground">-</span>),
          },
        ]
      : []),
  ]

  const footer: Partial<Record<string, React.ReactNode>> = { party: t("ar.aging.total") }
  if (data) {
    for (const b of BUCKETS) footer[b] = <MoneyText poisha={data.totals[b]} className="font-mono" />
    footer.total = (
      <span data-testid="aging-total" data-total={data.totals.total}>
        <MoneyText poisha={data.totals.total} className="font-mono" />
      </span>
    )
    if (side === "ar") footer.advance = <MoneyText poisha={data.advancesP} className="font-mono" />
  }
  const tie = data ? data.totals.total - data.controlP : 0
  const advTie = data ? data.advancesP - data.advanceGlP : 0

  return (
    <div className="flex flex-col gap-4" data-testid={`${side}-aging`}>
      <PageHeader
        title={t(`${ns}.pages.aging` as "ar.pages.aging")}
        subtitle={t(`${ns}.aging.subtitle` as "ar.aging.subtitle")}
        actions={
          <CsvButton
            exportKey={`${side}.export`}
            fileName={`${side}-aging`}
            rows={rows.map((r) => ({
              party: r.party?.nameEn ?? r.partyId,
              code: r.party?.code ?? "",
              currentP: r.buckets.current,
              d0_30P: r.buckets.d0_30,
              d31_60P: r.buckets.d31_60,
              d61_90P: r.buckets.d61_90,
              over90P: r.buckets.over90,
              totalP: r.buckets.total,
              advanceP: r.advanceP,
            }))}
            columns={[
              { key: "party", label: t("ar.aging.colParty") },
              { key: "code", label: "Code" },
              ...BUCKETS.map((b) => ({ key: `${b}P`, label: tk(`reports.enum.bucket.${b}`) })),
              { key: "totalP", label: t("ar.aging.colTotal") },
              ...(side === "ar" ? [{ key: "advanceP", label: t("ar.aging.colAdvance") }] : []),
            ]}
          />
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-muted-foreground">{today ? t("ar.aging.asOf", { date: dmy(today) }) : null}</span>
          {data ? (
            <span className={cn("flex items-center gap-1.5", tie === 0 ? "text-success" : "text-destructive")} data-testid="aging-tie" data-tie={tie === 0}>
              {tie === 0 ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
              {tie === 0 ? t(`${ns}.aging.ties` as "ar.aging.ties") : t(`${ns}.aging.tiesNot` as "ar.aging.tiesNot", { amount: money(tie) })}
            </span>
          ) : null}
          {data && side === "ar" ? (
            <span className={cn("flex items-center gap-1.5", advTie === 0 ? "text-success" : "text-destructive")} data-testid="advance-tie">
              {advTie === 0 ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
              {advTie === 0 ? t("ar.aging.advancesTie") : t("ar.aging.advancesNot", { amount: money(advTie) })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} />
          <Pills
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("common.all") },
              { value: "overdue", label: t("ar.aging.onlyOverdue") },
            ]}
          />
          <span className="ml-auto text-xs text-muted-foreground">{t("ar.aging.count", { count: num(rows.length) })}</span>
        </div>
        <ListTable rows={data ? rows : undefined} columns={columns} rowKey={(r) => r.partyId} rowTestId="aging-row" footer={footer} pageSize={40} dense />
      </section>
    </div>
  )
}
