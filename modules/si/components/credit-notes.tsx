"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Printer, Undo2 } from "lucide-react"

import { DataTable, TableSearch, type ColumnDef } from "@/components/motion/data-table"
import { ApprovalChip } from "@/components/shared/approval-chip"
import { DateText } from "@/components/shared/date-text"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { CreditNoteRow, Id, PartyRow, SalesInvoiceRow } from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { ExportButton, PrintDialog, StatusPills, StudioSelect, useStudio } from "@/modules/stl/components/kit"

import { Mushak67 } from "./mushak"

type Row = CreditNoteRow & { party?: PartyRow; invoice?: SalesInvoiceRow }

/**
 * /si/credit-notes: Mushak 6.7 credit notes of the studio with their
 * status (posted, pending approval, rejected), the split between the
 * invoice and the customer's advance, and the print. `?id=` opens one.
 */
export function CreditNoteList() {
  const db = useDb()
  const params = useSearchParams()
  const { t, locale } = useLocale()
  const studio = useStudio()
  const loc = studio.locationId
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [printId, setPrintId] = React.useState<Id | null>(params.get("id"))
  const data = useLiveQuery(async () => {
    if (!loc) return null
    const notes = (await db.creditNotes.where("locationId").equals(loc).toArray()).sort((a, b) => b.createdAt - a.createdAt)
    const parties = new Map((await db.parties.bulkGet([...new Set(notes.map((n) => n.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const invoices = new Map((await db.salesInvoices.bulkGet([...new Set(notes.map((n) => n.invoiceId))])).filter(Boolean).map((i) => [i!.id, i!]))
    const rows: Row[] = notes.map((n) => ({ ...n, party: parties.get(n.partyId), invoice: invoices.get(n.invoiceId) }))
    return rows
  }, [db, loc])
  const printing = data?.find((n) => n.id === printId)
  const printLines = useLiveQuery(() => (printing ? db.salesInvoiceLines.where("invoiceId").equals(printing.invoiceId).toArray() : []), [db, printing?.invoiceId])
  const q = query.toLowerCase()
  const rows = (data ?? []).filter((r) => (status === "all" || r.status === status) && (!q || `${r.creditNoteNo} ${r.invoice?.invoiceNo ?? ""} ${r.party?.nameEn ?? ""}`.toLowerCase().includes(q)))
  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: "creditNoteNo",
      header: t("si.credit.number"),
      cell: ({ row }) => (
        <button type="button" lang="en" onClick={() => setPrintId(row.original.id)} className="font-mono text-link hover:underline" data-testid="credit-note-row" data-no={row.original.creditNoteNo}>
          {row.original.creditNoteNo}
        </button>
      ),
    },
    { accessorKey: "date", header: t("common.date"), cell: ({ row }) => <DateText value={row.original.date} />, meta: { hideBelow: "md" } },
    { id: "invoice", header: t("si.list.invoice"), cell: ({ row }) => (row.original.invoice ? <DocLink docType="salesInvoices" docId={row.original.invoice.id} docNo={row.original.invoice.invoiceNo} showApp={false} /> : "-"), meta: { hideBelow: "sm" } },
    { id: "party", header: t("common.customer"), cell: ({ row }) => <span className="truncate">{nameOf(row.original.party, locale)}</span> },
    { id: "reason", header: t("common.reason"), cell: ({ row }) => <span className="line-clamp-1 text-muted-foreground">{row.original.reason}</span>, meta: { hideBelow: "lg" } },
    { accessorKey: "totalP", header: t("common.total"), cell: ({ row }) => <MoneyText poisha={row.original.totalP} />, meta: { align: "right" } },
    { id: "advance", header: t("si.credit.toAdvance"), cell: ({ row }) => (row.original.toAdvanceP ? <MoneyText poisha={row.original.toAdvanceP} /> : "-"), meta: { align: "right", hideBelow: "lg" } },
    {
      id: "status",
      header: t("common.status"),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <DocStatus status={row.original.status} />
          {row.original.status === "pending-approval" && row.original.approvalId ? <ApprovalChip approvalId={row.original.approvalId} className="hidden @min-[56rem]/table:inline-flex" /> : null}
        </span>
      ),
    },
    {
      id: "print",
      header: "",
      cell: ({ row }) => (
        <Button variant="link" size="sm" onClick={() => setPrintId(row.original.id)}>
          <Printer className="size-3.5" />
          {t("common.print")}
        </Button>
      ),
      meta: { hideBelow: "sm" },
    },
  ]
  return (
    <div className="flex flex-col gap-4" data-testid="credit-notes">
      <PageHeader
        title={t("si.pages.creditNotes")}
        subtitle={t("si.credit.subtitle")}
        actions={
          <>
            <StudioSelect value={loc} onChange={studio.setLocationId} studios={studio.studios} />
            <ExportButton
              permission="si.export"
              fileName="credit-notes"
              rows={rows.map((r) => ({ creditNoteNo: r.creditNoteNo, date: r.date, invoiceNo: r.invoice?.invoiceNo, party: r.party?.nameEn, totalP: r.totalP, toAdvanceP: r.toAdvanceP ?? 0, status: r.status }))}
              columns={[
                { key: "creditNoteNo", label: t("si.credit.number") },
                { key: "date", label: t("common.date") },
                { key: "invoiceNo", label: t("si.list.invoice") },
                { key: "party", label: t("common.customer") },
                { key: "totalP", label: t("common.total") },
                { key: "toAdvanceP", label: t("si.credit.toAdvance") },
                { key: "status", label: t("common.status") },
              ]}
            />
          </>
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.id}
        emptyIcon={<Undo2 />}
        emptyTitle={t("si.credit.none")}
        emptyHint={t("si.credit.noneHint")}
        toolbar={
          <>
            <TableSearch value={query} onChange={setQuery} placeholder={t("si.credit.search")} />
            <StatusPills value={status} onChange={setStatus} options={["posted", "pending-approval", "rejected"]} />
          </>
        }
      />
      {printing ? (
        <PrintDialog open={!!printing} onOpenChange={(o) => !o && setPrintId(null)} title={t("si.credit.printTitle")} docNo={printing.creditNoteNo}>
          <Mushak67 note={printing} invoice={printing.invoice} lines={printLines ?? []} party={printing.party} />
        </PrintDialog>
      ) : null}
    </div>
  )
}
