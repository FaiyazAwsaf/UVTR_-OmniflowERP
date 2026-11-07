"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ClipboardList, FilePlus2, FileText } from "lucide-react"

import { DataTable, TableSearch, type ColumnDef } from "@/components/motion/data-table"
import { DateText } from "@/components/shared/date-text"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { RegPlate } from "@/components/shared/reg-plate"
import { Button } from "@/components/ui/button"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow, QuotationRow, SalesOrderRow, VehicleRow } from "@/core/db/schema"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { ExportButton, StatusPills, StudioSelect, useStudio } from "./kit"
import { quoteStatus } from "./quote-view"

type QuoteRowView = QuotationRow & { party?: PartyRow; vehicle?: VehicleRow; shown: QuotationRow["status"] }
type OrderRowView = SalesOrderRow & { party?: PartyRow; vehicle?: VehicleRow }

async function withParties<T extends { partyId: string; vehicleId?: string }>(db: ReturnType<typeof useDb>, rows: T[]) {
  const parties = await db.parties.bulkGet([...new Set(rows.map((r) => r.partyId))])
  const vehicles = await db.vehicles.bulkGet([...new Set(rows.map((r) => r.vehicleId).filter((v): v is string => !!v))])
  const pm = new Map(parties.filter(Boolean).map((p) => [p!.id, p!]))
  const vm = new Map(vehicles.filter(Boolean).map((v) => [v!.id, v!]))
  return rows.map((r) => ({ ...r, party: pm.get(r.partyId), vehicle: r.vehicleId ? vm.get(r.vehicleId) : undefined }))
}

const searchable = (r: { party?: PartyRow; vehicle?: VehicleRow }, no: string) =>
  `${no} ${r.party?.nameEn ?? ""} ${r.party?.nameBn ?? ""} ${r.party?.phone ?? ""} ${r.vehicle?.regNo ?? ""}`.toLowerCase()

/** /stl/quotations: quotations of the studio with search, status filter and CSV. */
export function QuotationList() {
  const db = useDb()
  const router = useRouter()
  const { t, locale } = useLocale()
  const studio = useStudio()
  const canCreate = useCan("stl.quote.create", studio.locationId)
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const today = dhakaDate(now())
  const rows = useLiveQuery(async () => {
    if (!studio.locationId) return []
    const qs = await db.quotations.where("locationId").equals(studio.locationId).toArray()
    return (await withParties(db, qs))
      .map((q) => ({ ...q, shown: quoteStatus(q, today) }))
      .sort((a, b) => b.createdAt - a.createdAt) as QuoteRowView[]
  }, [db, studio.locationId, today])
  const filtered = (rows ?? []).filter((r) => (status === "all" || r.shown === status) && (!query || searchable(r, r.quoteNo).includes(query.toLowerCase())))
  const columns: ColumnDef<QuoteRowView, unknown>[] = [
    {
      accessorKey: "quoteNo",
      header: t("stl.list.quote"),
      cell: ({ row }) => (
        <Link href={`/stl/quotations/${row.original.id}`} className="font-mono text-link hover:underline" data-testid="quote-row" data-quote-no={row.original.quoteNo}>
          {row.original.quoteNo}
        </Link>
      ),
    },
    { id: "date", header: t("common.date"), cell: ({ row }) => <DateText value={row.original.createdAt} />, meta: { hideBelow: "md" } },
    { id: "party", header: t("common.customer"), cell: ({ row }) => <span className="truncate">{nameOf(row.original.party, locale)}</span> },
    { id: "vehicle", header: t("common.vehicle"), cell: ({ row }) => (row.original.vehicle ? <RegPlate regNo={row.original.vehicle.regNo} /> : "-"), meta: { hideBelow: "sm" } },
    { id: "status", header: t("common.status"), cell: ({ row }) => <DocStatus status={row.original.shown} /> },
    { id: "valid", header: t("stl.list.validUntil"), cell: ({ row }) => <DateText value={row.original.validUntil} />, meta: { hideBelow: "lg" } },
    { accessorKey: "totalP", header: t("common.total"), cell: ({ row }) => <MoneyText poisha={row.original.totalP} />, meta: { align: "right" } },
  ]
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("stl.pages.quotations")}
        subtitle={t("stl.list.quotesSubtitle")}
        actions={
          <>
            <StudioSelect value={studio.locationId} onChange={studio.setLocationId} studios={studio.studios} />
            <ExportButton
              permission="stl.export"
              fileName="quotations"
              rows={filtered.map((r) => ({ quoteNo: r.quoteNo, date: dhakaDate(r.createdAt), party: r.party?.nameEn, regNo: r.vehicle?.regNo, status: r.shown, totalP: r.totalP }))}
              columns={[
                { key: "quoteNo", label: t("stl.list.quote") },
                { key: "date", label: t("common.date") },
                { key: "party", label: t("common.customer") },
                { key: "regNo", label: t("common.vehicle") },
                { key: "status", label: t("common.status") },
                { key: "totalP", label: t("common.total") },
              ]}
            />
            {canCreate ? (
              <Button nativeButton={false} render={<Link href="/stl/quotations/new" />} data-testid="quote-new">
                <FilePlus2 data-icon="inline-start" />
                {t("stl.pages.quotationNew")}
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable
        data={filtered}
        columns={columns}
        rowId={(r) => r.id}
        onRowClick={(r) => router.push(`/stl/quotations/${r.id}`)}
        emptyIcon={<FileText />}
        emptyTitle={t("stl.list.noQuotes")}
        toolbar={
          <>
            <TableSearch value={query} onChange={setQuery} placeholder={t("stl.list.search")} />
            <StatusPills value={status} onChange={setStatus} options={["draft", "sent", "accepted", "expired"]} />
          </>
        }
      />
    </div>
  )
}

const ORDER_STATUSES = ["booked", "in-progress", "qc", "ready", "delivered", "invoiced", "closed", "cancelled"]

/** /stl/orders: orders of the studio with search, status filter and CSV. */
export function OrderList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale } = useLocale()
  const studio = useStudio()
  const canCreate = useCan("stl.order.create", studio.locationId)
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const rows = useLiveQuery(async () => {
    if (!studio.locationId) return []
    const orders = await db.salesOrders.where("locationId").equals(studio.locationId).toArray()
    return (await withParties(db, orders)).sort((a, b) => b.createdAt - a.createdAt) as OrderRowView[]
  }, [db, studio.locationId])
  const counts = React.useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of rows ?? []) out[r.status] = (out[r.status] ?? 0) + 1
    return out
  }, [rows])
  const filtered = (rows ?? []).filter((r) => (status === "all" || r.status === status) && (!query || searchable(r, r.orderNo).includes(query.toLowerCase())))
  const nowMs = now()
  const columns: ColumnDef<OrderRowView, unknown>[] = [
    {
      accessorKey: "orderNo",
      header: t("stl.list.order"),
      cell: ({ row }) => (
        <Link href={`/stl/orders/${row.original.id}`} className="font-mono text-link hover:underline" data-testid="order-row" data-order-no={row.original.orderNo}>
          {row.original.orderNo}
        </Link>
      ),
    },
    { accessorKey: "bookedOn", header: t("stl.list.booked"), cell: ({ row }) => <DateText value={row.original.bookedOn} />, meta: { hideBelow: "md" } },
    { id: "party", header: t("common.customer"), cell: ({ row }) => <span className="truncate">{nameOf(row.original.party, locale)}</span> },
    { id: "vehicle", header: t("common.vehicle"), cell: ({ row }) => (row.original.vehicle ? <RegPlate regNo={row.original.vehicle.regNo} /> : <span className="text-muted-foreground">{tk(`reports.enum.orderKind.${row.original.kind}`)}</span>), meta: { hideBelow: "sm" } },
    { id: "status", header: t("common.status"), cell: ({ row }) => <DocStatus status={row.original.status} /> },
    {
      id: "promised",
      header: t("stl.list.promised"),
      cell: ({ row }) => {
        const o = row.original
        const late = ["booked", "in-progress", "qc"].includes(o.status) && o.promisedAt < nowMs
        return <DateText value={o.promisedAt} variant="dmyTime" className={late ? "font-medium text-destructive" : undefined} />
      },
      meta: { hideBelow: "lg" },
    },
    { accessorKey: "advanceP", header: t("stl.list.advance"), cell: ({ row }) => (row.original.advanceP ? <MoneyText poisha={row.original.advanceP} /> : "-"), meta: { align: "right", hideBelow: "lg" } },
    { accessorKey: "totalP", header: t("common.total"), cell: ({ row }) => <MoneyText poisha={row.original.totalP} />, meta: { align: "right" } },
  ]
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("stl.pages.orders")}
        subtitle={t("stl.list.ordersSubtitle")}
        actions={
          <>
            <StudioSelect value={studio.locationId} onChange={studio.setLocationId} studios={studio.studios} />
            <ExportButton
              permission="stl.export"
              fileName="orders"
              rows={filtered.map((r) => ({ orderNo: r.orderNo, bookedOn: r.bookedOn, party: r.party?.nameEn, regNo: r.vehicle?.regNo, status: r.status, advanceP: r.advanceP, totalP: r.totalP }))}
              columns={[
                { key: "orderNo", label: t("stl.list.order") },
                { key: "bookedOn", label: t("stl.list.booked") },
                { key: "party", label: t("common.customer") },
                { key: "regNo", label: t("common.vehicle") },
                { key: "status", label: t("common.status") },
                { key: "advanceP", label: t("stl.list.advance") },
                { key: "totalP", label: t("common.total") },
              ]}
            />
            {canCreate ? (
              <Button nativeButton={false} render={<Link href="/stl/orders/new" />} data-testid="order-new">
                <ClipboardList data-icon="inline-start" />
                {t("stl.pages.orderNew")}
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable
        data={filtered}
        columns={columns}
        rowId={(r) => r.id}
        onRowClick={(r) => router.push(`/stl/orders/${r.id}`)}
        emptyIcon={<ClipboardList />}
        emptyTitle={t("stl.list.noOrders")}
        toolbar={
          <>
            <TableSearch value={query} onChange={setQuery} placeholder={t("stl.list.search")} />
            <StatusPills value={status} onChange={setStatus} options={ORDER_STATUSES} counts={counts} />
          </>
        }
      />
    </div>
  )
}
