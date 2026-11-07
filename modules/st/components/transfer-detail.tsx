"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { PackageCheck, Printer, Truck, XCircle } from "lucide-react"
import { toast } from "sonner"

import { BiLabel, TaxDocHeader } from "@/components/shared/tax-doc-header"
import { MoneyText } from "@/components/shared/money-text"
import { QtyInput } from "@/components/shared/money-input"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { Timeline, type TimelineItem } from "@/components/shared/timeline"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { locations as brandLocations } from "@/config/brand.config"
import { dhakaDate, dhakaTime } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id, ItemRow, TransferLineRow, TransferRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { isoToDmy } from "@/lib/i18n/dmy"
import { formatMoney, formatNumber } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { JournalLink } from "@/modules/ic/components/count-detail"
import { DocHeader, Field, HIDE, ItemCell, LinesTable, NotFound, PrintPreview, QtyText, freshKey, useScmLookups } from "@/modules/ic/components/scm-ui"

import { cancelTransfer, dispatchTransfer, receiveTransfer } from "../commands"
import { stBn } from "../i18n/bn"
import { stEn } from "../i18n/en"

type ChallanKey = keyof typeof stEn.st.challan
/** A bilingual print label from the ST dictionaries (Bangla first, English below). */
const bi = (key: ChallanKey) => <BiLabel bn={stBn.st.challan[key]} en={stEn.st.challan[key]} />

/** /st/transfers/[id]: request → dispatch with the Mushak 6.5 challan → in transit → receive (with discrepancies). */
export function TransferDetail({ id }: { id: string }) {
  const db = useDb()
  const { t, locale, money } = useLocale()
  const lookups = useScmLookups()
  const [dialog, setDialog] = React.useState<"dispatch" | "receive" | "cancel" | "challan" | null>(null)

  const data = useLiveQuery(async () => {
    const transfer = await db.transfers.get(id)
    if (!transfer) return { transfer: undefined }
    const lines = await db.transferLines.where("transferId").equals(id).toArray()
    const batchIds = [...new Set(lines.map((l) => l.batchId).filter(Boolean) as Id[])]
    const batches = new Map((await db.batches.bulkGet(batchIds)).filter(Boolean).map((b) => [b!.id, b!]))
    return { transfer, lines, batches }
  }, [db, id])
  const canDispatch = useCan("st.transfer.dispatch", data?.transfer?.fromLocationId)
  const canReceive = useCan("st.transfer.receive", data?.transfer?.toLocationId)
  const canCancel = useCan("st.transfer.request", data?.transfer?.toLocationId) || canDispatch

  if (data === undefined) return null
  if (!data.transfer) return <NotFound title={t("st.transfer.notFound")} backHref="/st/transfers" backLabel={t("st.transfer.back")} />
  const { transfer, lines, batches } = data
  const from = lookups?.locations.get(transfer.fromLocationId)
  const to = lookups?.locations.get(transfer.toLocationId)
  const user = (uid?: Id) => userName(lookups?.users.get(uid ?? ""), locale)
  const totalP = lines.reduce((s, l) => s + l.valueP, 0)
  const status = transfer.status === "dispatched" ? "in-transit" : transfer.status

  const steps: TimelineItem[] = [
    { id: "req", title: t("st.transfer.steps.requested"), description: user(transfer.requestedBy), at: transfer.requestedAt, tone: "success" },
    ...(transfer.dispatchedAt
      ? [{ id: "dis", title: t("st.transfer.steps.dispatched"), description: [user(transfer.dispatchedBy), transfer.vehicleNo].filter(Boolean).join(" · "), at: transfer.dispatchedAt, tone: "info" as const }]
      : []),
    ...(transfer.receivedAt ? [{ id: "rec", title: t("st.transfer.steps.received"), description: user(transfer.receivedBy), at: transfer.receivedAt, tone: "success" as const }] : []),
    ...(transfer.status === "cancelled" ? [{ id: "can", title: t("st.transfer.steps.cancelled"), description: transfer.note, tone: "muted" as const }] : []),
  ]

  return (
    <div className="flex flex-col gap-5" data-testid="transfer-detail">
      <DocHeader
        kind={t("st.transfer.kind")}
        docNo={transfer.transferNo}
        status={status}
        lines={[t("st.transfer.route", { from: nameOf(from, locale), to: nameOf(to, locale) }), transfer.note]}
        amounts={totalP ? [{ label: t("st.transfer.value"), value: money(totalP) }] : undefined}
        actions={
          <>
            {transfer.status === "requested" && canDispatch ? (
              <Button onClick={() => setDialog("dispatch")} data-testid="transfer-dispatch">
                <Truck />
                {t("st.transfer.dispatch")}
              </Button>
            ) : null}
            {transfer.status === "dispatched" && canReceive ? (
              <Button onClick={() => setDialog("receive")} data-testid="transfer-receive">
                <PackageCheck />
                {t("st.transfer.receive")}
              </Button>
            ) : null}
            {transfer.status !== "cancelled" ? (
              <Button variant="neutral" onClick={() => setDialog("challan")} data-testid="challan-print">
                <Printer />
                {t("st.transfer.challan")}
              </Button>
            ) : null}
            {transfer.status === "requested" && canCancel ? (
              <Button variant="ghost" onClick={() => setDialog("cancel")}>
                <XCircle />
                {t("st.transfer.cancel")}
              </Button>
            ) : null}
          </>
        }
        links={
          transfer.dispatchJournalId || transfer.receiveJournalId ? (
            <>
              {transfer.dispatchJournalId ? <JournalLink journalId={transfer.dispatchJournalId} label={t("st.transfer.journalDispatch")} /> : null}
              {transfer.receiveJournalId ? <JournalLink journalId={transfer.receiveJournalId} label={t("st.transfer.journalReceive")} /> : null}
            </>
          ) : undefined
        }
      />
      <div className="@container/tr">
        <div className="grid gap-5 @min-[60rem]/tr:grid-cols-[minmax(0,1fr)_18rem]">
          <SectionCard title={t("st.pages.transfer")}>
            <LinesTable
              testId="transfer-lines"
              head={[
                { label: t("st.transfer.item") },
                { label: t("st.transfer.batch"), hide: "md" },
                { label: t("st.transfer.requested"), align: "right", hide: "sm" },
                { label: t("st.transfer.sent"), align: "right" },
                { label: t("st.transfer.received"), align: "right" },
                { label: t("st.transfer.value"), align: "right", hide: "md" },
              ]}
            >
              {lines.map((l) => {
                const item = lookups?.items.get(l.itemId)
                const short = transfer.status === "received" ? roundQty(l.qtySent - l.qtyReceived) : 0
                return (
                  <tr key={l.id} data-testid="transfer-line-row" data-sku={item?.sku}>
                    <td>
                      <ItemCell item={item} />
                      {l.discrepancyNote ? <span className="block text-[0.6875rem] text-warning">{l.discrepancyNote}</span> : null}
                    </td>
                    <td className={HIDE.md}>
                      <span lang="en" className="font-mono text-xs">
                        {l.batchId ? batches.get(l.batchId)?.batchNo : "-"}
                      </span>
                    </td>
                    <td className={cn("text-right", HIDE.sm)}>{l.qtyRequested ? <QtyText value={l.qtyRequested} uom={item?.baseUom} /> : "-"}</td>
                    <td className="text-right">{transfer.dispatchedAt ? <QtyText value={l.qtySent} uom={item?.baseUom} /> : "-"}</td>
                    <td className={cn("text-right", short > 0 && "text-destructive")}>
                      {transfer.status === "received" ? <QtyText value={l.qtyReceived} uom={item?.baseUom} /> : "-"}
                      {short > 0 ? <span className="block text-[0.6875rem]">{t("st.transfer.short")} {formatNumber(short, locale)}</span> : null}
                    </td>
                    <td className={cn("text-right", HIDE.md)}>{l.valueP ? <MoneyText poisha={l.valueP} /> : "-"}</td>
                  </tr>
                )
              })}
            </LinesTable>
          </SectionCard>
          <SectionCard title={t("ic.ui.timeline")} size="sm">
            <Timeline items={steps} />
          </SectionCard>
        </div>
      </div>

      <Dialog open={dialog === "dispatch" || dialog === "receive"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          {dialog === "dispatch" || dialog === "receive" ? (
            <MoveForm mode={dialog} transfer={transfer} lines={lines} items={lookups?.items} locationName={nameOf(dialog === "dispatch" ? from : to, locale)} onClose={() => setDialog(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "cancel"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>{dialog === "cancel" ? <CancelForm transfer={transfer} onClose={() => setDialog(null)} /> : null}</DialogContent>
      </Dialog>
      <PrintPreview open={dialog === "challan"} onOpenChange={(open) => !open && setDialog(null)} title={t("st.transfer.challan")} docNo={transfer.transferNo}>
        <Challan transfer={transfer} lines={lines} items={lookups?.items} users={lookups?.users} />
      </PrintPreview>
    </div>
  )
}

/** Dispatch (quantities sent) or receive (quantities arrived, discrepancy notes). */
function MoveForm({
  mode,
  transfer,
  lines,
  items,
  locationName,
  onClose,
}: {
  mode: "dispatch" | "receive"
  transfer: TransferRow
  lines: TransferLineRow[]
  items: Map<Id, ItemRow> | undefined
  locationName: string
  onClose: () => void
}) {
  const { t } = useLocale()
  const dispatch = useCommand(dispatchTransfer)
  const receive = useCommand(receiveTransfer)
  const shown = mode === "dispatch" ? lines : lines.filter((l) => l.qtySent > 0)
  const [qty, setQty] = React.useState<Record<string, number | null>>(() =>
    Object.fromEntries(shown.map((l) => [l.id, mode === "dispatch" ? l.qtyRequested : l.qtySent]))
  )
  const [notes, setNotes] = React.useState<Record<string, string>>({})
  const [vehicle, setVehicle] = React.useState(transfer.vehicleNo ?? "")
  const pending = dispatch.pending || receive.pending
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out =
          mode === "dispatch"
            ? await dispatch.run({
                transferId: transfer.id,
                expectedVersion: transfer.version,
                vehicleNo: vehicle || undefined,
                lines: shown.map((l) => ({ lineId: l.id, qtySent: qty[l.id] ?? 0 })),
                idempotencyKey: freshKey(),
              })
            : await receive.run({
                transferId: transfer.id,
                expectedVersion: transfer.version,
                lines: shown.map((l) => ({ lineId: l.id, qtyReceived: qty[l.id] ?? 0, note: notes[l.id] || undefined })),
                idempotencyKey: freshKey(),
              })
        if (out) {
          toast.success(mode === "dispatch" ? t("st.transfer.dispatched", { no: transfer.transferNo }) : t("st.transfer.receivedToast", { no: transfer.transferNo }))
          onClose()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{mode === "dispatch" ? t("st.transfer.dispatchTitle", { no: transfer.transferNo }) : t("st.transfer.receiveTitle", { no: transfer.transferNo })}</DialogTitle>
        <DialogDescription>{mode === "dispatch" ? t("st.transfer.dispatchHint", { location: locationName }) : t("st.transfer.receiveHint")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {shown.map((l) => {
          const item = items?.get(l.itemId)
          const expected = mode === "dispatch" ? l.qtyRequested : l.qtySent
          const short = mode === "receive" && (qty[l.id] ?? 0) < expected
          return (
            <div key={l.id} className="flex flex-wrap items-end gap-3 rounded-md bg-surface-raised/40 p-3" data-testid="transfer-move-line">
              <ItemCell item={item} className="min-w-48 flex-1" />
              <span className="text-xs text-muted-foreground">
                {mode === "dispatch" ? t("st.transfer.requested") : t("st.transfer.sent")} <QtyText value={expected} uom={item?.baseUom} />
              </span>
              <QtyInput
                value={qty[l.id] ?? null}
                onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))}
                unit={item?.baseUom}
                className="w-36"
                data-testid={mode === "dispatch" ? "dispatch-qty" : "receive-qty"}
              />
              {short ? (
                <Input
                  value={notes[l.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [l.id]: e.target.value }))}
                  placeholder={t("st.transfer.note")}
                  className="min-w-48 flex-1"
                  data-testid="receive-note"
                />
              ) : null}
            </div>
          )
        })}
      </div>
      {mode === "dispatch" ? (
        <Field label={t("st.transfer.vehicle")}>
          <Input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder={t("st.transfer.vehiclePlaceholder")} className="font-mono" />
        </Field>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending} data-testid={mode === "dispatch" ? "dispatch-submit" : "receive-submit"}>
          {mode === "dispatch" ? t("st.transfer.dispatch") : t("st.transfer.receive")}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CancelForm({ transfer, onClose }: { transfer: TransferRow; onClose: () => void }) {
  const { t } = useLocale()
  const cancel = useCommand(cancelTransfer)
  const [reason, setReason] = React.useState("")
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await cancel.run({ transferId: transfer.id, expectedVersion: transfer.version, reason })
        if (out) {
          toast.success(t("st.transfer.cancelled"))
          onClose()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("st.transfer.cancelTitle", { no: transfer.transferNo })}</DialogTitle>
      </DialogHeader>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ic.ui.reason")} />
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.close")}
        </Button>
        <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || cancel.pending}>
          {t("st.transfer.cancel")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Mushak 6.5: transfer challan between own locations (bilingual labels, Latin numbers). */
function Challan({
  transfer,
  lines,
  items,
  users,
}: {
  transfer: TransferRow
  lines: TransferLineRow[]
  items: Map<Id, ItemRow> | undefined
  users: Map<Id, { nameEn: string }> | undefined
}) {
  const from = brandLocations.find((l) => l.id === transfer.fromLocationId)
  const to = brandLocations.find((l) => l.id === transfer.toLocationId)
  const at = transfer.dispatchedAt ?? transfer.requestedAt
  const shown = lines.filter((l) => (transfer.dispatchedAt ? l.qtySent > 0 : l.qtyRequested > 0))
  const total = shown.reduce((s, l) => s + l.valueP, 0)
  return (
    <PrintLayout showBrand={false} demoFooter={false}>
      <div data-testid="challan">
        <TaxDocHeader form="6.5" docNo={transfer.transferNo} issuedAt={`${isoToDmy(dhakaDate(at))} ${dhakaTime(at)}`} location={from?.code} />
        <div className="mb-4 grid grid-cols-2 gap-4 text-[0.75rem]">
          <div>
            {bi("sender")}
            <div className="mt-1 font-semibold">{from?.name.en}</div>
            <div>{from?.address.bn}</div>
          </div>
          <div>
            {bi("receiver")}
            <div className="mt-1 font-semibold">{to?.name.en}</div>
            <div>{to?.address.bn}</div>
          </div>
          <div>
            {bi("vehicle")}
            <div lang="en" className="mt-1 font-mono">
              {transfer.vehicleNo ?? "-"}
            </div>
          </div>
        </div>
        <table className="w-full border-collapse text-[0.75rem]">
          <thead>
            <tr className="border-y border-[#111] text-left">
              <th className="py-1 pr-2">
                {bi("serial")}
              </th>
              <th className="py-1 pr-2">
                {bi("description")}
              </th>
              <th className="py-1 pr-2 text-right">
                {bi("quantity")}
              </th>
              <th className="py-1 pr-2">
                {bi("unit")}
              </th>
              <th className="py-1 text-right">
                {bi("value")}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => {
              const item = items?.get(l.itemId)
              return (
                <tr key={l.id} className="border-b border-[#ddd]">
                  <td className="py-1 pr-2 font-mono">{i + 1}</td>
                  <td className="py-1 pr-2">
                    {item?.nameBn}
                    <span className="block text-[0.6875rem] text-[#555]">
                      {item?.nameEn} · <span className="font-mono">{item?.sku}</span>
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-right font-mono">{formatNumber(transfer.dispatchedAt ? l.qtySent : l.qtyRequested, "en")}</td>
                  <td className="py-1 pr-2 font-mono">{item?.baseUom}</td>
                  <td className="py-1 text-right font-mono">{l.valueP ? formatMoney(l.valueP, "en") : "-"}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#111] font-semibold">
              <td colSpan={4} className="py-1">
                {bi("totalValue")}
              </td>
              <td className="py-1 text-right font-mono">{formatMoney(total, "en")}</td>
            </tr>
          </tfoot>
        </table>
        <div className="mt-10 grid grid-cols-2 gap-10 text-[0.75rem]">
          <div className="border-t border-[#111] pt-1">
            {bi("dispatchedBy")}
            <div>{transfer.dispatchedBy ? users?.get(transfer.dispatchedBy)?.nameEn : ""}</div>
          </div>
          <div className="border-t border-[#111] pt-1">
            {bi("receivedBy")}
            <div>{transfer.receivedBy ? users?.get(transfer.receivedBy)?.nameEn : ""}</div>
          </div>
        </div>
      </div>
    </PrintLayout>
  )
}
