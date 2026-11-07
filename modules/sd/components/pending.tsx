"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCircle2, ClipboardCheck, PackageCheck, Truck } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { QtyInput } from "@/components/shared/money-input"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { Id, PartyRow, SalesOrderLineRow, SalesOrderRow, VehicleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { ClassTag, StudioSelect, useStudio, VehicleCell } from "@/modules/stl/components/kit"

import { deliverGoods } from "../commands"

type Pending = { order: SalesOrderRow; party?: PartyRow; vehicle?: VehicleRow; lines: SalesOrderLineRow[] }

/**
 * /sd: pending deliveries at the studio: vehicles in QC and ready for
 * handover, and product or B2B goods orders to deliver with a challan
 * (partial deliveries allowed). `?goods=<orderId>` opens the goods dialog.
 */
export function PendingDeliveries() {
  const db = useDb()
  const params = useSearchParams()
  const { t, num, locale } = useLocale()
  const studio = useStudio()
  const loc = studio.locationId
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs || Date.now())
  const canGoods = useCan("sd.delivery.goods", loc)
  const [goodsFor, setGoodsFor] = React.useState<Id | null>(params.get("goods"))

  const data = useLiveQuery(async () => {
    if (!loc) return null
    const orders = (await db.salesOrders.where("locationId").equals(loc).toArray()).filter((o) => ["qc", "ready", "booked"].includes(o.status))
    const lines = await db.salesOrderLines.where("orderId").anyOf(orders.map((o) => o.id)).toArray()
    const parties = new Map((await db.parties.bulkGet([...new Set(orders.map((o) => o.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const vehicles = new Map((await db.vehicles.bulkGet([...new Set(orders.map((o) => o.vehicleId).filter((v): v is string => !!v))])).filter(Boolean).map((v) => [v!.id, v!]))
    const deliveredToday = (await db.deliveries.where("locationId").equals(loc).toArray()).filter((d) => dhakaDate(d.deliveredAt) === today).length
    const rows: Pending[] = orders.map((order) => ({
      order,
      party: parties.get(order.partyId),
      vehicle: order.vehicleId ? vehicles.get(order.vehicleId) : undefined,
      lines: lines.filter((l) => l.orderId === order.id && l.status !== "cancelled"),
    }))
    const goodsOnly = (r: Pending) => r.lines.length > 0 && r.lines.every((l) => l.kind === "item")
    return {
      qc: rows.filter((r) => r.order.status === "qc"),
      ready: rows.filter((r) => r.order.status === "ready"),
      goods: rows.filter((r) => r.order.status === "booked" && goodsOnly(r)),
      deliveredToday,
    }
  }, [db, loc, today])

  const goodsOrder = data?.goods.find((g) => g.order.id === goodsFor)

  return (
    <div className="flex flex-col gap-4" data-testid="sd-pending">
      <PageHeader
        title={t("sd.pages.home")}
        subtitle={t("sd.pending.subtitle")}
        actions={<StudioSelect value={loc} onChange={studio.setLocationId} studios={studio.studios} />}
      />
      <KpiGrid>
        <KpiCard variant="cyan" icon={Truck} title={t("sd.pending.kpiReady")} value={num(data?.ready.length ?? 0)} />
        <KpiCard variant="yellow" icon={ClipboardCheck} title={t("sd.pending.kpiQc")} value={num(data?.qc.length ?? 0)} />
        <KpiCard variant="pink" icon={PackageCheck} title={t("sd.pending.kpiGoods")} value={num(data?.goods.length ?? 0)} />
        <KpiCard variant="purple" icon={CheckCircle2} title={t("sd.pending.kpiDelivered")} value={num(data?.deliveredToday ?? 0)} href="/sd/deliveries" />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t("sd.pending.ready")} icon={Truck} size="sm">
          <PendingList rows={data?.ready ?? []} empty={t("sd.pending.noReady")} action={(r) => (
            <Button size="sm" nativeButton={false} render={<Link href={`/sd/handover/${r.order.id}`} />} data-testid="pending-handover">
              {t("stl.order.handover")}
            </Button>
          )} />
        </SectionCard>
        <SectionCard title={t("sd.pending.inQc")} icon={ClipboardCheck} size="sm">
          <PendingList rows={data?.qc ?? []} empty={t("sd.pending.noQc")} action={(r) => (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/sd/handover/${r.order.id}`} />}>
              {t("sd.pending.openQc")}
            </Button>
          )} />
        </SectionCard>
      </div>
      <SectionCard title={t("sd.pending.goods")} icon={PackageCheck} size="sm">
        <PendingList rows={data?.goods ?? []} empty={t("sd.pending.noGoods")} goods action={(r) =>
          canGoods ? (
            <Button size="sm" onClick={() => setGoodsFor(r.order.id)} data-testid="pending-goods">
              {t("stl.order.deliverGoods")}
            </Button>
          ) : null
        } />
      </SectionCard>
      <GoodsDialog row={goodsOrder} onClose={() => setGoodsFor(null)} locale={locale} />
    </div>
  )
}

function PendingList({ rows, empty, action, goods = false }: { rows: Pending[]; empty: string; action: (r: Pending) => React.ReactNode; goods?: boolean }) {
  const { t, locale, num } = useLocale()
  if (!rows.length) return <EmptyState size="sm" icon={CheckCircle2} title={empty} />
  return (
    <ul className="flex flex-col divide-y divide-hairline">
      {rows.map((r) => (
        <li key={r.order.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="pending-row" data-order-no={r.order.orderNo}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {r.vehicle ? <VehicleCell vehicle={r.vehicle} /> : null}
              <ClassTag cls={r.vehicle?.vehicleClass} />
              <Link href={`/stl/orders/${r.order.id}`} lang="en" className="font-mono text-xs text-link hover:underline">
                {r.order.orderNo}
              </Link>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {nameOf(r.party, locale)}
              {goods
                ? ` · ${r.lines.map((l) => `${num(l.qtyDelivered)}/${num(l.qty)} ${locale === "bn" ? l.descriptionBn : l.descriptionEn}`).join(", ")}`
                : ` · ${t("stl.list.promised")} `}
              {!goods ? <DateText value={r.order.promisedAt} variant="time" /> : null}
            </div>
          </div>
          {action(r)}
        </li>
      ))}
    </ul>
  )
}

/** Goods delivery with a challan (sd.deliverGoods): quantities per line, partial allowed. */
function GoodsDialog({ row, onClose, locale }: { row?: Pending; onClose: () => void; locale: string }) {
  const { t, num } = useLocale()
  const deliver = useCommand(deliverGoods)
  const [qty, setQty] = React.useState<Record<Id, number | null>>({})
  const [seen, setSeen] = React.useState<Id | null>(null)
  if ((row?.order.id ?? null) !== seen) {
    setSeen(row?.order.id ?? null)
    setQty(Object.fromEntries((row?.lines ?? []).map((l) => [l.id, Math.max(0, l.qty - l.qtyDelivered)])))
  }
  const lines = (row?.lines ?? []).map((l) => ({ line: l, open: Math.max(0, l.qty - l.qtyDelivered), want: qty[l.id] ?? 0 }))
  const valid = lines.some((l) => l.want > 0) && lines.every((l) => l.want <= l.open)
  const submit = async () => {
    if (!row) return
    const out = await deliver.run({
      orderId: row.order.id,
      expectedVersion: row.order.version,
      lines: lines.filter((l) => l.want > 0).map((l) => ({ orderLineId: l.line.id, qty: l.want })),
    })
    if (out) {
      toast.success(t(out.complete ? "sd.goods.complete" : "sd.goods.partial", { no: out.deliveryNo }))
      onClose()
    }
  }
  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="goods-dialog">
        <DialogHeader>
          <DialogTitle>{t("sd.goods.title", { no: row?.order.orderNo ?? "" })}</DialogTitle>
          <DialogDescription>{t("sd.goods.body")}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.line.id} className="flex items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2" data-testid="goods-line">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.8125rem]">{locale === "bn" ? l.line.descriptionBn : l.line.descriptionEn}</div>
                <div className="nums text-xs text-muted-foreground">{t("sd.goods.open", { open: num(l.open), ordered: num(l.line.qty) })}</div>
              </div>
              <QtyInput value={qty[l.line.id] ?? null} onChange={(v) => setQty((q) => ({ ...q, [l.line.id]: v }))} unit="pc" className="w-28" data-testid="goods-qty" />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || deliver.pending} data-testid="goods-submit">
            {t("sd.goods.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
