"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { PackageCheck, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyText } from "@/components/shared/money-text"
import { QtyInput } from "@/components/shared/money-input"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { Id, PoLineRow, RejectReason } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import {
  Field,
  ItemCell,
  NotFound,
  OptionSelect,
  freshKey,
  useScmLookups,
} from "@/modules/ic/components/scm-ui"

import { poLineProgress, receiveGoods } from "../commands"

type Lot = {
  key: string
  poLineId: Id
  accepted: number | null
  rejected: number | null
  reason: RejectReason | ""
  quarantine: boolean
  batchNo: string
  expiry: string
}

const REASONS: RejectReason[] = [
  "damaged",
  "short-expiry",
  "wrong-item",
  "other",
]

const lotFor = (poLineId: Id, accepted: number | null): Lot => ({
  key: newId("lot"),
  poLineId,
  accepted,
  rejected: null,
  reason: "",
  quarantine: true,
  batchNo: "",
  expiry: "",
})

/**
 * /grn/receive/[poId]: lots with batch and expiry, accepted and rejected
 * quantities with a QC reason and quarantine; "18 accepted · 6 pending" per
 * line as you type; posting receives stock at the PO cost with R12.
 */
export function ReceiveForm({ poId }: { poId: string }) {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, num, money, unit } = useLocale()
  const lookups = useScmLookups()
  const receive = useCommand(receiveGoods)
  const [challan, setChallan] = React.useState("")
  const [note, setNote] = React.useState("")
  const [lots, setLots] = React.useState<Lot[] | null>(null)

  const data = useLiveQuery(async () => {
    const po = await db.purchaseOrders.get(poId)
    if (!po) return { po: undefined }
    const lines = (await db.poLines.where("poId").equals(poId).toArray()).sort(
      (a, b) => a.lineNo - b.lineNo
    )
    const held = new Map<Id, number>()
    for (const l of lines) {
      const grnLines = await db.grnLines
        .where("poLineId")
        .equals(l.id)
        .toArray()
      held.set(
        l.id,
        grnLines
          .filter((g) => g.quarantineStatus === "held")
          .reduce((s, g) => s + g.qtyRejected, 0)
      )
    }
    return { po, lines, held }
  }, [db, poId])
  const canReceive = useCan("grn.receive.create", data?.po?.locationId)

  if (data === undefined || !lookups) return null
  if (!data.po)
    return (
      <NotFound
        title={t("grn.receive.notFound")}
        backHref="/grn"
        backLabel={t("grn.receive.back")}
      />
    )
  const { po, lines, held } = data
  const progress = (line: PoLineRow) =>
    poLineProgress(line, held.get(line.id) ?? 0)
  const current =
    lots ??
    lines
      .filter((l) => progress(l).open > 0)
      .map((l) => lotFor(l.id, progress(l).open))
  const set = (key: string, patch: Partial<Lot>) =>
    setLots(current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const open = po.status === "issued" || po.status === "partial"
  const valueP = current.reduce(
    (s, lot) =>
      s +
      Math.round(
        (lot.accepted ?? 0) *
          (lines.find((l) => l.id === lot.poLineId)?.unitCostP ?? 0)
      ),
    0
  )
  const any = current.some(
    (l) => (l.accepted ?? 0) > 0 || (l.rejected ?? 0) > 0
  )

  const submit = async () => {
    const out = await receive.run({
      poId: po.id,
      expectedVersion: po.version,
      vendorChallanNo: challan || undefined,
      note: note || undefined,
      lots: current
        .filter((l) => (l.accepted ?? 0) > 0 || (l.rejected ?? 0) > 0)
        .map((l) => ({
          poLineId: l.poLineId,
          qtyAccepted: l.accepted ?? 0,
          qtyRejected: l.rejected ?? 0,
          rejectReason:
            (l.rejected ?? 0) > 0 && l.reason ? l.reason : undefined,
          quarantine: l.quarantine,
          batchNo: l.batchNo || undefined,
          expiry: l.expiry || undefined,
        })),
      idempotencyKey: freshKey(),
    })
    if (out) {
      toast.success(t("grn.receive.posted", { no: out.grnNo }))
      router.push(`/grn/${out.id}`)
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="grn-receive-form">
      <PageHeader
        title={t("grn.receive.title")}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <DocLink docType="purchaseOrders" docId={po.id} docNo={po.poNo} />·{" "}
            {t("grn.receive.subtitle", {
              vendor: nameOf(lookups.vendors.get(po.vendorId), locale),
              location: nameOf(lookups.locations.get(po.locationId), locale),
            })}
          </span>
        }
      />
      {!open ? (
        <p className="surface-card p-5 text-[0.8125rem] text-muted-foreground">
          {t("grn.receive.notOpen", {
            status: tk(`shared.status.${po.status}`),
          })}
        </p>
      ) : null}
      <section className="surface-card grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t("grn.receive.challan")}>
          <Input
            value={challan}
            onChange={(e) => setChallan(e.target.value)}
            className="font-mono"
            data-testid="grn-challan"
          />
        </Field>
        <Field label={t("grn.receive.note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </section>

      {lines.map((line) => {
        const item = lookups.items.get(line.itemId)
        const p = progress(line)
        const lineLots = current.filter((l) => l.poLineId === line.id)
        const entered = lineLots.reduce((s, l) => s + (l.accepted ?? 0), 0)
        const accepted = roundQty(p.accepted + entered)
        const pending = Math.max(0, roundQty(line.qty - accepted))
        return (
          <section
            key={line.id}
            className="surface-card flex flex-col gap-3 p-5"
            data-testid="grn-po-line"
            data-sku={item?.sku}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <ItemCell item={item} className="min-w-48" />
              <div className="flex flex-col items-end gap-0.5 text-[0.8125rem]">
                <span className="text-muted-foreground">
                  {t("grn.receive.ordered")}{" "}
                  <span className="nums">{num(line.qty)}</span>{" "}
                  <span lang="en">{item?.purchaseUom}</span>
                </span>
                <span
                  className={cn(
                    "nums font-semibold",
                    pending === 0 ? "text-success" : "text-info"
                  )}
                  data-testid="grn-progress"
                  data-sku={item?.sku}
                >
                  {t("grn.progress", {
                    accepted: num(accepted),
                    pending: num(pending),
                  })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("grn.receive.unitCost", {
                    cost: money(line.unitCostP),
                    unit: unit(item?.purchaseUom ?? ""),
                  })}
                </span>
              </div>
            </div>
            {p.open <= 0 && !lineLots.length ? (
              <p className="text-xs text-muted-foreground">
                {t("grn.receive.nothingOpen")}
              </p>
            ) : null}
            {lineLots.map((lot) => (
              <div
                key={lot.key}
                className="@container/lot grid gap-3 rounded-md bg-surface-raised/40 p-3 sm:grid-cols-2 lg:grid-cols-4"
                data-testid="grn-line"
                data-sku={item?.sku}
              >
                <Field
                  label={`${t("grn.receive.accept")} (${item?.purchaseUom ?? ""})`}
                >
                  <QtyInput
                    value={lot.accepted}
                    onChange={(v) => set(lot.key, { accepted: v })}
                    unit={item?.purchaseUom}
                    data-testid="grn-accept-qty"
                    disabled={!open}
                  />
                </Field>
                <Field
                  label={`${t("grn.receive.reject")} (${item?.purchaseUom ?? ""})`}
                >
                  <QtyInput
                    value={lot.rejected}
                    onChange={(v) => set(lot.key, { rejected: v })}
                    unit={item?.purchaseUom}
                    data-testid="grn-reject-qty"
                    disabled={!open}
                  />
                </Field>
                <Field label={t("grn.receive.reason")}>
                  <OptionSelect
                    value={lot.reason || "none"}
                    onChange={(v) =>
                      set(lot.key, {
                        reason: v === "none" ? "" : (v as RejectReason),
                      })
                    }
                    label={t("grn.receive.reason")}
                    testId="grn-reject-reason"
                    className="w-full"
                    options={[
                      { value: "none", label: t("grn.receive.chooseReason") },
                      ...REASONS.map((r) => ({
                        value: r,
                        label: t(`grn.reason.${r}`),
                      })),
                    ]}
                  />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2.5 text-[0.8125rem]">
                  <Checkbox
                    checked={lot.quarantine}
                    onCheckedChange={(v) => set(lot.key, { quarantine: !!v })}
                    disabled={!(lot.rejected ?? 0)}
                    data-testid="grn-quarantine"
                  />
                  {t("grn.receive.quarantine")}
                </label>
                <Field
                  label={t("grn.receive.batch")}
                  hint={item?.trackBatch ? t("grn.receive.tracked") : undefined}
                >
                  <Input
                    value={lot.batchNo}
                    onChange={(e) =>
                      set(lot.key, { batchNo: e.target.value.toUpperCase() })
                    }
                    className="font-mono"
                    data-testid="grn-batch"
                    disabled={!open}
                  />
                </Field>
                <Field label={t("grn.receive.expiry")}>
                  <DateField
                    value={lot.expiry}
                    onChange={(iso) => set(lot.key, { expiry: iso })}
                    data-testid="grn-expiry"
                    disabled={!open}
                  />
                </Field>
                <div className="flex items-end justify-end lg:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setLots(current.filter((l) => l.key !== lot.key))
                    }
                    aria-label={t("grn.receive.removeLot")}
                  >
                    <Trash2 />
                    {t("grn.receive.removeLot")}
                  </Button>
                </div>
              </div>
            ))}
            {open && p.open > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setLots([...current, lotFor(line.id, null)])}
                data-testid="grn-add-lot"
              >
                <Plus />
                {t("grn.receive.addLot")}
              </Button>
            ) : null}
          </section>
        )
      })}

      <section className="surface-card flex flex-wrap items-center justify-between gap-4 p-5">
        <span className="text-[0.8125rem] text-muted-foreground">
          {t("grn.receive.value")}{" "}
          <MoneyText
            poisha={valueP}
            className="ml-2 text-base font-semibold text-foreground"
          />
        </span>
        {canReceive && open ? (
          <Button
            onClick={submit}
            disabled={!any || receive.pending}
            data-testid="grn-submit"
          >
            <PackageCheck />
            {t("grn.receive.submit")}
          </Button>
        ) : null}
      </section>
    </div>
  )
}
