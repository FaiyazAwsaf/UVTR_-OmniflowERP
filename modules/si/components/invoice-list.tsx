"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Banknote, FilePlus2, FileText, Receipt, Smartphone, Undo2 } from "lucide-react"

import { DataTable, TableSearch, type ColumnDef } from "@/components/motion/data-table"
import { DateText } from "@/components/shared/date-text"
import { DocStatus } from "@/components/shared/doc-status"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { invoiceOpen } from "@/core/ar/receipt"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow, SalesInvoiceRow } from "@/core/db/schema"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { ExportButton, StatusPills, StudioSelect, useStudio } from "@/modules/stl/components/kit"

type Row = SalesInvoiceRow & { party?: PartyRow; dueP: number; overdue: boolean }

/** /si: the studio's tax invoices with today's figures, search, status filter and CSV. */
export function InvoiceList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, money, num } = useLocale()
  const studio = useStudio()
  const loc = studio.locationId
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs || Date.now())
  const canIssue = useCan("si.invoice.issue", loc)
  const canCounter = useCan("si.counter.checkout", loc)
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const data = useLiveQuery(async () => {
    if (!loc) return null
    const invoices = (await db.salesInvoices.where("locationId").equals(loc).toArray()).sort((a, b) => b.issuedAt - a.issuedAt)
    const parties = new Map((await db.parties.bulkGet([...new Set(invoices.map((i) => i.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const receipts = (await db.receipts.where("date").equals(today).toArray()).filter((r) => r.locationId === loc)
    const credits = (await db.creditNotes.where("locationId").equals(loc).toArray()).filter((c) => c.date.slice(0, 7) === today.slice(0, 7))
    const rows: Row[] = invoices.map((i) => {
      const dueP = invoiceOpen(i)
      return { ...i, party: parties.get(i.partyId), dueP, overdue: dueP > 0 && i.dueDate < today }
    })
    return {
      rows,
      todayCount: invoices.filter((i) => i.date === today).length,
      todayTotal: invoices.filter((i) => i.date === today).reduce((s, i) => s + i.totalP, 0),
      collected: receipts.filter((r) => r.status === "posted").reduce((s, r) => s + r.amountP, 0),
      pending: receipts.filter((r) => r.status === "pending").length,
      credits: credits.filter((c) => c.status === "posted").reduce((s, c) => s + c.totalP, 0),
    }
  }, [db, loc, today])
  const q = query.toLowerCase()
  const rows = (data?.rows ?? []).filter(
    (r) => (status === "all" || (status === "overdue" ? r.overdue : r.status === status)) && (!q || `${r.invoiceNo} ${r.party?.nameEn ?? ""} ${r.party?.nameBn ?? ""}`.toLowerCase().includes(q))
  )
  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: "invoiceNo",
      header: t("si.list.invoice"),
      cell: ({ row }) => (
        <Link href={`/si/${row.original.id}`} lang="en" className="font-mono text-link hover:underline" data-testid="invoice-row" data-invoice-no={row.original.invoiceNo}>
          {row.original.invoiceNo}
        </Link>
      ),
    },
    { accessorKey: "date", header: t("common.date"), cell: ({ row }) => <DateText value={row.original.date} />, meta: { hideBelow: "md" } },
    { id: "kind", header: t("si.list.kind"), cell: ({ row }) => tk(`reports.enum.invoiceKind.${row.original.kind}`), meta: { hideBelow: "lg" } },
    { id: "party", header: t("common.customer"), cell: ({ row }) => <span className="truncate">{nameOf(row.original.party, locale)}</span> },
    { accessorKey: "totalP", header: t("common.total"), cell: ({ row }) => <MoneyText poisha={row.original.totalP} />, meta: { align: "right" } },
    { accessorKey: "dueP", header: t("common.due"), cell: ({ row }) => (row.original.dueP ? <MoneyText poisha={row.original.dueP} className={row.original.overdue ? "text-destructive" : undefined} /> : "-"), meta: { align: "right", hideBelow: "sm" } },
    { id: "status", header: t("common.status"), cell: ({ row }) => <DocStatus status={row.original.overdue ? "overdue" : row.original.status} /> },
  ]
  return (
    <div className="flex flex-col gap-4" data-testid="invoice-list">
      <PageHeader
        title={t("si.pages.home")}
        subtitle={t("si.list.subtitle")}
        actions={
          <>
            <StudioSelect value={loc} onChange={studio.setLocationId} studios={studio.studios} />
            <ExportButton
              permission="si.export"
              fileName="invoices"
              rows={rows.map((r) => ({ invoiceNo: r.invoiceNo, date: r.date, kind: r.kind, party: r.party?.nameEn, totalP: r.totalP, dueP: r.dueP, status: r.status }))}
              columns={[
                { key: "invoiceNo", label: t("si.list.invoice") },
                { key: "date", label: t("common.date") },
                { key: "kind", label: t("si.list.kind") },
                { key: "party", label: t("common.customer") },
                { key: "totalP", label: t("common.total") },
                { key: "dueP", label: t("common.due") },
                { key: "status", label: t("common.status") },
              ]}
            />
            {canCounter ? (
              <Button variant="outline" nativeButton={false} render={<Link href="/si/counter" />}>
                <Receipt data-icon="inline-start" />
                {t("si.pages.counter")}
              </Button>
            ) : null}
            {canIssue ? (
              <Button nativeButton={false} render={<Link href="/si/new" />} data-testid="invoice-new">
                <FilePlus2 data-icon="inline-start" />
                {t("si.pages.invoiceNew")}
              </Button>
            ) : null}
          </>
        }
      />
      <KpiGrid>
        <KpiCard variant="cyan" icon={FileText} title={t("si.list.kpiInvoices")} value={money(data?.todayTotal ?? 0)} caption={t("si.list.kpiCount", { count: num(data?.todayCount ?? 0) })} />
        <KpiCard variant="yellow" icon={Banknote} title={t("si.list.kpiCollected")} value={money(data?.collected ?? 0)} />
        <KpiCard variant="pink" icon={Smartphone} title={t("si.list.kpiPending")} value={num(data?.pending ?? 0)} href="/si/counter" />
        <KpiCard variant="purple" icon={Undo2} title={t("si.list.kpiCredits")} value={money(data?.credits ?? 0)} href="/si/credit-notes" />
      </KpiGrid>
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.id}
        onRowClick={(r) => router.push(`/si/${r.id}`)}
        emptyIcon={<FileText />}
        emptyTitle={t("si.list.none")}
        toolbar={
          <>
            <TableSearch value={query} onChange={setQuery} placeholder={t("si.list.search")} />
            <StatusPills value={status} onChange={setStatus} options={["posted", "partially-paid", "paid", "credited", "overdue"]} />
          </>
        }
      />
    </div>
  )
}
