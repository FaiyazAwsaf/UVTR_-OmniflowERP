"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangle, Coins, PackageX, Truck } from "lucide-react"

import { DataTable, TableSearch, type ColumnDef } from "@/components/motion/data-table"
import { StockBadge } from "@/components/shared/doc-status"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { useDb } from "@/core/db/DbProvider"
import { useSession } from "@/core/session/session"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { loadStockRows, type StockRow } from "../queries"
import { ExportCsvButton, ItemCell, ListToolbar, LocationSelect, OptionSelect, QtyText, useScmLookups } from "./scm-ui"

/** /ic: stock by location with value, reorder status (Low, Out), quarantine and stock in transit. */
export function StockByLocation() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, money, num, dmy } = useLocale()
  const session = useSession()
  const lookups = useScmLookups()
  const [location, setLocation] = React.useState<string | null>(null)
  const [category, setCategory] = React.useState("all")
  const [status, setStatus] = React.useState("all")
  const [search, setSearch] = React.useState("")

  // Default: the window's current location when it holds stock, else every location.
  const defaultLocation = lookups?.stockLocations.some((l) => l.id === session.locationId) ? session.locationId! : "all"
  const loc = location ?? defaultLocation

  const data = useLiveQuery(async () => {
    const rows = await loadStockRows(db)
    const dispatched = await db.transfers.where("status").equals("dispatched").toArray()
    let transitValue = 0
    for (const tr of dispatched) for (const l of await db.transferLines.where("transferId").equals(tr.id).toArray()) transitValue += l.valueP
    return { rows, transitValue, transfers: dispatched.length }
  }, [db])

  const scoped = React.useMemo(() => (data?.rows ?? []).filter((r) => loc === "all" || r.location.id === loc), [data, loc])
  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(
      (r) =>
        (category === "all" || r.item.categoryId === category) &&
        (status === "all" || r.status === status || (status === "transit" && r.inTransitQty > 0)) &&
        (!q || `${r.item.sku} ${r.item.nameEn} ${r.item.nameBn}`.toLowerCase().includes(q))
    )
  }, [scoped, search, category, status])

  const kpi = React.useMemo(() => {
    const value = scoped.reduce((s, r) => s + r.valueP, 0)
    return {
      value,
      lines: scoped.filter((r) => r.qtyBase > 0).length,
      low: scoped.filter((r) => r.status === "low").length,
      out: scoped.filter((r) => r.status === "out").length,
    }
  }, [scoped])

  const columns = React.useMemo<ColumnDef<StockRow, unknown>[]>(
    () => [
      {
        id: "item",
        header: t("ic.stock.item"),
        accessorFn: (r) => r.item.sku,
        cell: ({ row }) => (
          <span data-testid="stock-row" data-sku={row.original.item.sku} data-location={row.original.location.code} className="block min-w-40">
            <ItemCell item={row.original.item} />
          </span>
        ),
      },
      {
        id: "location",
        header: t("ic.stock.location"),
        accessorFn: (r) => r.location.code,
        cell: ({ row }) => nameOf(row.original.location, locale),
        meta: { hideBelow: "md" },
      },
      {
        id: "onHand",
        header: t("ic.stock.onHand"),
        accessorFn: (r) => r.qtyBase,
        cell: ({ row }) => (
          <span className="flex flex-col items-end">
            <QtyText value={row.original.qtyBase} uom={row.original.item.baseUom} />
            {row.original.quarantinedQty > 0 ? (
              <span className="text-[0.6875rem] text-muted-foreground">
                {t("ic.stock.quarantine")} {num(row.original.quarantinedQty)}
              </span>
            ) : null}
          </span>
        ),
        meta: { align: "right" },
      },
      {
        id: "transit",
        header: t("ic.stock.inTransit"),
        accessorFn: (r) => r.inTransitQty,
        cell: ({ row }) => (row.original.inTransitQty > 0 ? <QtyText value={row.original.inTransitQty} className="text-info" /> : "-"),
        meta: { align: "right", hideBelow: "lg" },
      },
      {
        id: "min",
        header: t("ic.stock.min"),
        accessorFn: (r) => r.minQty ?? -1,
        cell: ({ row }) => (row.original.minQty !== undefined ? <QtyText value={row.original.minQty} /> : "-"),
        meta: { align: "right", hideBelow: "md" },
      },
      {
        id: "value",
        header: t("ic.stock.value"),
        accessorFn: (r) => r.valueP,
        cell: ({ row }) => <MoneyText poisha={row.original.valueP} />,
        meta: { align: "right", hideBelow: "sm" },
      },
      {
        id: "avg",
        header: t("ic.stock.avgCost"),
        accessorFn: (r) => (r.qtyBase > 0 ? r.valueP / r.qtyBase : 0),
        cell: ({ row }) =>
          row.original.qtyBase > 0 ? (
            <span className="flex flex-col items-end">
              <MoneyText poisha={Math.round((row.original.valueP / row.original.qtyBase) * row.original.item.purchaseFactor)} />
              <span className="text-[0.6875rem] text-muted-foreground">{t("ic.ui.perUnit", { unit: row.original.item.purchaseUom })}</span>
            </span>
          ) : (
            "-"
          ),
        meta: { align: "right", hideBelow: "lg" },
      },
      {
        id: "expiry",
        header: t("ic.stock.nearestExpiry"),
        accessorFn: (r) => r.nearestExpiry ?? "9999",
        cell: ({ row }) => (row.original.nearestExpiry ? <span className="nums">{dmy(row.original.nearestExpiry)}</span> : "-"),
        meta: { hideBelow: "lg" },
      },
      {
        id: "status",
        header: t("ic.stock.status"),
        accessorFn: (r) => r.status,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            <StockBadge status={row.original.status} />
            {row.original.inTransitQty > 0 ? <StockBadge status="in-transit" /> : null}
          </span>
        ),
      },
    ],
    [t, locale, num, dmy]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("ic.stock.title")} subtitle={t("ic.stock.subtitle")} />
      <KpiGrid>
        <KpiCard variant="cyan" icon={Coins} title={t("ic.stock.kpiValue")} value={money(kpi.value)} caption={t("ic.stock.kpiItemsCaption", { count: num(kpi.lines) })} />
        <KpiCard variant="yellow" icon={AlertTriangle} title={t("ic.stock.kpiLow")} value={num(kpi.low)} onClick={() => setStatus("low")} />
        <KpiCard variant="pink" icon={PackageX} title={t("ic.stock.kpiOut")} value={num(kpi.out)} onClick={() => setStatus("out")} />
        <KpiCard
          variant="purple"
          icon={Truck}
          title={t("ic.stock.kpiTransit")}
          value={money(data?.transitValue ?? 0)}
          caption={t("ic.stock.kpiTransitCaption", { count: num(data?.transfers ?? 0) })}
          href="/st/transfers"
        />
      </KpiGrid>
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.key}
        onRowClick={(r) => router.push(`/ic/items/${r.item.id}?location=${r.location.id}`)}
        emptyTitle={t("ic.stock.empty")}
        toolbar={
          <ListToolbar
            actions={
              <ExportCsvButton
                permission="ic.export"
                fileName="stock-by-location"
                columns={[
                  { key: "sku", label: "SKU" },
                  { key: "item", label: t("ic.stock.item") },
                  { key: "location", label: t("ic.stock.location") },
                  { key: "qty", label: t("ic.stock.onHand") },
                  { key: "unit", label: t("pm.item.baseUnit") },
                  { key: "inTransit", label: t("ic.stock.inTransit") },
                  { key: "min", label: t("ic.stock.min") },
                  { key: "valueP", label: t("ic.stock.value") },
                  { key: "expiry", label: t("ic.stock.nearestExpiry") },
                  { key: "status", label: t("ic.stock.status") },
                ]}
                rows={() =>
                  rows.map((r) => ({
                    sku: r.item.sku,
                    item: nameOf(r.item, locale),
                    location: nameOf(r.location, locale),
                    qty: r.qtyBase,
                    unit: r.item.baseUom,
                    inTransit: r.inTransitQty,
                    min: r.minQty ?? null,
                    valueP: r.valueP,
                    expiry: r.nearestExpiry ?? null,
                    status: tk(`shared.status.${r.status}`),
                  }))
                }
              />
            }
          >
            <TableSearch value={search} onChange={setSearch} placeholder={t("ic.ui.search")} />
            <LocationSelect value={loc} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
            <OptionSelect
              value={category}
              onChange={setCategory}
              label={t("ic.stock.category")}
              options={[{ value: "all", label: t("ic.stock.allCategories") }, ...[...(lookups?.categories.values() ?? [])].map((c) => ({ value: c.id, label: nameOf(c, locale) }))]}
            />
            <OptionSelect
              value={status}
              onChange={setStatus}
              label={t("ic.stock.status")}
              testId="filter-status"
              options={[
                { value: "all", label: t("ic.stock.allStatus") },
                { value: "ok", label: tk("shared.status.ok") },
                { value: "low", label: tk("shared.status.low") },
                { value: "out", label: tk("shared.status.out") },
                { value: "transit", label: tk("shared.status.in-transit") },
              ]}
            />
          </ListToolbar>
        }
      />
    </div>
  )
}
