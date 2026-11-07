"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { ShieldAlert } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { buttonVariants } from "@/components/ui/button"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { GrnRow, PurchaseOrderRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { ListToolbar, LocationSelect, RowLink, useScmLookups } from "@/modules/ic/components/scm-ui"

type PoRow = PurchaseOrderRow & { accepted: number; pending: number }
type GrnListRow = GrnRow & { accepted: number; rejected: number; valueP: number; poNo: string }

/** /grn: purchase orders awaiting goods (issued, partly received) and the recent GRNs. */
export function AwaitingGoods() {
  const db = useDb()
  const { t, locale, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const today = dhakaDate(useNow(60_000))
  const [location, setLocation] = React.useState("all")

  const data = useLiveQuery(async () => {
    const pos = (await db.purchaseOrders.toArray()).filter((p) => p.status === "issued" || p.status === "partial")
    const rows: PoRow[] = []
    for (const po of pos) {
      const lines = await db.poLines.where("poId").equals(po.id).toArray()
      const accepted = lines.reduce((s, l) => s + (l.qtyReceived - l.qtyRejected), 0)
      const ordered = lines.reduce((s, l) => s + l.qty, 0)
      rows.push({ ...po, accepted: roundQty(accepted), pending: roundQty(Math.max(0, ordered - accepted)) })
    }
    const grns = (await db.grns.orderBy("date").reverse().limit(40).toArray()) as GrnRow[]
    const recent: GrnListRow[] = []
    for (const g of grns) {
      const lines = await db.grnLines.where("grnId").equals(g.id).toArray()
      recent.push({
        ...g,
        accepted: lines.reduce((s, l) => s + l.qtyAccepted, 0),
        rejected: lines.reduce((s, l) => s + l.qtyRejected, 0),
        valueP: lines.reduce((s, l) => s + Math.round(l.qtyAccepted * l.unitCostP), 0),
        poNo: (await db.purchaseOrders.get(g.poId))?.poNo ?? "",
      })
    }
    const held = await db.grnLines.where("quarantineStatus").equals("held").count()
    return { rows: rows.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)), recent, held }
  }, [db])

  const rows = (data?.rows ?? []).filter((r) => location === "all" || r.locationId === location)
  const loc = (id: string) => nameOf(lookups?.locations.get(id), locale)
  const vendor = (id: string) => nameOf(lookups?.vendors.get(id), locale)

  const columns = React.useMemo<ColumnDef<PoRow, unknown>[]>(
    () => [
      {
        id: "po",
        header: t("grn.home.po"),
        accessorFn: (r) => r.poNo,
        cell: ({ row }) => (
          <span data-testid="awaiting-po" data-po-no={row.original.poNo}>
            <DocLink docType="purchaseOrders" docId={row.original.id} docNo={row.original.poNo} showApp={false} />
          </span>
        ),
      },
      { id: "vendor", header: t("grn.home.vendor"), accessorFn: (r) => r.vendorId, cell: ({ row }) => <span className="block max-w-56 truncate">{vendor(row.original.vendorId)}</span> },
      { id: "location", header: t("grn.home.location"), accessorFn: (r) => r.locationId, cell: ({ row }) => loc(row.original.locationId), meta: { hideBelow: "lg" } },
      {
        id: "expected",
        header: t("grn.home.expected"),
        accessorFn: (r) => r.expectedDate,
        cell: ({ row }) => (
          <span className={cn("nums", row.original.expectedDate < today && "text-destructive")}>
            {dmy(row.original.expectedDate)}
            {row.original.expectedDate < today ? <span className="block text-[0.6875rem]">{t("grn.home.overdue")}</span> : null}
          </span>
        ),
        meta: { hideBelow: "sm" },
      },
      {
        id: "progress",
        header: t("grn.home.progress"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="nums text-[0.8125rem]">{t("grn.progress", { accepted: num(row.original.accepted), pending: num(row.original.pending) })}</span>
        ),
        meta: { hideBelow: "md" },
      },
      { id: "status", header: t("grn.home.status"), accessorFn: (r) => r.status, cell: ({ row }) => <DocStatus status={row.original.status} /> },
      {
        id: "action",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          can("grn.receive.create", row.original.locationId) ? (
            <RowLink href={`/grn/receive/${row.original.id}`} testId="grn-receive">
              {t("grn.home.receive")}
            </RowLink>
          ) : null,
        meta: { align: "right" },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, num, dmy, today, can, lookups, locale]
  )

  const recentColumns = React.useMemo<ColumnDef<GrnListRow, unknown>[]>(
    () => [
      {
        id: "grn",
        header: t("grn.home.grnNo"),
        accessorFn: (r) => r.grnNo,
        cell: ({ row }) => <DocLink docType="grns" docId={row.original.id} docNo={row.original.grnNo} showApp={false} />,
      },
      { id: "date", header: t("grn.home.date"), accessorFn: (r) => r.receivedAt, cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span>, meta: { hideBelow: "sm" } },
      { id: "po", header: t("grn.home.po"), accessorFn: (r) => r.poNo, cell: ({ row }) => <span lang="en" className="font-mono text-xs">{row.original.poNo}</span>, meta: { hideBelow: "md" } },
      { id: "vendor", header: t("grn.home.vendor"), accessorFn: (r) => r.vendorId, cell: ({ row }) => <span className="block max-w-48 truncate">{vendor(row.original.vendorId)}</span>, meta: { hideBelow: "lg" } },
      { id: "accepted", header: t("grn.home.accepted"), accessorFn: (r) => r.accepted, cell: ({ row }) => num(row.original.accepted), meta: { align: "right" } },
      {
        id: "rejected",
        header: t("grn.home.rejected"),
        accessorFn: (r) => r.rejected,
        cell: ({ row }) => <span className={row.original.rejected ? "text-warning" : "text-muted-foreground"}>{num(row.original.rejected)}</span>,
        meta: { align: "right", hideBelow: "sm" },
      },
      { id: "value", header: t("grn.home.value"), accessorFn: (r) => r.valueP, cell: ({ row }) => <MoneyText poisha={row.original.valueP} />, meta: { align: "right" } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, num, dmy, lookups, locale]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("grn.home.title")}
        subtitle={t("grn.home.subtitle")}
        actions={
          data?.held ? (
            <Link href="/grn/quarantine" className={buttonVariants({ variant: "outline" })} data-testid="quarantine-link">
              <ShieldAlert />
              {t("grn.home.quarantineHeld", { count: num(data.held) })}
            </Link>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.id}
        emptyTitle={t("grn.home.empty")}
        toolbar={
          <ListToolbar>
            <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
          </ListToolbar>
        }
      />
      <SectionCard title={t("grn.home.recent")}>
        <DataTable data={data?.recent ?? []} columns={recentColumns} rowId={(r) => r.id} density="compact" pageSize={10} bare />
      </SectionCard>
    </div>
  )
}
