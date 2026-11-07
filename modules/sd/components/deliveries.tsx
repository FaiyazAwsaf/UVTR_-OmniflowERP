"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { PackageOpen, Printer, Truck, Undo2 } from "lucide-react"

import { DataTable, TableSearch, type ColumnDef } from "@/components/motion/data-table"
import { DateText } from "@/components/shared/date-text"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PrintLayout } from "@/components/shared/print-layout"
import { RegPlate } from "@/components/shared/reg-plate"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { locationById } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { CreditNoteRow, DeliveryLineRow, DeliveryRow, Id, ItemRow, PartyRow, SalesOrderRow, VehicleRow } from "@/core/db/schema"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { PrintDialog, StudioSelect, useStudio, useUserMap } from "@/modules/stl/components/kit"

import { GatePass } from "./handover"

type Row = DeliveryRow & { order?: SalesOrderRow; party?: PartyRow; vehicle?: VehicleRow; lines: DeliveryLineRow[] }
type ReturnRow = CreditNoteRow & { party?: PartyRow; invoiceNo?: string }

/**
 * /sd/deliveries: delivery history (vehicle handovers with their gate
 * passes, goods challans) and returns (credit notes that restocked goods).
 * `?id=<deliveryId>` opens that delivery's print.
 */
export function DeliveryHistory() {
  const db = useDb()
  const params = useSearchParams()
  const { t, locale } = useLocale()
  const studio = useStudio()
  const users = useUserMap()
  const loc = studio.locationId
  const [tab, setTab] = React.useState<"deliveries" | "returns">("deliveries")
  const [query, setQuery] = React.useState("")
  const [printId, setPrintId] = React.useState<Id | null>(params.get("id"))

  const data = useLiveQuery(async () => {
    if (!loc) return null
    const deliveries = (await db.deliveries.where("locationId").equals(loc).toArray()).sort((a, b) => b.deliveredAt - a.deliveredAt)
    const orders = new Map((await db.salesOrders.bulkGet([...new Set(deliveries.map((d) => d.orderId))])).filter(Boolean).map((o) => [o!.id, o!]))
    const parties = new Map((await db.parties.bulkGet([...new Set([...orders.values()].map((o) => o.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const vehicles = new Map((await db.vehicles.bulkGet([...new Set([...orders.values()].map((o) => o.vehicleId).filter((v): v is string => !!v))])).filter(Boolean).map((v) => [v!.id, v!]))
    const goodsIds = deliveries.filter((d) => d.kind === "goods" || printId === d.id).map((d) => d.id)
    const lines = await db.deliveryLines.where("deliveryId").anyOf(goodsIds).toArray()
    const items = new Map((await db.items.bulkGet([...new Set(lines.map((l) => l.itemId))])).filter(Boolean).map((i) => [i!.id, i!]))
    const rows: Row[] = deliveries.map((d) => {
      const order = orders.get(d.orderId)
      return { ...d, order, party: order ? parties.get(order.partyId) : undefined, vehicle: order?.vehicleId ? vehicles.get(order.vehicleId) : undefined, lines: lines.filter((l) => l.deliveryId === d.id) }
    })
    const credits = (await db.creditNotes.where("locationId").equals(loc).toArray()).filter((c) => c.restock).sort((a, b) => b.createdAt - a.createdAt)
    const cParties = new Map((await db.parties.bulkGet([...new Set(credits.map((c) => c.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const invoices = new Map((await db.salesInvoices.bulkGet(credits.map((c) => c.invoiceId))).filter(Boolean).map((i) => [i!.id, i!]))
    const returns: ReturnRow[] = credits.map((c) => ({ ...c, party: cParties.get(c.partyId), invoiceNo: invoices.get(c.invoiceId)?.invoiceNo }))
    return { rows, returns, items }
  }, [db, loc, printId])

  const q = query.toLowerCase()
  const rows = (data?.rows ?? []).filter((r) => !q || `${r.deliveryNo} ${r.gatePassNo ?? ""} ${r.order?.orderNo ?? ""} ${r.party?.nameEn ?? ""} ${r.vehicle?.regNo ?? ""}`.toLowerCase().includes(q))
  const printing = data?.rows.find((r) => r.id === printId)

  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: "deliveryNo",
      header: t("sd.history.delivery"),
      cell: ({ row }) => (
        <button type="button" onClick={() => setPrintId(row.original.id)} lang="en" className="font-mono whitespace-nowrap text-link hover:underline" data-testid="delivery-row" data-delivery-no={row.original.deliveryNo}>
          {row.original.deliveryNo}
        </button>
      ),
    },
    { id: "kind", header: t("sd.history.kind"), cell: ({ row }) => t(`sd.history.kinds.${row.original.kind}`) },
    { id: "at", header: t("common.date"), cell: ({ row }) => <DateText value={row.original.deliveredAt} variant="dmyTime" />, meta: { hideBelow: "md" } },
    { id: "order", header: t("stl.pages.order"), cell: ({ row }) => (row.original.order ? <DocLink docType="salesOrders" docId={row.original.order.id} docNo={row.original.order.orderNo} showApp={false} /> : "-"), meta: { hideBelow: "lg" } },
    { id: "party", header: t("common.customer"), cell: ({ row }) => <span className="truncate">{nameOf(row.original.party, locale)}</span> },
    { id: "vehicle", header: t("common.vehicle"), cell: ({ row }) => (row.original.vehicle ? <RegPlate regNo={row.original.vehicle.regNo} /> : "-"), meta: { hideBelow: "sm" } },
    { id: "gp", header: t("sd.history.gatePass"), cell: ({ row }) => <span lang="en" className="font-mono text-xs whitespace-nowrap">{row.original.gatePassNo ?? "-"}</span>, meta: { hideBelow: "lg" } },
    { id: "by", header: t("sd.history.by"), cell: ({ row }) => userName(users.get(row.original.deliveredBy), locale), meta: { hideBelow: "lg" } },
    {
      id: "print",
      header: "",
      cell: ({ row }) => (
        <Button variant="link" size="sm" onClick={() => setPrintId(row.original.id)}>
          <Printer className="size-3.5" />
          {t("common.print")}
        </Button>
      ),
    },
  ]
  const returnColumns: ColumnDef<ReturnRow, unknown>[] = [
    { accessorKey: "creditNoteNo", header: t("sd.history.return"), cell: ({ row }) => <DocLink docType="creditNotes" docId={row.original.id} docNo={row.original.creditNoteNo} showApp={false} /> },
    { accessorKey: "date", header: t("common.date"), cell: ({ row }) => <DateText value={row.original.date} /> },
    { id: "invoice", header: t("stl.order.invoice"), cell: ({ row }) => <span lang="en" className="font-mono text-xs">{row.original.invoiceNo}</span>, meta: { hideBelow: "md" } },
    { id: "party", header: t("common.customer"), cell: ({ row }) => nameOf(row.original.party, locale) },
    { id: "status", header: t("common.status"), cell: ({ row }) => <DocStatus status={row.original.status} /> },
    { accessorKey: "totalP", header: t("common.total"), cell: ({ row }) => <MoneyText poisha={row.original.totalP} />, meta: { align: "right" } },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="sd-deliveries">
      <PageHeader
        title={t("sd.pages.deliveries")}
        subtitle={t("sd.history.subtitle")}
        actions={<StudioSelect value={loc} onChange={studio.setLocationId} studios={studio.studios} />}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="deliveries" data-testid="tab-deliveries">
            <Truck className="size-4" />
            {t("sd.history.deliveries")}
          </TabsTrigger>
          <TabsTrigger value="returns" data-testid="tab-returns">
            <Undo2 className="size-4" />
            {t("sd.history.returns")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "deliveries" ? (
        <DataTable data={rows} columns={columns} rowId={(r) => r.id} emptyIcon={<Truck />} emptyTitle={t("sd.history.none")} toolbar={<TableSearch value={query} onChange={setQuery} placeholder={t("sd.history.search")} />} />
      ) : (
        <DataTable data={data?.returns ?? []} columns={returnColumns} rowId={(r) => r.id} emptyIcon={<PackageOpen />} emptyTitle={t("sd.history.noReturns")} emptyHint={t("sd.history.returnsHint")} />
      )}
      {printing ? (
        <PrintDialog
          open={!!printing}
          onOpenChange={(open) => !open && setPrintId(null)}
          title={printing.kind === "goods" ? t("sd.history.challan") : t("sd.handover.gatePass")}
          docNo={printing.gatePassNo ?? printing.deliveryNo}
          wide={printing.kind === "goods"}
        >
          {printing.kind === "goods" ? (
            <Challan row={printing} items={data?.items ?? new Map()} />
          ) : printing.order ? (
            <GatePass delivery={printing} order={printing.order} party={printing.party} vehicle={printing.vehicle} users={users} />
          ) : null}
        </PrintDialog>
      ) : null}
    </div>
  )
}

/** Delivery challan for goods (stock leaves the studio). */
function Challan({ row, items }: { row: Row; items: Map<Id, ItemRow> }) {
  const { t, locale, num } = useLocale()
  const byItem = new Map<Id, number>()
  for (const l of row.lines) byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + l.qtyBase)
  return (
    <PrintLayout title={t("sd.history.challan")} docNo={row.deliveryNo} location={locationById(row.locationId)?.code} meta={<DateText value={row.deliveredAt} variant="dmyTime" />}>
      <div className="mb-3 text-[0.75rem]">
        <div className="font-semibold">{nameOf(row.party, locale)}</div>
        <div lang="en" className="font-mono">{row.order?.orderNo}</div>
      </div>
      <table className="w-full text-[0.75rem]">
        <thead>
          <tr className="text-left">
            <th className="border-b border-[#111] py-1">SKU</th>
            <th className="border-b border-[#111] py-1">{t("common.item")}</th>
            <th className="border-b border-[#111] py-1 text-right">{t("common.qty")}</th>
          </tr>
        </thead>
        <tbody>
          {[...byItem].map(([itemId, qty]) => {
            const item = items.get(itemId)
            return (
              <tr key={itemId}>
                <td lang="en" className="border-b border-[#ddd] py-1 font-mono">{item?.sku}</td>
                <td className="border-b border-[#ddd] py-1">{nameOf(item, locale)}</td>
                <td className="border-b border-[#ddd] py-1 text-right font-mono">{num(qty)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-10 grid grid-cols-2 gap-8 text-[0.6875rem]">
        <div className="border-t border-[#111] pt-1">{t("sd.handover.releasedBy")}</div>
        <div className="border-t border-[#111] pt-1">{t("sd.history.receivedBy")}</div>
      </div>
    </PrintLayout>
  )
}
