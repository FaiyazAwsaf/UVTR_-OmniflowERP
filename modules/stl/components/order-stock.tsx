"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  PackageX,
} from "lucide-react"

import { SectionCard } from "@/components/shared/section-card"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { SalesOrderLineRow, SalesOrderRow } from "@/core/db/schema"
import { useCan } from "@/core/security/useCan"
import { LOC } from "@/core/seed/content/seed-refs"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { useCatalogue } from "@/modules/pc/queries"

import { readOrderStockCheck, type StockCheckRow } from "../stock-check"

/** Where a studio asks for stock (plan §10 E3; ST prefills its request form from these params). */
export function transferRequestHref(
  order: Pick<SalesOrderRow, "locationId" | "orderNo">,
  row: StockCheckRow
): string {
  const q = new URLSearchParams({
    new: "1",
    from: LOC.CST,
    to: order.locationId,
    item: row.item.id,
    qty: String(row.requestQty),
    order: order.orderNo,
  })
  return `/st/transfers?${q.toString()}`
}

/**
 * Stock for a job (E3) on the order page: each recipe consumable the
 * unfinished work needs against what the studio can issue today (live), and
 * for a short item a "Request transfer" link to ST, prefilled with the
 * shortfall rounded up to whole purchase units from the Central Store, for
 * users who may request transfers into this studio.
 */
export function OrderStockCheck({
  order,
  lines,
}: {
  order: SalesOrderRow
  lines: SalesOrderLineRow[]
}) {
  const db = useDb()
  const { t, locale, num } = useLocale()
  const catalogue = useCatalogue()
  const canRequest = useCan("st.transfer.request", order.locationId)
  const [expanded, setExpanded] = React.useState(false)
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs || now())
  const openKey = lines
    .filter((l) => l.kind === "service" && l.status === "open")
    .map((l) => l.id)
    .join(",")
  const rows = useLiveQuery(
    async () =>
      catalogue && openKey
        ? readOrderStockCheck(db, catalogue, {
            locationId: order.locationId,
            lines,
            on: today,
          })
        : [],
    // `lines` changes with `openKey`; the query re-runs on stock changes by itself.
    [db, catalogue, order.locationId, openKey, today]
  )
  if (!rows?.length) return null
  const short = rows.filter((r) => r.shortQty > 0)
  const qty = (value: number, uom: string) =>
    `${num(value, { maximumFractionDigits: 2 })} ${uom}`
  // Everything on the shelf: one quiet line, the items on request.
  const showRows = short.length > 0 || expanded

  return (
    <div data-testid="order-stock-check" data-short={short.length > 0}>
      <SectionCard
        title={t("stl.stock.title")}
        subtitle={short.length ? t("stl.stock.hint") : t("stl.stock.allOk")}
        icon={short.length ? PackageX : PackageCheck}
        size="sm"
        action={
          short.length ? (
            <StatusPill tone="destructive" dot>
              {t("stl.stock.short", { count: num(short.length) })}
            </StatusPill>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              data-testid="order-stock-toggle"
            >
              {expanded ? (
                <ChevronUp data-icon="inline-start" />
              ) : (
                <ChevronDown data-icon="inline-start" />
              )}
              {t(expanded ? "stl.stock.hide" : "stl.stock.show", {
                count: num(rows.length),
              })}
            </Button>
          )
        }
      >
        {showRows ? (
          <div className="@container/stk overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="text-left">
                  <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">
                    {t("stl.stock.item")}
                  </th>
                  <th className="bg-surface-raised px-3 py-2 text-right font-medium">
                    {t("stl.stock.needed")}
                  </th>
                  <th className="bg-surface-raised px-3 py-2 text-right font-medium">
                    {t("stl.stock.usable")}
                  </th>
                  <th className="rounded-r-md bg-surface-raised px-3 py-2 text-right font-medium">
                    <span className="sr-only">{t("common.status")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isShort = r.shortQty > 0
                  return (
                    <tr
                      key={r.item.id}
                      data-testid="order-stock-row"
                      data-sku={r.item.sku}
                      data-short={isShort}
                    >
                      <td className="border-b border-hairline px-3 py-2">
                        <div className="truncate">
                          {locale === "bn" ? r.item.nameBn : r.item.nameEn}
                        </div>
                        <div
                          lang="en"
                          className="font-mono text-xs text-muted-foreground"
                        >
                          {r.item.sku}
                        </div>
                      </td>
                      <td className="border-b border-hairline px-3 py-2 text-right font-mono whitespace-nowrap">
                        {qty(r.neededQty, r.item.baseUom)}
                      </td>
                      <td
                        className={cn(
                          "border-b border-hairline px-3 py-2 text-right font-mono whitespace-nowrap",
                          isShort && "text-destructive"
                        )}
                      >
                        {qty(r.usableQty, r.item.baseUom)}
                      </td>
                      <td className="border-b border-hairline px-3 py-2 text-right">
                        {isShort ? (
                          <div className="flex flex-col items-end gap-1.5 @min-[34rem]/stk:flex-row @min-[34rem]/stk:items-center @min-[34rem]/stk:justify-end @min-[34rem]/stk:gap-3">
                            <span className="text-xs font-medium whitespace-nowrap text-destructive">
                              {t("stl.stock.shortBy", {
                                qty: qty(r.shortQty, r.item.baseUom),
                              })}
                            </span>
                            {canRequest ? (
                              <Button
                                size="sm"
                                variant="outline"
                                nativeButton={false}
                                render={
                                  <Link href={transferRequestHref(order, r)} />
                                }
                                title={t("stl.stock.requestHint", {
                                  qty: qty(r.requestQty, r.item.baseUom),
                                })}
                                data-testid="order-request-transfer"
                              >
                                <ArrowRightLeft data-icon="inline-start" />
                                {t("stl.stock.requestTransfer")}
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-success">
                            {t("stl.stock.ok")}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>
    </div>
  )
}
