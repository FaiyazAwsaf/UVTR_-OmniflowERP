"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Boxes, Car, Package, PlusCircle, ShoppingBag, Trash2 } from "lucide-react"

import { useInlineApproval } from "@/components/shared/approval-dialog"
import { MoneyText } from "@/components/shared/money-text"
import { QtyInput } from "@/components/shared/money-input"
import { PageHeader } from "@/components/shared/page-header"
import { ItemPicker, PartyPicker, ServicePicker, VehiclePicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { rules } from "@/config/rules.config"
import type { InlineApproval } from "@/core/approvals/approvals"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan, useLimit } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { effectiveList, priceRequests, promotionApplies, type LineRequest } from "@/modules/pc/pricing"
import { useCatalogue } from "@/modules/pc/queries"

import { createOrder, saveQuotation } from "../commands"
import { requestsFromLines } from "../quote-requests"
import { DepositFields, NO_DEPOSIT, useDepositFlow, type DepositState } from "./deposit"
import { ClassTag, Field, newKey, TotalsBlock, useStudio } from "./kit"
import { QuickAddCustomer } from "./quick-add"

/**
 * The quotation editor (/stl/quotations/new, `?id=` revises a draft) and the
 * booking form (/stl/orders/new): customer and vehicle by registration or
 * phone, services priced by the vehicle's class on the party's list,
 * packages exploded pro rata, add-ons and retail goods, discount within
 * the user's limit or an inline approval (E1), and for a booking the
 * deposit through the simulated terminal or push.
 */
export function QuoteEditor({ mode }: { mode: "quote" | "order" }) {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const editId = mode === "quote" ? params.get("id") : null
  const { t, tk, locale, num, dmy } = useLocale()
  const { locationId: sessionLocation } = useSession()
  const studio = useStudio()
  const locationId = studio.locationId ?? sessionLocation
  const catalogue = useCatalogue()
  const discountLimit = useLimit("discount-pct")
  const canCreate = useCan(mode === "quote" ? "stl.quote.create" : "stl.order.create", locationId)
  const { requestApproval, dialog } = useInlineApproval()
  const deposit = useDepositFlow()
  const save = useCommand(saveQuotation)
  const book = useCommand(createOrder)

  const [partyId, setPartyId] = React.useState<Id | null>(params.get("party"))
  const [vehicleId, setVehicleId] = React.useState<Id | null>(params.get("vehicle"))
  const [requests, setRequests] = React.useState<LineRequest[]>([])
  const [discountPct, setDiscountPct] = React.useState(0)
  const [promotionId, setPromotionId] = React.useState<Id | null>(null)
  const [notes, setNotes] = React.useState("")
  const [odometer, setOdometer] = React.useState<number | null>(null)
  const [dep, setDep] = React.useState<DepositState>(NO_DEPOSIT)
  const [itemId, setItemId] = React.useState<Id | null>(null)
  const [itemQty, setItemQty] = React.useState<number | null>(1)
  const [loadedEdit, setLoadedEdit] = React.useState<string | null>(null)

  const editing = useLiveQuery(async () => {
    if (!editId) return null
    const q = await db.quotations.get(editId)
    if (!q) return null
    const lines = await db.quotationLines.where("quotationId").equals(q.id).sortBy("lineNo")
    return { q, lines }
  }, [db, editId])

  if (editing && loadedEdit !== editing.q.id) {
    // Rebuild the requests from the saved lines (packages once each).
    setLoadedEdit(editing.q.id)
    setPartyId(editing.q.partyId)
    setVehicleId(editing.q.vehicleId ?? null)
    setDiscountPct(editing.q.discountPct)
    setPromotionId(editing.q.promotionId ?? null)
    setNotes(editing.q.inspectionNotes)
    setRequests(requestsFromLines(editing.lines))
  }

  const party = useLiveQuery(() => (partyId ? db.parties.get(partyId) : undefined), [db, partyId])
  const vehicle = useLiveQuery(() => (vehicleId ? db.vehicles.get(vehicleId) : undefined), [db, vehicleId])
  const today = dhakaDate(now())
  const list = catalogue && party ? effectiveList(catalogue, party.priceListId, today) : undefined
  const priced = catalogue
    ? priceRequests(catalogue, {
        priceListId: party?.priceListId,
        date: today,
        vehicleClass: vehicle?.vehicleClass,
        requests,
        discountPct,
        promotionId,
      })
    : undefined
  const promotions = [...(catalogue?.promotions.values() ?? [])].filter((p) => promotionApplies(p, today, priced?.subtotalP ?? 0))
  const needsClass = requests.some((r) => r.kind === "service" || r.kind === "package")
  const canSave = !!party && requests.length > 0 && (!needsClass || !!vehicle) && !!priced && !priced.problems.length && canCreate
  const overLimit = discountPct > discountLimit

  const add = (req: LineRequest) => setRequests((rs) => [...rs, req])
  const removeRequestOf = (lineIndex: number) => {
    // Lines of one package share a request; remove that request.
    if (!priced) return
    const line = priced.lines[lineIndex]
    setRequests((rs) => {
      let cursor = 0
      return rs.filter((r) => {
        const width = r.kind === "package" ? (catalogue?.packages.get(r.packageId)?.serviceIds.length ?? 1) : 1
        const covers = lineIndex >= cursor && lineIndex < cursor + width
        cursor += width
        return !(covers && (r.kind !== "package" || r.packageId === line.packageId))
      })
    })
  }

  const approval = async (): Promise<InlineApproval | undefined | null> => {
    if (!overLimit) return undefined
    return requestApproval({
      kind: "discount-pct",
      docType: mode === "quote" ? "quotations" : "salesOrders",
      locationId,
      pct: discountPct,
      description: t("stl.quote.discountAsk", { pct: num(discountPct), limit: num(discountLimit) }),
    })
  }

  const submit = async () => {
    if (!party || !canSave) return
    const inline = await approval()
    if (inline === null) return
    if (mode === "quote") {
      const out = await save.run({
        quotationId: editing?.q.id,
        expectedVersion: editing?.q.version,
        locationId: locationId ?? undefined,
        partyId: party.id,
        vehicleId: vehicle?.id,
        requests,
        discountPct,
        promotionId: promotionId ?? undefined,
        inspectionNotes: notes,
        inline: inline ?? undefined,
      })
      if (out) router.push(`/stl/quotations/${out.quotationId}`)
      return
    }
    const idempotencyKey = newKey()
    await deposit.run(dep, party.phone, async (d) => {
      const out = await book.run({
        locationId: locationId ?? undefined,
        partyId: party.id,
        vehicleId: vehicle?.id,
        requests,
        discountPct,
        promotionId: promotionId ?? undefined,
        inline: inline ?? undefined,
        conditionNotes: notes || undefined,
        odometerKm: odometer ?? undefined,
        deposit: d,
        idempotencyKey,
      })
      if (out) router.push(`/stl/orders/${out.orderId}`)
      return !!out
    })
  }

  const title = mode === "quote" ? (editing ? t("stl.quote.revise", { no: editing.q.quoteNo }) : t("stl.pages.quotationNew")) : t("stl.pages.orderNew")

  return (
    <div className="@container/editor flex flex-col gap-4" data-testid={mode === "quote" ? "quote-editor" : "order-editor"}>
      <PageHeader
        title={title}
        subtitle={mode === "quote" ? t("stl.quote.subtitle", { days: num(rules.quoteValidityDays) }) : t("stl.order.newSubtitle")}
        actions={
          <Button variant="neutral" nativeButton={false} render={<Link href={mode === "quote" ? "/stl/quotations" : "/stl/orders"} />}>
            {t("common.cancel")}
          </Button>
        }
      />
      <div className="grid gap-4 @min-[64rem]/editor:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("stl.quote.customer")} icon={Car} size="sm" action={<QuickAddCustomer onAdded={(p, v) => { setPartyId(p); setVehicleId(v ?? null) }} />}>
            <div className="grid gap-3 @min-[40rem]/editor:grid-cols-2">
              <Field label={t("common.customer")}>
                <PartyPicker
                  value={partyId}
                  testId="quote-party"
                  onChange={(id) => {
                    setPartyId(id)
                    if (vehicle && vehicle.partyId !== id) setVehicleId(null)
                  }}
                />
              </Field>
              <Field label={t("common.vehicle")} hint={!partyId ? t("stl.quote.vehicleHint") : undefined}>
                <VehiclePicker
                  value={vehicleId}
                  partyId={partyId}
                  testId="quote-vehicle"
                  onChange={(id, v) => {
                    setVehicleId(id)
                    if (v && v.partyId !== partyId) setPartyId(v.partyId)
                  }}
                />
              </Field>
            </div>
            {party ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground" data-testid="quote-party-info">
                <span lang="en" className="font-mono">{party.code}</span>
                <span lang="en" className="font-mono">{party.phone}</span>
                <span>{tk(`reports.enum.segment.${party.segment}`)}</span>
                {list ? <span>{t("stl.quote.priceList", { list: nameOf(list, locale) })}</span> : null}
                {vehicle ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ClassTag cls={vehicle.vehicleClass} /> {tk(`reports.enum.vehicleClass.${vehicle.vehicleClass}`)}
                  </span>
                ) : null}
                {party.status !== "active" ? <span className="font-medium text-warning">{t("shared.picker.onHold")}</span> : null}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title={t("stl.quote.services")} icon={Boxes} size="sm">
            <div className="grid gap-3 @min-[40rem]/editor:grid-cols-2">
              <Field label={t("stl.quote.addService")}>
                <ServicePicker
                  value={null}
                  vehicleClass={vehicle?.vehicleClass}
                  testId="quote-add-service"
                  onChange={(id) => id && add({ kind: "service", serviceId: id })}
                />
              </Field>
              <Field label={t("stl.quote.addPackage")}>
                <Select value="" onValueChange={(v) => v && add({ kind: "package", packageId: v as Id })}>
                  <SelectTrigger data-testid="quote-add-package">
                    <SelectValue>{() => <span className="text-muted-foreground">{t("stl.quote.choosePackage")}</span>}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[...(catalogue?.packages.values() ?? [])].filter((p) => p.active).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <Package className="size-4 text-muted-foreground" /> {nameOf(p, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("stl.quote.addAddOn")}>
                <Select value="" onValueChange={(v) => v && add({ kind: "add-on", addOnId: v as Id })}>
                  <SelectTrigger data-testid="quote-add-addon">
                    <SelectValue>{() => <span className="text-muted-foreground">{t("stl.quote.chooseAddOn")}</span>}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[...(catalogue?.addOns.values() ?? [])].filter((a) => a.active).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <PlusCircle className="size-4 text-muted-foreground" /> {nameOf(a, locale)}
                        <span className="ml-auto pl-3 text-xs">
                          <MoneyText poisha={a.priceP} />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("stl.quote.addItem")}>
                <div className="flex gap-2">
                  <ItemPicker value={itemId} onChange={(id) => setItemId(id)} kinds={["retail"]} className="min-w-0 flex-1" testId="quote-item" />
                  <QtyInput value={itemQty} onChange={setItemQty} unit="pc" className="w-24" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("common.add")}
                    disabled={!itemId || !itemQty || itemQty <= 0}
                    onClick={() => {
                      if (itemId && itemQty) add({ kind: "item", itemId, qty: itemQty })
                      setItemId(null)
                      setItemQty(1)
                    }}
                  >
                    <ShoppingBag />
                  </Button>
                </div>
              </Field>
            </div>
            <LinesTable priced={priced} onRemove={removeRequestOf} />
            {needsClass && !vehicle ? <p className="mt-2 text-xs text-warning">{t("stl.quote.needVehicle")}</p> : null}
          </SectionCard>

          <SectionCard title={mode === "quote" ? t("stl.quote.inspection") : t("stl.order.condition")} size="sm">
            <div className="grid gap-3 @min-[40rem]/editor:grid-cols-[minmax(0,1fr)_12rem]">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("stl.quote.notesPlaceholder")} data-testid="quote-notes" className="min-h-20" />
              {mode === "order" ? (
                <Field label={t("stl.order.odometer")}>
                  <QtyInput value={odometer} onChange={setOdometer} unit="km" />
                </Field>
              ) : null}
            </div>
          </SectionCard>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("stl.quote.summary")} size="sm">
            <div className="flex flex-col gap-3">
              <Field
                label={t("stl.quote.discountPct")}
                hint={overLimit ? <span className="text-warning">{t("stl.quote.needsApproval", { limit: num(discountLimit) })}</span> : t("stl.quote.yourLimit", { limit: num(discountLimit) })}
              >
                <Input
                  type="text"
                  inputMode="decimal"
                  data-testid="quote-discount"
                  value={discountPct ? String(discountPct) : ""}
                  placeholder="0"
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[^\d.]/g, ""))
                    setDiscountPct(Number.isFinite(n) ? Math.min(100, n) : 0)
                  }}
                  className={cn("w-28 text-right font-mono", overLimit && "border-warning")}
                />
              </Field>
              <Field label={t("stl.quote.promotion")}>
                <Select value={promotionId ?? "none"} onValueChange={(v) => setPromotionId(v === "none" ? null : (v as Id))}>
                  <SelectTrigger data-testid="quote-promotion">
                    <SelectValue>
                      {() => {
                        const p = promotionId ? catalogue?.promotions.get(promotionId) : undefined
                        return p ? p.code : t("common.none")
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("common.none")}</SelectItem>
                    {promotions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span lang="en" className="font-mono">{p.code}</span> {nameOf(p, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <TotalsBlock
                rows={[
                  { label: t("common.subtotal"), valueP: priced?.subtotalP ?? 0 },
                  { label: t("common.discount"), valueP: priced?.discountP ?? 0, negative: true },
                  { label: t("common.vat"), valueP: priced?.vatP ?? 0 },
                  { label: t("common.total"), valueP: priced?.totalP ?? 0, strong: true, testId: "quote-total" },
                ]}
              />
              {mode === "quote" ? (
                <p className="text-xs text-muted-foreground">{t("stl.quote.validUntil", { date: dmy(addDaysISO(today, rules.quoteValidityDays)) })}</p>
              ) : (
                <DepositFields value={dep} onChange={setDep} maxP={priced?.totalP ?? 0} />
              )}
              {priced?.durationMin ? (
                <p className="text-xs text-muted-foreground">{t("stl.quote.duration", { hours: num(Math.round((priced.durationMin / 60) * 10) / 10) })}</p>
              ) : null}
              <Button
                className="w-full"
                disabled={!canSave || save.pending || book.pending}
                onClick={submit}
                data-testid={mode === "quote" ? "quote-save" : "order-book"}
              >
                {mode === "quote" ? t("stl.quote.save") : t("stl.order.book")}
              </Button>
              {!canCreate ? <p className="text-xs text-muted-foreground">{t("stl.noPermission")}</p> : null}
            </div>
          </SectionCard>
        </aside>
      </div>
      {dialog}
      {deposit.dialog}
    </div>
  )
}

/** The priced lines (quote-line rows), with a remove action per service, package or item. */
function LinesTable({ priced, onRemove }: { priced: ReturnType<typeof priceRequests> | undefined; onRemove?: (index: number) => void }) {
  const { t, locale, num } = useLocale()
  const catalogue = useCatalogue()
  if (!priced?.lines.length) {
    return <p className="mt-4 rounded-md border border-dashed border-border p-4 text-center text-[0.8125rem] text-muted-foreground">{t("stl.quote.noLines")}</p>
  }
  return (
    <div className="@container/lines mt-4 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr className="text-left">
            <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("common.description")}</th>
            <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[36rem]/lines:table-cell">{t("common.unitPrice")}</th>
            <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[30rem]/lines:table-cell">{t("common.discount")}</th>
            <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[44rem]/lines:table-cell">{t("common.vat")}</th>
            <th className="bg-surface-raised px-3 py-2 text-right font-medium">{t("common.total")}</th>
            <th className="w-10 rounded-r-md bg-surface-raised" />
          </tr>
        </thead>
        <tbody>
          {priced.lines.map((l, i) => {
            const pkg = l.packageId ? catalogue?.packages.get(l.packageId) : undefined
            return (
              <tr key={i} data-testid="quote-line" data-kind={l.kind}>
                <td className="border-b border-hairline px-3 py-2">
                  <div className="font-medium">{locale === "bn" ? l.descriptionBn : l.descriptionEn}</div>
                  <div className="text-xs text-muted-foreground">
                    {pkg ? <span className="mr-2 text-link">{nameOf(pkg, locale)}</span> : null}
                    {l.qty !== 1 ? <span className="nums">{l.qty} × </span> : null}
                    {l.durationMin ? <span>{t("stl.quote.minutes", { min: num(l.durationMin) })}</span> : null}
                  </div>
                </td>
                <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono @min-[36rem]/lines:table-cell">
                  <MoneyText poisha={l.unitPriceP} />
                </td>
                <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono text-muted-foreground @min-[30rem]/lines:table-cell">
                  {l.discountP ? <MoneyText poisha={-l.discountP} /> : "-"}
                </td>
                <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono @min-[44rem]/lines:table-cell">
                  <MoneyText poisha={l.vatP} />
                </td>
                <td className="border-b border-hairline px-3 py-2 text-right font-mono font-medium">
                  <MoneyText poisha={l.totalP} />
                </td>
                <td className="border-b border-hairline px-1 py-2 text-right">
                  {onRemove ? (
                    <Button variant="ghost" size="icon-sm" aria-label={t("common.remove")} onClick={() => onRemove(i)} data-testid="quote-line-remove">
                      <Trash2 />
                    </Button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export { LinesTable }
