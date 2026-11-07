"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Ban, CalendarClock, ClipboardList, History, Printer, Receipt, Truck } from "lucide-react"
import { toast } from "sonner"

import { UserAvatar } from "@/components/shared/avatars"
import { ApprovalChip } from "@/components/shared/approval-chip"
import { DateText } from "@/components/shared/date-text"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { Timeline, type TimelineItem } from "@/components/shared/timeline"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { locationById } from "@/config/brand.config"
import { dhakaTime } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id, JobTaskRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { cancelOrder } from "../commands"
import { isTaskLine } from "../orders"
import { ConsumptionTable, ExtraConsumptionButton, QcPanel, TaskActions, useConsumption } from "./job-parts"
import { ClassTag, DocHeader, PrintDialog, useUserMap, VehicleCell } from "./kit"
import { QuoteLines } from "./quote-view"
import { ScheduleDialog, type ScheduleTarget } from "./schedule-dialog"

/**
 * /stl/orders/[id]: the order with its lifecycle timeline, tasks per
 * technician (start, finish), consumption standard vs actual, QC, linked
 * documents (quotation, deposits, deliveries, invoices, vouchers), the
 * audit history and the job card print.
 */
export function OrderView({ id }: { id: Id }) {
  const db = useDb()
  const { t, tk, locale, money } = useLocale()
  const users = useUserMap()
  const cancel = useCommand(cancelOrder)
  const [target, setTarget] = React.useState<ScheduleTarget | null>(null)
  const [cancelling, setCancelling] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [printing, setPrinting] = React.useState(false)

  const data = useLiveQuery(async () => {
    const order = await db.salesOrders.get(id)
    if (!order) return null
    const [lines, tasks, party, vehicle, quotation, receipts, deliveries, invoices, qcs, journals, audit, bays] = await Promise.all([
      db.salesOrderLines.where("orderId").equals(order.id).sortBy("lineNo"),
      db.jobTasks.where("orderId").equals(order.id).sortBy("plannedStart"),
      db.parties.get(order.partyId),
      order.vehicleId ? db.vehicles.get(order.vehicleId) : undefined,
      order.quotationId ? db.quotations.get(order.quotationId) : undefined,
      db.receipts.where("orderId").equals(order.id).toArray(),
      db.deliveries.where("orderId").equals(order.id).toArray(),
      db.salesInvoices.where("orderIds").equals(order.id).toArray(),
      db.qcChecks.where("orderId").equals(order.id).sortBy("at"),
      db.journals.where("source.docId").equals(order.id).toArray(),
      db.audit.where("entityId").equals(order.id).toArray(),
      db.bays.where("locationId").equals(order.locationId).toArray(),
    ])
    return { order, lines, tasks, party, vehicle, quotation, receipts, deliveries, invoices, qcs, journals, audit, bays }
  }, [db, id])
  const consumption = useConsumption(data?.order ?? undefined)
  const canEdit = useCan("stl.order.edit", data?.order.locationId)
  const canCancel = useCan("stl.order.cancel", data?.order.locationId)
  const canHandover = useCan("sd.delivery.handover", data?.order.locationId)
  const canGoods = useCan("sd.delivery.goods", data?.order.locationId)
  const canCheckout = useCan("si.counter.checkout", data?.order.locationId)

  if (data === undefined) return null
  if (data === null) return <EmptyState icon={ClipboardList} title={t("stl.order.notFound")} action={{ label: t("stl.pages.orders"), href: "/stl/orders" }} />
  const { order, lines, tasks, party, vehicle, quotation, receipts, deliveries, invoices, qcs, journals, audit, bays } = data
  const taskLines = lines.filter(isTaskLine)
  const allDone = taskLines.length > 0 && taskLines.every((l) => l.status === "done")
  const schedulable = (order.status === "booked" || order.status === "in-progress") && taskLines.some((l) => l.status === "open" && !tasks.some((x) => x.orderLineId === l.id && x.status !== "queued"))
  const goodsOnly = lines.length > 0 && lines.every((l) => l.kind === "item" || l.status === "cancelled")
  const bay = bays.find((b) => b.id === order.bayId)
  const due = Math.max(0, order.totalP - order.advanceP)

  const steps: (TimelineItem | null)[] = [
    { id: "booked", title: t("stl.order.steps.booked"), at: order.createdAt, tone: "info" as const, description: userName(users.get(order.advisorId), locale) },
    order.startedAt ? { id: "started", title: t("stl.order.steps.started"), at: order.startedAt, tone: "primary" as const } : null,
    ...qcs.map((q) => ({
      id: q.id,
      title: t(q.result === "pass" ? "stl.order.steps.qcPass" : "stl.order.steps.qcFail"),
      at: q.at,
      tone: q.result === "pass" ? ("success" as const) : ("destructive" as const),
      description: [userName(users.get(q.checkedBy), locale), ...q.items.filter((i) => !i.ok).map((i) => `${t(`stl.qc.items.${i.key}` as "stl.qc.items.finish")}: ${i.note ?? ""}`)].join(" · "),
    })),
    order.readyAt ? { id: "ready", title: t("stl.order.steps.ready"), at: order.readyAt, tone: "success" as const } : null,
    order.deliveredAt ? { id: "delivered", title: t("stl.order.steps.delivered"), at: order.deliveredAt, tone: "success" as const } : null,
    order.invoicedAt ? { id: "invoiced", title: t("stl.order.steps.invoiced"), at: order.invoicedAt, tone: "info" as const } : null,
    order.closedAt ? { id: "closed", title: t("stl.order.steps.closed"), at: order.closedAt, tone: "success" as const } : null,
    order.cancelledAt ? { id: "cancelled", title: t("stl.order.steps.cancelled"), at: order.cancelledAt, tone: "muted" as const, description: order.cancelReason } : null,
  ]
  const timeline = steps.filter((x): x is TimelineItem => !!x)

  const doCancel = async () => {
    const out = await cancel.run({ orderId: order.id, reason, expectedVersion: order.version })
    if (out) {
      setCancelling(false)
      toast.success(t("stl.order.cancelled", { no: order.orderNo }))
    }
  }

  const byTech = new Map<Id, JobTaskRow[]>()
  for (const x of tasks) byTech.set(x.technicianId, [...(byTech.get(x.technicianId) ?? []), x])

  return (
    <div className="flex flex-col gap-4" data-testid="order-view">
      <DocHeader
        title={`${t("stl.pages.order")} · ${tk(`reports.enum.orderKind.${order.kind}`)}`}
        docNo={order.orderNo}
        status={order.status}
        lines={[
          <>
            <span className="font-medium text-foreground">{nameOf(party, locale)}</span>
            <span lang="en" className="font-mono">{party?.phone}</span>
          </>,
          vehicle ? (
            <>
              <VehicleCell vehicle={vehicle} /> <ClassTag cls={vehicle.vehicleClass} />
            </>
          ) : null,
          <>
            {t("stl.order.promised")} <DateText value={order.promisedAt} variant="dmyTime" />
            {bay ? <span lang="en" className="rounded bg-surface-raised px-1.5 font-mono text-xs">{bay.code}</span> : null}
          </>,
        ].filter(Boolean)}
        amounts={[
          { label: t("common.total"), valueP: order.totalP, strong: true },
          { label: t("stl.order.advance"), valueP: order.advanceP, tone: "success", testId: "order-advance" },
          { label: t("stl.order.balance"), valueP: due },
        ]}
        actions={
          <>
            {schedulable && canEdit ? (
              <Button onClick={() => setTarget({ order })} data-testid="order-schedule">
                <CalendarClock data-icon="inline-start" />
                {t("stl.board.schedule")}
              </Button>
            ) : null}
            {(order.status === "ready" || order.status === "qc") && canHandover && !goodsOnly ? (
              <Button nativeButton={false} render={<Link href={`/sd/handover/${order.id}`} />} data-testid="order-handover">
                <Truck data-icon="inline-start" />
                {t(order.status === "qc" ? "stl.order.toQc" : "stl.order.handover")}
              </Button>
            ) : null}
            {goodsOnly && order.status === "booked" && canGoods ? (
              <Button nativeButton={false} render={<Link href={`/sd?goods=${order.id}`} />}>
                <Truck data-icon="inline-start" />
                {t("stl.order.deliverGoods")}
              </Button>
            ) : null}
            {order.status === "delivered" && canCheckout ? (
              <Button nativeButton={false} render={<Link href={`/si/counter?order=${order.id}`} />} data-testid="order-checkout">
                <Receipt data-icon="inline-start" />
                {t("stl.order.checkout")}
              </Button>
            ) : null}
            <ExtraConsumptionButton order={order} />
            <Button variant="ghost" onClick={() => setPrinting(true)} data-testid="job-card-print">
              <Printer data-icon="inline-start" />
              {t("stl.order.jobCard")}
            </Button>
            {["booked", "in-progress", "qc"].includes(order.status) && canCancel ? (
              <Button variant="destructive-outline" onClick={() => setCancelling(true)} className="ml-auto" data-testid="order-cancel">
                <Ban data-icon="inline-start" />
                {t("stl.order.cancel")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {(order.status === "qc" || (order.status === "in-progress" && allDone)) ? (
            <SectionCard title={t("stl.qc.title")} size="sm">
              <QcPanel order={order} allDone={allDone} />
            </SectionCard>
          ) : null}
          <SectionCard title={t("stl.order.tasks")} size="sm">
            {tasks.length ? (
              <div className="flex flex-col gap-3">
                {[...byTech].map(([techId, list]) => {
                  const tech = users.get(techId)
                  return (
                    <div key={techId} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-[0.8125rem] font-medium">
                        {tech ? <UserAvatar user={tech} role="TECHNICIAN" size={24} /> : null}
                        {userName(tech, locale)}
                      </div>
                      {list.map((x) => {
                        const line = lines.find((l) => l.id === x.orderLineId)
                        const xbay = bays.find((b) => b.id === x.bayId)
                        return (
                          <div key={x.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2" data-testid="order-task" data-status={x.status}>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[0.8125rem]">{locale === "bn" ? line?.descriptionBn : line?.descriptionEn}</div>
                              <div className="nums text-xs text-muted-foreground">
                                <span lang="en" className="font-mono">{xbay?.code}</span> · {dhakaTime(x.plannedStart)} · {t("stl.quote.minutes", { min: x.minutes ?? x.plannedMinutes })}
                              </div>
                            </div>
                            <DocStatus status={x.status} />
                            <TaskActions task={x} orderStatus={order.status} />
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{goodsOnly ? t("stl.order.noTasksGoods") : t("stl.order.noTasks")}</p>
            )}
          </SectionCard>
          <SectionCard title={t("stl.consumption.title")} size="sm">
            {consumption ? <ConsumptionTable rows={consumption} /> : null}
          </SectionCard>
          <SectionCard title={t("stl.order.lines")} size="sm">
            <QuoteLines lines={lines.filter((l) => l.status !== "cancelled")} />
          </SectionCard>
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("stl.order.timeline")} size="sm">
            <Timeline items={timeline} />
          </SectionCard>
          <SectionCard title={t("stl.linked")} size="sm">
            <ul className="flex flex-col gap-2 text-[0.8125rem]" data-testid="linked-docs">
              {quotation ? (
                <li className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("stl.pages.quotation")}</span>
                  <DocLink docType="quotations" docId={quotation.id} docNo={quotation.quoteNo} />
                </li>
              ) : null}
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t("stl.order.deposit")} · {tk(`reports.enum.method.${r.method}`)} · {money(r.amountP)}
                  </span>
                  <DocLink docType="receipts" docId={r.id} docNo={r.receiptNo} />
                </li>
              ))}
              {deliveries.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("stl.order.delivery")}</span>
                  <DocLink docType="deliveries" docId={d.id} docNo={d.deliveryNo} />
                </li>
              ))}
              {invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("stl.order.invoice")}</span>
                  <DocLink docType="salesInvoices" docId={inv.id} docNo={inv.invoiceNo} />
                </li>
              ))}
              {journals.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("stl.order.voucher", { rule: j.rule ?? "" })}</span>
                  <DocLink docType="journals" docId={j.id} docNo={j.journalNo} />
                </li>
              ))}
              {!quotation && !receipts.length && !deliveries.length && !invoices.length && !journals.length ? (
                <li className="text-muted-foreground">{t("stl.order.noLinks")}</li>
              ) : null}
            </ul>
            {order.discountApprovalId ? <ApprovalChip approvalId={order.discountApprovalId} className="mt-3" /> : null}
          </SectionCard>
          <SectionCard title={t("stl.order.details")} size="sm">
            <KeyValueGrid
              items={[
                { label: t("common.location"), value: locationById(order.locationId)?.name[locale] },
                { label: t("stl.order.advisor"), value: userName(users.get(order.advisorId), locale) },
                { label: t("stl.order.odometer"), value: order.odometerKm ? `${order.odometerKm} km` : "-" },
                { label: t("stl.quote.discountPct"), value: `${order.discountPct}%` },
                { label: t("stl.order.condition"), value: order.conditionNotes || "-", wide: true },
                ...(order.complaintNote ? [{ label: t("stl.order.complaint"), value: order.complaintNote, wide: true }] : []),
              ]}
            />
          </SectionCard>
          <SectionCard title={t("stl.order.history")} icon={History} size="sm">
            <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-xs" data-testid="order-history">
              {audit
                .sort((a, b) => b.seq - a.seq)
                .slice(0, 20)
                .map((a) => (
                  <li key={a.seq} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span lang="en" className="font-mono text-muted-foreground">{a.command}</span> · {a.actor.name}
                    </span>
                    <DateText value={a.at} variant="time" className="shrink-0 text-muted-foreground" />
                  </li>
                ))}
              {!audit.length ? <li className="text-muted-foreground">{t("stl.order.noHistory")}</li> : null}
            </ul>
          </SectionCard>
        </aside>
      </div>

      <ScheduleDialog target={target} onClose={() => setTarget(null)} />
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("stl.order.cancelTitle", { no: order.orderNo })}</DialogTitle>
            <DialogDescription>{t("stl.order.cancelBody")}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("common.reason")} data-testid="cancel-reason" />
          <DialogFooter>
            <Button variant="neutral" onClick={() => setCancelling(false)}>
              {t("common.close")}
            </Button>
            <Button variant="destructive" onClick={doCancel} disabled={reason.trim().length < 3 || cancel.pending} data-testid="cancel-confirm">
              {t("stl.order.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PrintDialog open={printing} onOpenChange={setPrinting} title={t("stl.order.jobCard")} docNo={order.orderNo}>
        <PrintLayout title={t("stl.order.jobCard")} docNo={order.orderNo} location={locationById(order.locationId)?.code} meta={<DateText value={order.scheduledAt} variant="dmyTime" />}>
          <div className="mb-3 grid grid-cols-2 gap-4 text-[0.75rem]">
            <div>
              <div className="font-semibold">{nameOf(party, locale)}</div>
              <div lang="en">{party?.phone}</div>
            </div>
            <div className="text-right">
              {vehicle ? (
                <>
                  <div lang="en" className="font-mono font-semibold">{vehicle.regNo}</div>
                  <div>
                    {vehicle.make} {vehicle.model} ({vehicle.vehicleClass}) · {vehicle.colour}
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <table className="w-full text-[0.75rem]">
            <thead>
              <tr className="text-left">
                <th className="border-b border-[#111] py-1">{t("common.service")}</th>
                <th className="border-b border-[#111] py-1">{t("stl.order.technician")}</th>
                <th className="border-b border-[#111] py-1">{t("stl.schedule.bay")}</th>
                <th className="border-b border-[#111] py-1 text-right">{t("common.time")}</th>
              </tr>
            </thead>
            <tbody>
              {taskLines.map((l) => {
                const x = tasks.find((task) => task.orderLineId === l.id)
                return (
                  <tr key={l.id}>
                    <td className="border-b border-[#ddd] py-1">{locale === "bn" ? l.descriptionBn : l.descriptionEn}</td>
                    <td className="border-b border-[#ddd] py-1">{x ? userName(users.get(x.technicianId), locale) : ""}</td>
                    <td lang="en" className="border-b border-[#ddd] py-1 font-mono">{bays.find((b) => b.id === x?.bayId)?.code ?? ""}</td>
                    <td className="border-b border-[#ddd] py-1 text-right font-mono">{x ? dhakaTime(x.plannedStart) : ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[0.75rem]">
            {t("stl.order.condition")}: {order.conditionNotes || "-"}
          </p>
          <div className="mt-8 grid grid-cols-2 gap-8 text-[0.6875rem]">
            <div className="border-t border-[#111] pt-1">{t("stl.order.signAdvisor")}</div>
            <div className="border-t border-[#111] pt-1">{t("stl.order.signCustomer")}</div>
          </div>
        </PrintLayout>
      </PrintDialog>
    </div>
  )
}
