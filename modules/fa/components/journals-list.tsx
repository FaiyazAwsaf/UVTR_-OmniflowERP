"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { FileText, Plus } from "lucide-react"

import { DataTable, TableSearch, type ColumnDef } from "@/components/motion/data-table"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDb } from "@/core/db/DbProvider"
import type { JournalRow, JournalStatus, VoucherType } from "@/core/db/schema"
import { useCan } from "@/core/security/useCan"
import { useUserMap, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { usePeriods } from "../queries"
import { CsvButton, PeriodSelect, Toolbar } from "./common"

const TYPES: VoucherType[] = ["JV", "PV", "RV", "CV", "SV", "PJ", "IV", "SM", "OB", "YC"]
const STATUSES: JournalStatus[] = ["draft", "pending-approval", "posted", "reversed", "discarded"]

/**
 * The voucher list (plan §9 `/fa/journals`): every voucher, manual and from
 * the other apps, by type and status; search by number, narration or source
 * document; filter by month; CSV for holders of fa.export. Live.
 */
export function JournalsList() {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const { t, tk, dmy, num, locale } = useLocale()
  const users = useUserMap()
  const periods = usePeriods()
  const canCreate = useCan("fa.journal.create")
  const [type, setType] = React.useState<string>(params.get("type") ?? "all")
  const [status, setStatus] = React.useState<string>(params.get("status") ?? "all")
  const [month, setMonth] = React.useState<string>(params.get("month") ?? "all")
  const [query, setQuery] = React.useState(params.get("q") ?? "")

  const journals = useLiveQuery(async () => {
    let rows: JournalRow[]
    if (month !== "all") {
      const period = await db.periods.where("month").equals(month).first()
      rows = period ? await db.journals.where("periodId").equals(period.id).toArray() : []
    } else if (status !== "all") {
      rows = await db.journals.where("status").equals(status).toArray()
    } else if (type !== "all") {
      rows = await db.journals.where("voucherType").equals(type).toArray()
    } else {
      rows = await db.journals.toArray()
    }
    return rows
      .filter((j) => (type === "all" || j.voucherType === type) && (status === "all" || j.status === status))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  }, [db, type, status, month])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !journals) return journals ?? []
    return journals.filter(
      (j) =>
        j.journalNo.toLowerCase().includes(q) ||
        j.narration.toLowerCase().includes(q) ||
        (j.source?.docNo ?? "").toLowerCase().includes(q)
    )
  }, [journals, query])

  const columns = React.useMemo<ColumnDef<JournalRow, unknown>[]>(
    () => [
      {
        id: "no",
        header: t("fa.journals.number"),
        accessorKey: "journalNo",
        cell: ({ row }) => (
          <Link
            href={`/fa/journals/${row.original.id}`}
            data-testid="journal-row"
            data-journal-no={row.original.journalNo}
            data-status={row.original.status}
            lang="en"
            className="font-mono font-medium text-link hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.journalNo}
          </Link>
        ),
      },
      { id: "date", header: t("fa.common.date"), accessorKey: "date", cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span> },
      {
        id: "type",
        header: t("fa.common.type"),
        accessorKey: "voucherType",
        meta: { hideBelow: "md" },
        cell: ({ row }) => <span className="text-muted-foreground">{tk(`fa.voucherTypes.${row.original.voucherType}`)}</span>,
      },
      {
        id: "narration",
        header: t("fa.common.narration"),
        accessorKey: "narration",
        meta: { hideBelow: "lg" },
        cell: ({ row }) => <span className="line-clamp-1 max-w-[28rem]">{row.original.narration}</span>,
      },
      {
        id: "source",
        header: t("fa.common.source"),
        enableSorting: false,
        meta: { hideBelow: "sm" },
        cell: ({ row }) =>
          row.original.source && row.original.source.docType !== "journals" ? (
            <span onClick={(e) => e.stopPropagation()}>
              <DocLink docType={row.original.source.docType} docId={row.original.source.docId} docNo={row.original.source.docNo} />
            </span>
          ) : (
            <span className="text-muted-foreground">{t("fa.common.manual")}</span>
          ),
      },
      {
        id: "preparedBy",
        header: t("fa.common.preparedBy"),
        meta: { hideBelow: "lg" },
        accessorFn: (j) => userName(users.get(j.preparedBy), locale),
      },
      {
        id: "amount",
        header: t("fa.common.amount"),
        accessorKey: "totalP",
        meta: { align: "right", className: "font-mono" },
        cell: ({ row }) => <MoneyText poisha={row.original.totalP} />,
      },
      { id: "status", header: t("fa.common.status"), accessorKey: "status", cell: ({ row }) => <DocStatus status={row.original.status} /> },
    ],
    [t, tk, dmy, users, locale]
  )

  const csvColumns = [
    { key: "journalNo", label: t("fa.journals.number") },
    { key: "date", label: t("fa.common.date") },
    { key: "voucherType", label: t("fa.common.type") },
    { key: "narration", label: t("fa.common.narration") },
    { key: "source", label: t("fa.common.source") },
    { key: "totalP", label: t("fa.common.amount") },
    { key: "status", label: t("fa.common.status") },
  ]

  return (
    <div className="flex flex-col gap-5" data-testid="journals-list">
      <PageHeader
        title={t("fa.journals.title")}
        subtitle={t("fa.journals.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="fa.export"
              fileName="vouchers"
              columns={csvColumns}
              rows={() =>
                filtered.map((j) => ({
                  journalNo: j.journalNo,
                  date: j.date,
                  voucherType: j.voucherType,
                  narration: j.narration,
                  source: j.source?.docNo ?? "",
                  totalP: j.totalP,
                  status: j.status,
                }))
              }
            />
            {canCreate ? (
              <Button nativeButton={false} render={<Link href="/fa/journals/new" />} data-testid="journal-new">
                <Plus />
                {t("fa.journals.newVoucher")}
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable
        data={filtered}
        columns={columns}
        rowId={(j) => j.id}
        onRowClick={(j) => router.push(`/fa/journals/${j.id}`)}
        density="compact"
        emptyIcon={<FileText />}
        emptyTitle={t("fa.journals.empty")}
        toolbar={
          <Toolbar className="w-full">
            <TableSearch value={query} onChange={setQuery} placeholder={t("fa.common.search")} />
            <Select value={type} onValueChange={(v) => v && setType(v as string)}>
              <SelectTrigger className="min-w-36" data-testid="journal-filter-type" aria-label={t("fa.common.type")}>
                <SelectValue>{() => (type === "all" ? t("fa.common.allTypes") : tk(`fa.voucherTypes.${type}`))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("fa.common.allTypes")}</SelectItem>
                {TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {tk(`fa.voucherTypes.${v}`)}
                    <span lang="en" className="ml-auto pl-3 font-mono text-xs text-muted-foreground">
                      {v}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => v && setStatus(v as string)}>
              <SelectTrigger className="min-w-36" data-testid="journal-filter-status" aria-label={t("fa.common.status")}>
                <SelectValue>{() => (status === "all" ? t("fa.common.allStatuses") : tk(`shared.status.${status}`))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("fa.common.allStatuses")}</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {tk(`shared.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PeriodSelect
              periods={[...(periods ?? [])]}
              value={month === "all" ? "" : month}
              onChange={setMonth}
              testId="journal-filter-month"
            />
            {month !== "all" ? (
              <Button variant="ghost" size="sm" onClick={() => setMonth("all")}>
                {t("fa.common.allPeriods")}
              </Button>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground" data-testid="journal-count">
              {t("fa.journals.count", { count: num(filtered.length) })}
            </span>
          </Toolbar>
        }
      />
    </div>
  )
}
