"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { PackagePlus } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { StatusText } from "@/components/shared/status"
import {
  DataTable,
  TableSearch,
  type ColumnDef,
} from "@/components/motion/data-table"
import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { ItemCategoryRow, ItemRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import {
  ExportCsvButton,
  ItemCell,
  ListToolbar,
  OptionSelect,
  QtyText,
} from "@/modules/ic/components/scm-ui"

import { ItemFormDialog } from "./item-form"

type Row = { item: ItemRow; category?: ItemCategoryRow; onHand: number }

/** /pm: the item master (search, category, kind, status) with on-hand totals. */
export function ItemsList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, num, unit } = useLocale()
  const { can } = usePermissions()
  const [search, setSearch] = React.useState("")
  const [category, setCategory] = React.useState("all")
  const [kind, setKind] = React.useState("all")
  const [status, setStatus] = React.useState("active")
  const [creating, setCreating] = React.useState(false)

  const data = useLiveQuery(async () => {
    const [items, categories, values] = await Promise.all([
      db.items.toArray(),
      db.itemCategories.toArray(),
      db.stockValues.toArray(),
    ])
    const onHand = new Map<string, number>()
    for (const v of values)
      onHand.set(v.itemId, roundQty((onHand.get(v.itemId) ?? 0) + v.qtyBase))
    const cats = new Map(categories.map((c) => [c.id, c]))
    return {
      categories,
      rows: items
        .sort((a, b) => a.sku.localeCompare(b.sku))
        .map((item): Row => ({
          item,
          category: cats.get(item.categoryId),
          onHand: onHand.get(item.id) ?? 0,
        })),
    }
  }, [db])

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.rows ?? []).filter(
      (r) =>
        (category === "all" || r.item.categoryId === category) &&
        (kind === "all" || r.item.kind === kind) &&
        (status === "all" || r.item.status === status) &&
        (!q ||
          `${r.item.sku} ${r.item.nameEn} ${r.item.nameBn} ${r.item.barcode} ${r.item.brand ?? ""}`
            .toLowerCase()
            .includes(q))
    )
  }, [data, search, category, kind, status])

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "item",
        header: t("ic.ui.item"),
        accessorFn: (r) => r.item.sku,
        cell: ({ row }) => (
          <span
            data-testid="item-row"
            data-sku={row.original.item.sku}
            className="block min-w-44"
          >
            <ItemCell item={row.original.item} />
          </span>
        ),
      },
      {
        id: "category",
        header: t("pm.list.category"),
        accessorFn: (r) => r.category?.nameEn ?? "",
        cell: ({ row }) => nameOf(row.original.category, locale),
        meta: { hideBelow: "md" },
      },
      {
        id: "kind",
        header: t("pm.list.kind"),
        accessorFn: (r) => r.item.kind,
        cell: ({ row }) => tk(`pm.kind.${row.original.item.kind}`),
        meta: { hideBelow: "lg" },
      },
      {
        id: "units",
        header: t("pm.list.units"),
        enableSorting: false,
        cell: ({ row }) => (
          <span
            lang="en"
            className="font-mono text-xs whitespace-nowrap text-muted-foreground"
          >
            {row.original.item.baseUom} · {row.original.item.purchaseUom} ×
            {num(row.original.item.purchaseFactor)}
          </span>
        ),
        meta: { hideBelow: "lg" },
      },
      {
        id: "cost",
        header: t("pm.list.standardCost"),
        accessorFn: (r) => r.item.standardCostP,
        cell: ({ row }) => (
          <span className="flex flex-col items-end">
            <MoneyText poisha={row.original.item.standardCostP} />
            <span className="text-[0.6875rem] text-muted-foreground">
              {t("pm.list.perUnit", {
                unit: unit(row.original.item.purchaseUom),
              })}
            </span>
          </span>
        ),
        meta: { align: "right", hideBelow: "sm" },
      },
      {
        id: "retail",
        header: t("pm.list.retailPrice"),
        accessorFn: (r) => r.item.retailPriceP ?? 0,
        cell: ({ row }) =>
          row.original.item.retailPriceP !== undefined ? (
            <MoneyText poisha={row.original.item.retailPriceP} />
          ) : (
            "-"
          ),
        meta: { align: "right", hideBelow: "lg" },
      },
      {
        id: "onHand",
        header: t("pm.list.onHand"),
        accessorFn: (r) => r.onHand,
        cell: ({ row }) => (
          <QtyText
            value={row.original.onHand}
            uom={row.original.item.baseUom}
          />
        ),
        meta: { align: "right" },
      },
      {
        id: "status",
        header: t("pm.list.status"),
        accessorFn: (r) => r.item.status,
        cell: ({ row }) => (
          <StatusText
            tone={row.original.item.status === "active" ? "success" : "muted"}
            dot
          >
            {tk(`shared.status.${row.original.item.status}`)}
          </StatusText>
        ),
        meta: { hideBelow: "md" },
      },
    ],
    [t, tk, locale, num, unit]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("pm.list.title")}
        subtitle={t("pm.list.subtitle")}
        actions={
          can("pm.item.create") ? (
            <Button onClick={() => setCreating(true)} data-testid="item-new">
              <PackagePlus />
              {t("pm.list.newItem")}
            </Button>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.item.id}
        onRowClick={(r) => router.push(`/pm/items/${r.item.id}`)}
        emptyTitle={t("pm.list.empty")}
        toolbar={
          <ListToolbar
            actions={
              <ExportCsvButton
                permission="ic.export"
                fileName="items"
                columns={[
                  { key: "sku", label: "SKU" },
                  { key: "name", label: t("ic.ui.item") },
                  { key: "category", label: t("pm.list.category") },
                  { key: "kind", label: t("pm.list.kind") },
                  { key: "baseUom", label: t("pm.item.baseUnit") },
                  { key: "purchaseUom", label: t("pm.item.purchaseUnit") },
                  { key: "purchaseFactor", label: t("pm.form.purchaseFactor") },
                  { key: "standardCostP", label: t("pm.list.standardCost") },
                  { key: "retailPriceP", label: t("pm.list.retailPrice") },
                  { key: "onHand", label: t("pm.list.onHand") },
                  { key: "status", label: t("pm.list.status") },
                ]}
                rows={() =>
                  rows.map((r) => ({
                    sku: r.item.sku,
                    name: nameOf(r.item, locale),
                    category: nameOf(r.category, locale),
                    kind: tk(`pm.kind.${r.item.kind}`),
                    baseUom: r.item.baseUom,
                    purchaseUom: r.item.purchaseUom,
                    purchaseFactor: r.item.purchaseFactor,
                    standardCostP: r.item.standardCostP,
                    retailPriceP: r.item.retailPriceP ?? null,
                    onHand: r.onHand,
                    status: r.item.status,
                  }))
                }
              />
            }
          >
            <TableSearch
              value={search}
              onChange={setSearch}
              placeholder={t("pm.list.search")}
            />
            <OptionSelect
              value={category}
              onChange={setCategory}
              label={t("pm.list.category")}
              testId="filter-category"
              options={[
                { value: "all", label: t("pm.list.allCategories") },
                ...(data?.categories ?? []).map((c) => ({
                  value: c.id,
                  label: nameOf(c, locale),
                })),
              ]}
            />
            <OptionSelect
              value={kind}
              onChange={setKind}
              label={t("pm.list.kind")}
              testId="filter-kind"
              options={[
                { value: "all", label: t("pm.list.allKinds") },
                ...(["chemical", "consumable", "retail"] as const).map((k) => ({
                  value: k,
                  label: t(`pm.kind.${k}`),
                })),
              ]}
            />
            <OptionSelect
              value={status}
              onChange={setStatus}
              label={t("pm.list.status")}
              testId="filter-status"
              options={[
                { value: "all", label: t("pm.list.allStatuses") },
                { value: "active", label: tk("shared.status.active") },
                { value: "inactive", label: tk("shared.status.inactive") },
              ]}
            />
          </ListToolbar>
        }
      />
      <ItemFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => router.push(`/pm/items/${id}`)}
      />
    </div>
  )
}
