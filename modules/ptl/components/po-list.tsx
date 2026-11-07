"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ShoppingCart } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { buttonVariants } from "@/components/ui/button"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { PurchaseOrderRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { ExportCsvButton, ListToolbar, LocationSelect, OptionSelect, useScmLookups } from "@/modules/ic/components/scm-ui"
import { TableSearch } from "@/components/motion/data-table"

/** /ptl/po: purchase orders (issued, partial, received, closed) with search, filters and CSV export. */
export function PoList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, dmy, time } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const today = dhakaDate(useNow(60_000))
  const [status, setStatus] = React.useState("all")
  const [location, setLocation] = React.useState("all")
  const [search, setSearch] = React.useState("")
  const pos = useLiveQuery(() => db.purchaseOrders.orderBy("orderDate").reverse().toArray(), [db])
  const rows = (pos ?? []).filter((p) => {
    const q = search.trim().toLowerCase()
    const vendor = lookups?.vendors.get(p.vendorId)
    return (
      (status === "all" || p.status === status) &&
      (location === "all" || p.locationId === location) &&
      (!q || `${p.poNo} ${vendor?.nameEn ?? ""} ${vendor?.nameBn ?? ""}`.toLowerCase().includes(q))
    )
  })

  const columns = React.useMemo<ColumnDef<PurchaseOrderRow, unknown>[]>(
    () => [
      {
        id: "no",
        header: t("ptl.po.no"),
        accessorFn: (p) => p.poNo,
        cell: ({ row }) => (
          <span lang="en" className="font-mono text-link" data-testid="po-row" data-po-no={row.original.poNo}>
            {row.original.poNo}
          </span>
        ),
      },
      { id: "date", header: t("ptl.po.date"), accessorFn: (p) => p.orderDate, cell: ({ row }) => <span className="nums">{dmy(row.original.orderDate)}</span>, meta: { hideBelow: "md" } },
      {
        id: "vendor",
        header: t("ptl.po.vendor"),
        accessorFn: (p) => lookups?.vendors.get(p.vendorId)?.nameEn ?? "",
        cell: ({ row }) => <span className="block max-w-56 truncate">{nameOf(lookups?.vendors.get(row.original.vendorId), locale)}</span>,
      },
      {
        id: "location",
        header: t("ptl.po.location"),
        accessorFn: (p) => p.locationId,
        cell: ({ row }) => nameOf(lookups?.locations.get(row.original.locationId), locale),
        meta: { hideBelow: "lg" },
      },
      {
        id: "expected",
        header: t("ptl.po.expected"),
        accessorFn: (p) => p.expectedDate,
        cell: ({ row }) => {
          const late = (row.original.status === "issued" || row.original.status === "partial") && row.original.expectedDate < today
          return <span className={cn("nums", late && "text-destructive")}>{dmy(row.original.expectedDate)}</span>
        },
        meta: { hideBelow: "sm" },
      },
      { id: "total", header: t("ptl.po.total"), accessorFn: (p) => p.totalP, cell: ({ row }) => <MoneyText poisha={row.original.totalP} />, meta: { align: "right" } },
      {
        id: "sent",
        header: t("ptl.po.sent"),
        accessorFn: (p) => p.sentAt ?? 0,
        cell: ({ row }) => (row.original.sentAt ? <span className="nums text-muted-foreground">{time(row.original.sentAt)}</span> : <span className="text-muted-foreground">-</span>),
        meta: { hideBelow: "lg" },
      },
      { id: "status", header: t("ptl.po.status"), accessorFn: (p) => p.status, cell: ({ row }) => <DocStatus status={row.original.status} /> },
    ],
    [t, locale, dmy, time, lookups, today]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("ptl.po.title")}
        subtitle={t("ptl.po.subtitle")}
        actions={
          can("ptl.po.create") ? (
            <Link href="/ptl/po/new" className={buttonVariants()} data-testid="po-new">
              <ShoppingCart />
              {t("ptl.po.new")}
            </Link>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowId={(p) => p.id}
        onRowClick={(p) => router.push(`/ptl/po/${p.id}`)}
        emptyTitle={t("ptl.po.empty")}
        toolbar={
          <ListToolbar
            actions={
              <ExportCsvButton
                permission="ptl.export"
                fileName="purchase-orders"
                columns={[
                  { key: "no", label: t("ptl.po.no") },
                  { key: "date", label: t("ptl.po.date") },
                  { key: "vendor", label: t("ptl.po.vendor") },
                  { key: "location", label: t("ptl.po.location") },
                  { key: "expected", label: t("ptl.po.expected") },
                  { key: "subtotalP", label: t("ptl.po.subtotal") },
                  { key: "vatP", label: t("ptl.po.vat") },
                  { key: "totalP", label: t("ptl.po.total") },
                  { key: "status", label: t("ptl.po.status") },
                ]}
                rows={() =>
                  rows.map((p) => ({
                    no: p.poNo,
                    date: p.orderDate,
                    vendor: nameOf(lookups?.vendors.get(p.vendorId), locale),
                    location: nameOf(lookups?.locations.get(p.locationId), locale),
                    expected: p.expectedDate,
                    subtotalP: p.subtotalP,
                    vatP: p.vatP,
                    totalP: p.totalP,
                    status: tk(`shared.status.${p.status}`),
                  }))
                }
              />
            }
          >
            <TableSearch value={search} onChange={setSearch} />
            <OptionSelect
              value={status}
              onChange={setStatus}
              label={t("ptl.po.status")}
              testId="po-status-filter"
              options={[
                { value: "all", label: t("ptl.po.allStatuses") },
                ...(["pending-approval", "issued", "partial", "received", "closed", "cancelled"] as const).map((s) => ({ value: s, label: tk(`shared.status.${s}`) })),
              ]}
            />
            <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
          </ListToolbar>
        }
      />
    </div>
  )
}
