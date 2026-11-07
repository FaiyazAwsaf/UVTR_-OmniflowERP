"use client"

import * as React from "react"
import { CalendarCheck, Copy, ListChecks, Percent } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DateText } from "@/components/shared/date-text"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { VEHICLE_CLASSES, type Id, type PriceListRow, type ServiceCategory } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { percentOf } from "@/core/tax/vat"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field, useUserMap } from "@/modules/stl/components/kit"

import { publishPriceList, savePriceList } from "../commands"
import { listStatusOn, servicePrice, variantKey, type Catalogue } from "../pricing"
import { useCatalogue } from "../queries"
import { CATEGORIES } from "./catalogue"

/** First day of the month after a day (the usual valid-from of a revision). */
function firstOfNextMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
}

/**
 * /pc/price-lists: RETAIL, FLEET, DEALER and their revisions with status
 * (draft, published, scheduled, archived) and validity; a list's matrix of
 * service prices by class. Drafts can be adjusted by category (a percent)
 * and published from a date (pc.pricelist.publish): the list of the same
 * code in force until then archives from that date.
 */
export function PriceListsPage() {
  const { t, tk, locale, num } = useLocale()
  const catalogue = useCatalogue()
  const users = useUserMap()
  const canEdit = useCan("pc.catalog.edit")
  const canPublish = useCan("pc.pricelist.publish")
  const today = dhakaDate(now())
  const [selected, setSelected] = React.useState<Id | null>(null)
  const [publishing, setPublishing] = React.useState<PriceListRow | null>(null)
  const [adjusting, setAdjusting] = React.useState<PriceListRow | null>(null)
  const save = useCommand(savePriceList)
  if (!catalogue) return null
  const lists = [...catalogue.priceLists].sort((a, b) => a.code.localeCompare(b.code) || (a.validFrom < b.validFrom ? -1 : 1))
  const list = lists.find((l) => l.id === selected) ?? lists.find((l) => l.status === "draft") ?? lists[0]

  const newDraft = async (from: PriceListRow) => {
    const out = await save.run({
      copyFromId: from.id,
      code: from.code,
      nameEn: `${from.nameEn} (revision)`,
      nameBn: `${from.nameBn} (সংশোধন)`,
      kind: from.kind,
      validFrom: firstOfNextMonth(today),
      basis: from.basis,
      discountPct: from.discountPct,
    })
    if (out) {
      setSelected(out.priceListId)
      toast.success(t("pc.lists.draftCreated", { code: from.code }))
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="pc-price-lists">
      <PageHeader title={t("pc.pages.priceLists")} subtitle={t("pc.lists.subtitle")} />
      <SectionCard title={t("pc.lists.all")} icon={ListChecks} size="sm" action={<span className="text-xs text-muted-foreground">{t("common.demoValues")}</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-[0.8125rem]">
            <thead>
              <tr className="text-left">
                <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("pc.lists.code")}</th>
                <th className="bg-surface-raised px-3 py-2 font-medium">{t("common.name")}</th>
                <th className="bg-surface-raised px-3 py-2 font-medium">{t("pc.lists.basis")}</th>
                <th className="bg-surface-raised px-3 py-2 font-medium">{t("pc.lists.validity")}</th>
                <th className="bg-surface-raised px-3 py-2 font-medium">{t("common.status")}</th>
                <th className="rounded-r-md bg-surface-raised px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => {
                const status = listStatusOn(l, today)
                return (
                  <tr key={l.id} className={cn("cursor-pointer hover:bg-primary-soft", l.id === list?.id && "bg-primary-soft")} onClick={() => setSelected(l.id)} data-testid="price-list-row" data-code={l.code} data-status={status}>
                    <td lang="en" className="border-b border-hairline px-3 py-2 font-mono">{l.code}</td>
                    <td className="border-b border-hairline px-3 py-2">{nameOf(l, locale)}</td>
                    <td className="border-b border-hairline px-3 py-2 text-muted-foreground">
                      {l.basis === "discount-pct" ? t("pc.lists.pctOff", { pct: num(l.discountPct ?? 0) }) : t("pc.lists.override")}
                    </td>
                    <td className="border-b border-hairline px-3 py-2 nums text-muted-foreground">
                      <DateText value={l.validFrom} /> {l.validTo ? <>→ <DateText value={l.validTo} /></> : null}
                    </td>
                    <td className="border-b border-hairline px-3 py-2">
                      <DocStatus status={status === "scheduled" ? "pending" : status} />
                      {status === "scheduled" ? <span className="ml-1 text-xs text-muted-foreground">{t("pc.lists.scheduled")}</span> : null}
                    </td>
                    <td className="border-b border-hairline px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {l.status === "draft" && canPublish ? (
                        <Button size="sm" onClick={() => setPublishing(l)} data-testid="publish-price-list">
                          <CalendarCheck data-icon="inline-start" />
                          {t("pc.lists.publish")}
                        </Button>
                      ) : null}
                      {l.status !== "draft" && status !== "archived" && canEdit ? (
                        <Button size="sm" variant="ghost" onClick={() => newDraft(l)} disabled={save.pending}>
                          <Copy data-icon="inline-start" />
                          {t("pc.lists.revise")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {list ? (
        <SectionCard
          title={`${list.code} · ${nameOf(list, locale)}`}
          subtitle={list.publishedBy ? t("pc.lists.publishedBy", { name: userName(users.get(list.publishedBy), locale) }) : t("pc.lists.draftHint")}
          size="sm"
          action={
            list.status === "draft" && canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setAdjusting(list)} data-testid="price-list-adjust">
                <Percent data-icon="inline-start" />
                {t("pc.lists.adjust")}
              </Button>
            ) : null
          }
        >
          <div className="overflow-x-auto" data-testid="price-list-matrix">
            <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="text-left">
                  <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("common.service")}</th>
                  {VEHICLE_CLASSES.map((c, i) => (
                    <th key={c} className={cn("bg-surface-raised px-3 py-2 text-right font-medium", i === 4 && "rounded-r-md")} title={tk(`reports.enum.vehicleClass.${c}`)}>
                      <span lang="en" className="font-mono">{c}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...catalogue.services.values()]
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="border-b border-hairline px-3 py-1.5">{nameOf(s, locale)}</td>
                      {VEHICLE_CLASSES.map((c) => {
                        const price = servicePrice(catalogue, list, s.id, c)
                        const base = catalogue.variants.get(variantKey(s.id, c))?.basePriceP ?? 0
                        return (
                          <td key={c} className={cn("border-b border-hairline px-3 py-1.5 text-right font-mono", price > base && "text-warning", price < base && "text-info")}>
                            <MoneyText poisha={price} />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("pc.lists.matrixHint")}</p>
        </SectionCard>
      ) : null}
      {publishing ? <PublishDialog list={publishing} today={today} onClose={() => setPublishing(null)} /> : null}
      {adjusting ? <AdjustDialog list={adjusting} catalogue={catalogue} onClose={() => setAdjusting(null)} /> : null}
    </div>
  )
}

function PublishDialog({ list, today, onClose }: { list: PriceListRow; today: string; onClose: () => void }) {
  const { t } = useLocale()
  const publish = useCommand(publishPriceList)
  const [from, setFrom] = React.useState(list.validFrom >= today ? list.validFrom : firstOfNextMonth(today))
  const submit = async () => {
    const out = await publish.run({ priceListId: list.id, validFrom: from, expectedVersion: list.version })
    if (out) {
      toast.success(t("pc.lists.published", { code: list.code }))
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="publish-dialog">
        <DialogHeader>
          <DialogTitle>{t("pc.lists.publishTitle", { code: list.code })}</DialogTitle>
          <DialogDescription>{t("pc.lists.publishBody")}</DialogDescription>
        </DialogHeader>
        <Field label={t("pc.lists.validFrom")}>
          <DateField value={from} onChange={setFrom} min={today} data-testid="publish-from" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="ghost" size="xs" onClick={() => setFrom(addDaysISO(today, 1))}>
            {t("common.tomorrow")}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setFrom(firstOfNextMonth(today))}>
            {t("pc.lists.nextMonth")}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!from || publish.pending} data-testid="publish-confirm">
            {t("pc.lists.publish")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Adjust a draft list: a percent up or down on every class price of a category. */
function AdjustDialog({ list, catalogue, onClose }: { list: PriceListRow; catalogue: Catalogue; onClose: () => void }) {
  const { t, tk } = useLocale()
  const save = useCommand(savePriceList)
  const [category, setCategory] = React.useState<ServiceCategory>("wash")
  const [pct, setPct] = React.useState(5)
  const submit = async () => {
    const lines = [...catalogue.listLines.values()].filter((l) => l.priceListId === list.id)
    const next = lines.map((l) => {
      if (l.targetType !== "service-variant") return { targetType: l.targetType, targetId: l.targetId, vehicleClass: l.vehicleClass, priceP: l.priceP }
      const variant = [...catalogue.variants.values()].find((v) => v.id === l.targetId)
      const svc = variant ? catalogue.services.get(variant.serviceId) : undefined
      const priceP = svc?.category === category ? l.priceP + percentOf(l.priceP, pct) : l.priceP
      return { targetType: l.targetType, targetId: l.targetId, vehicleClass: l.vehicleClass, priceP }
    })
    const out = await save.run({
      priceListId: list.id,
      expectedVersion: list.version,
      code: list.code,
      nameEn: list.nameEn,
      nameBn: list.nameBn,
      kind: list.kind,
      validFrom: list.validFrom,
      basis: list.basis,
      discountPct: list.discountPct,
      lines: next,
    })
    if (out) {
      toast.success(t("pc.lists.adjusted"))
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="adjust-dialog">
        <DialogHeader>
          <DialogTitle>{t("pc.lists.adjust")}</DialogTitle>
          <DialogDescription>{t("pc.lists.adjustBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pc.lists.category")}>
            <Select value={category} onValueChange={(v) => v && setCategory(v as ServiceCategory)}>
              <SelectTrigger>
                <SelectValue>{() => tk(`reports.enum.category.${category}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {tk(`reports.enum.category.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("pc.lists.pct")}>
            <Input value={String(pct)} inputMode="decimal" onChange={(e) => setPct(Number(e.target.value.replace(/[^\d.-]/g, "")) || 0)} className="text-right font-mono" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={save.pending || !pct} data-testid="adjust-save">
            {t("common.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
