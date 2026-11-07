"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Camera, CheckCircle2, KeySquare, Printer, Receipt, Truck } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { DocLink } from "@/components/shared/doc-link"
import { EmptyState } from "@/components/shared/empty-state"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { locationById } from "@/config/brand.config"
import { placeholderPhoto } from "@/core/connectors/capture"
import { useDb } from "@/core/db/DbProvider"
import type { DeliveryRow, Id, PartyRow, SalesOrderRow, UserRow, VehicleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { isTaskLine } from "@/modules/stl/orders"
import { QcPanel } from "@/modules/stl/components/job-parts"
import { ClassTag, DocHeader, PrintDialog, useUserMap, VehicleCell } from "@/modules/stl/components/kit"

import { handover, HANDOVER_KEYS } from "../commands"
import { SignaturePad, SignatureView } from "./signature-pad"

const ANGLES = ["front", "rear", "left", "right"] as const

/**
 * /sd/handover/[orderId] (J3): the QC (when the order is still in QC), the
 * QC summary, the handover checklist, photos (generated placeholders), the
 * customer's signature on screen and the gate pass print. Retail lines on
 * the order leave the shelf FEFO with R5 in the same commit.
 */
export function Handover({ id }: { id: Id }) {
  const db = useDb()
  const { t, tk, locale } = useLocale()
  const users = useUserMap()
  const submit = useCommand(handover)
  const [checks, setChecks] = React.useState<Record<string, boolean>>({})
  const [name, setName] = React.useState("")
  const [signature, setSignature] = React.useState("")
  const [printing, setPrinting] = React.useState(false)

  const data = useLiveQuery(async () => {
    const order = await db.salesOrders.get(id)
    if (!order) return null
    const [lines, party, vehicle, qcs, deliveries] = await Promise.all([
      db.salesOrderLines.where("orderId").equals(order.id).sortBy("lineNo"),
      db.parties.get(order.partyId),
      order.vehicleId ? db.vehicles.get(order.vehicleId) : undefined,
      db.qcChecks.where("orderId").equals(order.id).sortBy("at"),
      db.deliveries.where("orderId").equals(order.id).toArray(),
    ])
    return { order, lines, party, vehicle, qcs, delivery: deliveries.find((d) => d.kind === "vehicle-handover") }
  }, [db, id])
  const canHandover = useCan("sd.delivery.handover", data?.order.locationId)
  const canCheckout = useCan("si.counter.checkout", data?.order.locationId)

  if (data === undefined) return null
  if (data === null) return <EmptyState icon={Truck} title={t("stl.order.notFound")} action={{ label: t("sd.pages.home"), href: "/sd" }} />
  const { order, lines, party, vehicle, qcs, delivery } = data
  const lastPass = [...qcs].reverse().find((q) => q.result === "pass")
  const taskLines = lines.filter(isTaskLine)
  const allDone = taskLines.length > 0 && taskLines.every((l) => l.status === "done")
  const goods = lines.filter((l) => l.kind === "item" && l.status !== "cancelled")
  const checklistDone = HANDOVER_KEYS.every((k) => checks[k])
  const signatureName = name || nameOf(party, "en")
  const canSubmit = order.status === "ready" && canHandover && checklistDone && !!signature && signatureName.trim().length >= 2

  const doSubmit = async () => {
    const out = await submit.run({
      orderId: order.id,
      expectedVersion: order.version,
      checklist: HANDOVER_KEYS.map((k) => ({ key: k, ok: !!checks[k] })),
      signatureName,
      signatureSvg: signature,
      photoCount: ANGLES.length,
    })
    if (out) {
      toast.success(t("sd.handover.done", { no: order.orderNo, gp: out.gatePassNo }))
      setPrinting(true)
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="handover">
      <DocHeader
        title={t("sd.pages.handover")}
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
        ].filter(Boolean)}
        amounts={[
          { label: t("common.total"), valueP: order.totalP, strong: true },
          { label: t("stl.order.advance"), valueP: order.advanceP, tone: "success" },
        ]}
        actions={
          <>
            <Button variant="ghost" nativeButton={false} render={<Link href={`/stl/orders/${order.id}`} />}>
              {t("sd.handover.openOrder")}
            </Button>
            {delivery ? (
              <Button onClick={() => setPrinting(true)} data-testid="gate-pass-print">
                <Printer data-icon="inline-start" />
                {t("sd.handover.gatePass")}
              </Button>
            ) : null}
            {delivery && order.status === "delivered" && canCheckout ? (
              <Button variant="outline" nativeButton={false} render={<Link href={`/si/counter?order=${order.id}`} />}>
                <Receipt data-icon="inline-start" />
                {t("stl.order.checkout")}
              </Button>
            ) : null}
          </>
        }
      />

      {order.status === "qc" || (order.status === "in-progress" && allDone) ? (
        <SectionCard title={t("stl.qc.title")} size="sm">
          <QcPanel order={order} allDone={allDone} />
        </SectionCard>
      ) : null}

      {!["qc", "ready", "delivered", "invoiced", "closed"].includes(order.status) && !(order.status === "in-progress" && allDone) ? (
        <EmptyState icon={Truck} title={t("sd.handover.notReady")} description={t("sd.handover.notReadyHint")} action={{ label: t("sd.handover.openOrder"), href: `/stl/orders/${order.id}` }} />
      ) : null}

      {lastPass || delivery ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title={t("sd.handover.qcSummary")} icon={CheckCircle2} size="sm">
            {lastPass ? (
              <div className="flex flex-col gap-2 text-[0.8125rem]">
                <ul className="grid grid-cols-2 gap-1.5">
                  {lastPass.items.map((i) => (
                    <li key={i.key} className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-success" />
                      {tk(`stl.qc.items.${i.key}`)}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {t("sd.handover.passedBy", { name: userName(users.get(lastPass.checkedBy), locale) })} · <DateText value={lastPass.at} variant="dmyTime" />
                  {qcs.length > 1 ? ` · ${t("sd.handover.attempts", { count: qcs.length })}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">-</p>
            )}
          </SectionCard>
          <SectionCard title={t("sd.handover.photos")} icon={Camera} size="sm" action={<SimulatedBadge />}>
            <div className="grid grid-cols-4 gap-2">
              {ANGLES.map((a) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a} src={placeholderPhoto(order.id, t(`sd.handover.angles.${a}`))} alt={t(`sd.handover.angles.${a}`)} className="aspect-[16/11] w-full rounded-md object-cover" />
              ))}
            </div>
          </SectionCard>
        </div>
      ) : null}

      {order.status === "ready" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title={t("sd.handover.checklist")} icon={KeySquare} size="sm">
            <ul className="flex flex-col gap-2" data-testid="handover-checklist">
              {HANDOVER_KEYS.map((k) => (
                <li key={k}>
                  <label className="flex items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2.5 text-[0.8125rem]">
                    <Checkbox checked={!!checks[k]} onCheckedChange={(v) => setChecks((c) => ({ ...c, [k]: !!v }))} data-testid={`handover-item-${k}`} />
                    {t(`sd.checklist.${k}`)}
                  </label>
                </li>
              ))}
            </ul>
            {goods.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("sd.handover.goodsOut", { items: goods.map((g) => `${g.qty} × ${locale === "bn" ? g.descriptionBn : g.descriptionEn}`).join(", ") })}
              </p>
            ) : null}
          </SectionCard>
          <SectionCard title={t("sd.handover.signature")} size="sm" action={<SimulatedBadge />}>
            <div className="flex flex-col gap-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={nameOf(party, "en")} data-testid="signature-name" className="max-w-[28rem]" />
              <SignaturePad value={signature} onChange={setSignature} />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={doSubmit} disabled={!canSubmit || submit.pending} data-testid="handover-submit">
                  <Truck data-icon="inline-start" />
                  {t("sd.handover.submit")}
                </Button>
                {!canHandover ? <span className="text-xs text-muted-foreground">{t("stl.noPermission")}</span> : null}
                {canHandover && !canSubmit ? <span className="text-xs text-muted-foreground">{t("sd.handover.completeFirst")}</span> : null}
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {delivery ? (
        <SectionCard title={t("sd.handover.handedOver")} size="sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.8125rem]">
            <DocLink docType="deliveries" docId={delivery.id} docNo={delivery.deliveryNo} />
            <span lang="en" className="font-mono">{delivery.gatePassNo}</span>
            <DateText value={delivery.deliveredAt} variant="dmyTime" />
            <span>{userName(users.get(delivery.deliveredBy), locale)}</span>
            <StatusText tone="success" dot>
              {delivery.signatureName}
            </StatusText>
            <SignatureView path={delivery.signatureSvg} className="h-12 w-32 rounded bg-white" />
          </div>
        </SectionCard>
      ) : null}

      {delivery ? (
        <PrintDialog open={printing} onOpenChange={setPrinting} title={t("sd.handover.gatePass")} docNo={delivery.gatePassNo ?? delivery.deliveryNo} wide={false}>
          <GatePass delivery={delivery} order={order} party={party} vehicle={vehicle} users={users} />
        </PrintDialog>
      ) : null}
    </div>
  )
}

/** The gate pass (GP-<LOC>-<FY>-<5>): vehicle, customer, time and the customer's signature. */
export function GatePass({
  delivery,
  order,
  party,
  vehicle,
  users,
}: {
  delivery: DeliveryRow
  order: SalesOrderRow
  party?: PartyRow
  vehicle?: VehicleRow
  users: Map<Id, UserRow>
}) {
  const { t, locale } = useLocale()
  return (
    <PrintLayout size="A5" title={t("sd.handover.gatePass")} docNo={delivery.gatePassNo} location={locationById(order.locationId)?.code} meta={<DateText value={delivery.deliveredAt} variant="dmyTime" />}>
      <div className="flex flex-col gap-3 text-[0.8125rem]" data-testid="gate-pass">
        {vehicle ? (
          <div className="rounded border-2 border-[#111] px-3 py-2 text-center">
            <div lang="en" className="font-mono text-lg font-bold">{vehicle.regNo}</div>
            <div>
              {vehicle.make} {vehicle.model} · {vehicle.colour}
            </div>
          </div>
        ) : null}
        <table className="w-full text-[0.75rem]">
          <tbody>
            <tr>
              <td className="py-0.5 text-[#555]">{t("common.customer")}</td>
              <td className="py-0.5 text-right">{nameOf(party, locale)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-[#555]">{t("stl.pages.order")}</td>
              <td lang="en" className="py-0.5 text-right font-mono">{order.orderNo}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-[#555]">{t("sd.handover.deliveryNo")}</td>
              <td lang="en" className="py-0.5 text-right font-mono">{delivery.deliveryNo}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-[#555]">{t("sd.handover.releasedBy")}</td>
              <td className="py-0.5 text-right">{userName(users.get(delivery.deliveredBy), locale)}</td>
            </tr>
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-6 pt-4 text-[0.6875rem]">
          <div>
            <SignatureView path={delivery.signatureSvg} className="h-14 w-full" />
            <div className="border-t border-[#111] pt-1">
              {t("sd.handover.customerSignature")}: {delivery.signatureName}
            </div>
          </div>
          <div className="flex flex-col justify-end">
            <div className="border-t border-[#111] pt-1">{t("sd.handover.guard")}</div>
          </div>
        </div>
        <p className={cn("text-[0.6875rem] text-[#555]")}>{t("sd.handover.gatePassNote")}</p>
      </div>
    </PrintLayout>
  )
}
