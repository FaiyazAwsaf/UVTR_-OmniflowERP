"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Package } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocLink } from "@/components/shared/doc-link"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { buttonVariants } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { Id, StockMoveRow } from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"

import { LocationSelect, NotFound, QtyText } from "./scm-ui"

type CardRow = {
  move: StockMoveRow
  balanceQty: number
  balanceValueP: number
  batchNo?: string
}

/** /ic/items/[id]: the stock card, every movement with the running quantity and value; the cutover balance brought forward. */
export function StockCard({
  itemId,
  locationId,
}: {
  itemId: string
  locationId?: string
}) {
  const db = useDb()
  const { t, tk, locale, dmy, time, unit } = useLocale()
  const [picked, setPicked] = React.useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const item = await db.items.get(itemId)
    if (!item) return { item: undefined }
    const [locations, values, moves] = await Promise.all([
      db.locations.toArray(),
      db.stockValues.where("itemId").equals(itemId).toArray(),
      db.stockMoves.where("itemId").equals(itemId).toArray(),
    ])
    const batchIds = [
      ...new Set(moves.map((m) => m.batchId).filter(Boolean) as Id[]),
    ]
    const batches = new Map(
      (await db.batches.bulkGet(batchIds))
        .filter(Boolean)
        .map((b) => [b!.id, b!.batchNo])
    )
    return {
      item,
      locations: locations.filter((l) => l.isStockLocation),
      values,
      moves,
      batches,
    }
  }, [db, itemId])

  const fallback = data?.item
    ? (data.values.find((v) => v.qtyBase > 0)?.locationId ??
      data.locations[0]?.id)
    : undefined
  const loc = picked ?? locationId ?? fallback ?? ""

  const rows = React.useMemo<CardRow[]>(() => {
    if (!data?.item) return []
    const moves = data.moves
      .filter((m) => m.locationId === loc)
      .sort((a, b) => a.at - b.at || (a.type === "opening" ? -1 : 1))
    let qty = 0
    let value = 0
    const out: CardRow[] = []
    for (const m of moves) {
      // Quarantine moves change the held quantity only, never the usable balance or value.
      if (m.type !== "quarantine" && m.type !== "quarantine-return") {
        qty = roundQty(qty + m.qtyBase)
        value += m.valueP
      }
      out.push({
        move: m,
        balanceQty: qty,
        balanceValueP: value,
        batchNo: m.batchId ? data.batches.get(m.batchId) : undefined,
      })
    }
    return out.reverse()
  }, [data, loc])

  const columns = React.useMemo<ColumnDef<CardRow, unknown>[]>(
    () => [
      {
        id: "date",
        header: t("ic.card.date"),
        accessorFn: (r) => r.move.at,
        cell: ({ row }) => (
          <span
            data-testid="stock-card-row"
            data-type={row.original.move.type}
            className="flex flex-col whitespace-nowrap"
          >
            <span className="nums">{dmy(row.original.move.date)}</span>
            <span className="nums text-[0.6875rem] text-muted-foreground">
              {time(row.original.move.at)}
            </span>
          </span>
        ),
      },
      {
        id: "doc",
        header: t("ic.card.document"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.move.type === "opening" ? (
            <span className="text-muted-foreground">
              {t("ic.card.broughtForward")}
            </span>
          ) : (
            <span className="flex flex-col">
              <DocLink
                docType={row.original.move.ref.docType}
                docId={row.original.move.ref.docId}
                docNo={row.original.move.ref.docNo}
              />
              <span className="text-[0.6875rem] text-muted-foreground">
                {tk(`reports.enum.moveType.${row.original.move.type}`)}
              </span>
            </span>
          ),
      },
      {
        id: "batch",
        header: t("ic.card.batch"),
        accessorFn: (r) => r.batchNo ?? "",
        cell: ({ row }) => (
          <span lang="en" className="font-mono text-xs whitespace-nowrap">
            {row.original.batchNo ?? "-"}
          </span>
        ),
        meta: { hideBelow: "lg" },
      },
      {
        id: "in",
        header: t("ic.card.in"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.move.qtyBase > 0 ? (
            <QtyText
              value={row.original.move.qtyBase}
              className={
                row.original.move.type === "quarantine"
                  ? "text-muted-foreground"
                  : "text-success"
              }
            />
          ) : (
            ""
          ),
        meta: { align: "right" },
      },
      {
        id: "out",
        header: t("ic.card.out"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.move.qtyBase < 0 ? (
            <QtyText
              value={-row.original.move.qtyBase}
              className="text-destructive"
            />
          ) : (
            ""
          ),
        meta: { align: "right" },
      },
      {
        id: "balance",
        header: t("ic.card.balance"),
        enableSorting: false,
        cell: ({ row }) => (
          <QtyText value={row.original.balanceQty} className="font-semibold" />
        ),
        meta: { align: "right" },
      },
      {
        id: "value",
        header: t("ic.card.value"),
        enableSorting: false,
        cell: ({ row }) => (
          <MoneyText poisha={row.original.move.valueP} signed colorize />
        ),
        meta: { align: "right", hideBelow: "md" },
      },
      {
        id: "balanceValue",
        header: t("ic.card.balanceValue"),
        enableSorting: false,
        cell: ({ row }) => <MoneyText poisha={row.original.balanceValueP} />,
        meta: { align: "right", hideBelow: "sm" },
      },
    ],
    [t, tk, dmy, time]
  )

  if (data === undefined) return null
  if (!data.item)
    return (
      <NotFound
        title={t("ic.card.notFound")}
        backHref="/ic"
        backLabel={t("ic.card.back")}
      />
    )
  const { item, locations, values } = data
  const v = values.find((x) => x.locationId === loc)

  return (
    <div className="flex flex-col gap-5" data-testid="stock-card">
      <section className="surface-card flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <span className="text-xs text-muted-foreground">
            {t("ic.card.title")}
          </span>
          <h1 className="text-xl font-semibold">{nameOf(item, locale)}</h1>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            <span lang="en" className="font-mono">
              {item.sku}
            </span>{" "}
            · {t("ic.card.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LocationSelect
            value={loc}
            onChange={(value) => setPicked(value)}
            locations={locations}
            includeAll={false}
          />
          <Link
            href={`/pm/items/${item.id}`}
            className={buttonVariants({ variant: "neutral" })}
          >
            <Package />
            {t("ic.card.item")}
          </Link>
        </div>
      </section>
      <section className="surface-card p-5">
        <KeyValueGrid
          columns={3}
          items={[
            {
              label: t("ic.card.onHand"),
              value: <QtyText value={v?.qtyBase ?? 0} uom={item.baseUom} />,
            },
            {
              label: t("ic.card.balanceValue"),
              value: <MoneyText poisha={v?.valueP ?? 0} />,
            },
            {
              label: `${t("ic.card.avgCost")} (${t("ic.ui.perUnit", { unit: unit(item.purchaseUom) })})`,
              value:
                v && v.qtyBase > 0 ? (
                  <MoneyText
                    poisha={Math.round(
                      (v.valueP / v.qtyBase) * item.purchaseFactor
                    )}
                  />
                ) : (
                  "-"
                ),
            },
          ]}
        />
      </section>
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.move.id}
        density="compact"
        emptyTitle={t("ic.card.noMoves")}
      />
    </div>
  )
}
