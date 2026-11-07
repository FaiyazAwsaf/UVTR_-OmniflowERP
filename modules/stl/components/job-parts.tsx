"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCircle2, PackageMinus, Play, ShieldCheck, Square, XCircle } from "lucide-react"
import { toast } from "sonner"

import { QtyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { ItemPicker } from "@/components/shared/pickers"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import type { Id, JobTaskRow, SalesOrderRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { recipeFor } from "@/modules/pc/pricing"
import { useCatalogue } from "@/modules/pc/queries"

import { finishTask, qcCheck, QC_KEYS, recordConsumption, startTask } from "../commands"
import { Field } from "./kit"

/** Start or finish a task (own tasks for technicians; any task for the studio manager). */
export function TaskActions({ task, orderStatus }: { task: JobTaskRow; orderStatus: SalesOrderRow["status"] }) {
  const { t } = useLocale()
  const { userId } = useSession()
  const canWork = useCan("stl.job.work", task.locationId)
  const isManager = useCan("stl.qc.check", task.locationId)
  const start = useCommand(startTask)
  const finish = useCommand(finishTask)
  if (!canWork || (task.technicianId !== userId && !isManager)) return null
  if (task.status === "queued" && (orderStatus === "booked" || orderStatus === "in-progress")) {
    return (
      <Button size="sm" onClick={() => start.run({ taskId: task.id, expectedVersion: task.version })} disabled={start.pending} data-testid="task-start">
        <Play data-icon="inline-start" />
        {t("stl.task.start")}
      </Button>
    )
  }
  if (task.status === "in-progress") {
    return (
      <Button
        size="sm"
        onClick={async () => {
          const out = await finish.run({ taskId: task.id, expectedVersion: task.version })
          if (out?.toQc) toast.success(t("stl.task.toQc"))
        }}
        disabled={finish.pending}
        data-testid="task-finish"
      >
        <Square data-icon="inline-start" />
        {t("stl.task.finish")}
      </Button>
    )
  }
  return null
}

/** Record extra consumables issued to a job, or unused stock returned from it (R4). */
export function ConsumptionDialog({
  order,
  taskId,
  open,
  onOpenChange,
}: {
  order: SalesOrderRow
  taskId?: Id
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const db = useDb()
  const { t, locale, num } = useLocale()
  const record = useCommand(recordConsumption)
  const [itemId, setItemId] = React.useState<Id | null>(null)
  const [qty, setQty] = React.useState<number | null>(null)
  const [kind, setKind] = React.useState<"extra" | "return">("extra")
  const item = useLiveQuery(() => (itemId ? db.items.get(itemId) : undefined), [db, itemId])
  const onHand = useLiveQuery(() => (itemId ? db.stockValues.get(`sv:${itemId}:${order.locationId}`) : undefined), [db, itemId, order.locationId])

  const submit = async () => {
    if (!itemId || !qty) return
    const out = await record.run({ orderId: order.id, taskId, itemId, qtyBase: qty, kind })
    if (out) {
      toast.success(t(kind === "extra" ? "stl.consumption.issued" : "stl.consumption.returned"))
      setItemId(null)
      setQty(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="consumption-dialog">
        <DialogHeader>
          <DialogTitle>{t("stl.consumption.recordTitle")}</DialogTitle>
          <DialogDescription>{t("stl.consumption.recordBody", { no: order.orderNo })}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1" role="radiogroup">
          {(["extra", "return"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              data-testid={`consumption-${k}`}
              onClick={() => setKind(k)}
              className={cn("h-8 rounded-full px-3 text-[0.8125rem]", kind === k ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground")}
            >
              {t(`stl.consumption.kinds.${k}`)}
            </button>
          ))}
        </div>
        <Field label={t("common.item")}>
          <ItemPicker value={itemId} onChange={(id) => setItemId(id)} kinds={["chemical", "consumable"]} testId="consumption-item" />
        </Field>
        <Field
          label={t("stl.consumption.qty")}
          hint={item && onHand ? t("stl.consumption.onHand", { qty: num(Math.round(onHand.qtyBase * 100) / 100), unit: item.baseUom, item: nameOf(item, locale) }) : undefined}
        >
          <QtyInput value={qty} onChange={setQty} unit={item?.baseUom} data-testid="consumption-qty" />
        </Field>
        <DialogFooter>
          <Button variant="neutral" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!itemId || !qty || qty <= 0 || record.pending} data-testid="consumption-submit">
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type ConsumptionRow = { itemId: Id; sku: string; name: string; uom: string; standardQty: number; actualQty: number; valueP: number }

/** Standard (the recipes of the order's service lines) against actual issues per item. */
export function useConsumption(order: SalesOrderRow | undefined): ConsumptionRow[] | undefined {
  const db = useDb()
  const catalogue = useCatalogue()
  const { locale } = useLocale()
  const data = useLiveQuery(async () => {
    if (!order) return null
    const [lines, rows] = await Promise.all([
      db.salesOrderLines.where("orderId").equals(order.id).toArray(),
      db.jobConsumptions.where("orderId").equals(order.id).toArray(),
    ])
    return { lines, rows }
  }, [db, order?.id])
  return React.useMemo(() => {
    if (!data || !catalogue) return undefined
    const out = new Map<Id, ConsumptionRow>()
    const row = (itemId: Id) => {
      let r = out.get(itemId)
      if (!r) {
        const item = catalogue.items.get(itemId)
        r = { itemId, sku: item?.sku ?? itemId, name: item ? nameOf(item, locale) : itemId, uom: item?.baseUom ?? "", standardQty: 0, actualQty: 0, valueP: 0 }
        out.set(itemId, r)
      }
      return r
    }
    for (const line of data.lines) {
      if (line.kind !== "service" || line.status === "cancelled") continue
      for (const r of recipeFor(catalogue, line.refId, line.vehicleClass ?? "SD")) row(r.itemId).standardQty += r.qtyBase
    }
    for (const c of data.rows) {
      const r = row(c.itemId)
      r.actualQty += c.actualQty
      r.valueP += c.valueP
    }
    return [...out.values()].map((r) => ({ ...r, standardQty: Math.round(r.standardQty * 1000) / 1000, actualQty: Math.round(r.actualQty * 1000) / 1000 })).sort((a, b) => a.sku.localeCompare(b.sku))
  }, [data, catalogue, locale])
}

/** The consumption table: standard vs actual per item, variance and value. */
export function ConsumptionTable({ rows }: { rows: ConsumptionRow[] }) {
  const { t, num } = useLocale()
  if (!rows.length) return <p className="text-[0.8125rem] text-muted-foreground">{t("stl.consumption.none")}</p>
  const total = rows.reduce((s, r) => s + r.valueP, 0)
  return (
    <div className="@container/ct overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr className="text-left">
            <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("common.item")}</th>
            <th className="bg-surface-raised px-3 py-2 text-right font-medium">{t("stl.consumption.standard")}</th>
            <th className="bg-surface-raised px-3 py-2 text-right font-medium">{t("stl.consumption.actual")}</th>
            <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[28rem]/ct:table-cell">{t("stl.consumption.variance")}</th>
            <th className="hidden rounded-r-md bg-surface-raised px-3 py-2 text-right font-medium @min-[36rem]/ct:table-cell">{t("stl.consumption.value")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const variance = Math.round((r.actualQty - r.standardQty) * 1000) / 1000
            return (
              <tr key={r.itemId} data-testid="consumption-row" data-sku={r.sku}>
                <td className="border-b border-hairline px-3 py-2">
                  <div className="truncate">{r.name}</div>
                  <div lang="en" className="font-mono text-xs text-muted-foreground">{r.sku}</div>
                </td>
                <td className="border-b border-hairline px-3 py-2 text-right font-mono nums">
                  {num(r.standardQty)} <span className="text-xs text-muted-foreground">{r.uom}</span>
                </td>
                <td className="border-b border-hairline px-3 py-2 text-right font-mono nums">
                  {num(r.actualQty)} <span className="text-xs text-muted-foreground">{r.uom}</span>
                </td>
                <td className={cn("hidden border-b border-hairline px-3 py-2 text-right font-mono nums @min-[28rem]/ct:table-cell", variance > 0 ? "text-warning" : variance < 0 ? "text-info" : "text-muted-foreground")}>
                  {variance > 0 ? "+" : ""}
                  {num(variance)}
                </td>
                <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono @min-[36rem]/ct:table-cell">
                  <MoneyText poisha={r.valueP} />
                </td>
              </tr>
            )
          })}
          <tr className="font-semibold">
            <td className="rounded-l-md bg-surface-raised px-3 py-2" colSpan={3}>
              {t("common.total")}
            </td>
            <td className="hidden bg-surface-raised @min-[28rem]/ct:table-cell" />
            <td className="hidden rounded-r-md bg-surface-raised px-3 py-2 text-right font-mono @min-[36rem]/ct:table-cell">
              <MoneyText poisha={total} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Extra consumables action for the order view and my jobs. */
export function ExtraConsumptionButton({ order, taskId, size = "sm" }: { order: SalesOrderRow; taskId?: Id; size?: "sm" | "default" }) {
  const { t } = useLocale()
  const canWork = useCan("stl.job.work", order.locationId)
  const [open, setOpen] = React.useState(false)
  if (!canWork || !["booked", "in-progress", "qc"].includes(order.status)) return null
  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)} data-testid="extra-consumption">
        <PackageMinus data-icon="inline-start" />
        {t("stl.consumption.record")}
      </Button>
      <ConsumptionDialog order={order} taskId={taskId} open={open} onOpenChange={setOpen} />
    </>
  )
}

/**
 * QC checklist (stl.qcCheck): every item OK passes the order to ready with
 * the vehicle-ready SMS; anything not OK fails it back to in progress.
 */
export function QcPanel({ order, allDone }: { order: SalesOrderRow; allDone: boolean }) {
  const { t } = useLocale()
  const canQc = useCan("stl.qc.check", order.locationId)
  const check = useCommand(qcCheck)
  const [items, setItems] = React.useState<Record<string, { ok: boolean; note: string }>>(() =>
    Object.fromEntries(QC_KEYS.map((k) => [k, { ok: true, note: "" }]))
  )
  const ready = order.status === "qc" || (order.status === "in-progress" && allDone)
  if (!ready) return null
  if (!canQc) return <p className="text-[0.8125rem] text-muted-foreground">{t("stl.qc.waiting")}</p>
  const anyFail = QC_KEYS.some((k) => !items[k].ok)
  const submit = async (pass: boolean) => {
    const out = await check.run({
      orderId: order.id,
      expectedVersion: order.version,
      items: QC_KEYS.map((k) => ({ key: k, ok: pass ? true : items[k].ok, note: items[k].note || undefined })),
    })
    if (out) toast.success(t(out.result === "pass" ? "stl.qc.passed" : "stl.qc.failed", { no: order.orderNo }))
  }
  return (
    <div className="flex flex-col gap-3" data-testid="qc-panel">
      <ul className="flex flex-col gap-2">
        {QC_KEYS.map((k) => (
          <li key={k} className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2">
            <label className="flex min-w-40 flex-1 items-center gap-2.5 text-[0.8125rem]">
              <Checkbox
                checked={items[k].ok}
                data-testid={`qc-item-${k}`}
                onCheckedChange={(ok) => setItems((cur) => ({ ...cur, [k]: { ...cur[k], ok: !!ok } }))}
              />
              {t(`stl.qc.items.${k}`)}
            </label>
            {!items[k].ok ? (
              <Input
                value={items[k].note}
                onChange={(e) => setItems((cur) => ({ ...cur, [k]: { ...cur[k], note: e.target.value } }))}
                placeholder={t("stl.qc.notePlaceholder")}
                className="h-8 min-w-48 flex-1"
              />
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => submit(true)} disabled={check.pending || anyFail} data-testid="qc-pass">
          <CheckCircle2 data-icon="inline-start" />
          {t("stl.qc.pass")}
        </Button>
        <Button variant="destructive-outline" onClick={() => submit(false)} disabled={check.pending || !anyFail} data-testid="qc-fail">
          <XCircle data-icon="inline-start" />
          {t("stl.qc.fail")}
        </Button>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {t("stl.qc.hint")}
        </span>
      </div>
    </div>
  )
}
