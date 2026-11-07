"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Beaker, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { QtyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { ItemPicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { VEHICLE_CLASSES, type Id, type ServiceRow, type VehicleClass } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { standardValue } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field } from "@/modules/stl/components/kit"

import { saveRecipe, saveService } from "../commands"
import { effectiveList, recipeFor, servicePrice, variantKey, type Catalogue } from "../pricing"
import { useCatalogue } from "../queries"

/**
 * /pc/services/[id]: a service's variants (duration and price per class on
 * each list), warranty, the recipe per class (the sedan recipe scaled by
 * class, or a class's own rows) with the standard cost of each job, and
 * the add-ons that apply. Owners and accounts managers edit it.
 */
export function ServiceDetail({ id }: { id: Id }) {
  const { t, tk, locale, num } = useLocale()
  const catalogue = useCatalogue()
  const canEdit = useCan("pc.catalog.edit")
  const [cls, setCls] = React.useState<VehicleClass>("SD")
  const [editing, setEditing] = React.useState(false)
  const [recipeFor_, setRecipeFor] = React.useState<VehicleClass | "*" | null>(null)
  const service = catalogue?.services.get(id)
  if (!catalogue) return null
  if (!service) return <EmptyState icon={Sparkles} title={t("pc.service.notFound")} action={{ label: t("pc.pages.home"), href: "/pc" }} />
  const today = dhakaDate(now())
  const lists = (["RETAIL", "FLEET", "DEALER"] as const).map((code) => {
    const row = catalogue.priceLists.find((l) => l.code === code && l.status !== "draft")
    return { code, list: effectiveList(catalogue, row?.id, today) }
  })
  const recipe = recipeFor(catalogue, service.id, cls)
  const classRows = catalogue.recipes.some((r) => r.serviceId === service.id && r.vehicleClass === cls)
  const recipeCost = recipe.reduce((s, r) => {
    const item = catalogue.items.get(r.itemId)
    return s + (item ? standardValue(item, r.qtyBase) : 0)
  }, 0)
  const addOns = [...catalogue.addOns.values()].filter((a) => a.appliesTo.includes(service.category))
  const retail = lists[0].list

  return (
    <div className="flex flex-col gap-4" data-testid="service-detail">
      <PageHeader
        title={nameOf(service, locale)}
        subtitle={
          <>
            <span lang="en" className="font-mono">{service.code}</span> · {tk(`reports.enum.category.${service.category}`)}
            {!service.active ? ` · ${t("shared.status.inactive")}` : ""}
          </>
        }
        actions={
          <>
            <Button variant="ghost" nativeButton={false} render={<Link href="/pc" />}>
              {t("pc.pages.home")}
            </Button>
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditing(true)} data-testid="service-edit">
                <Pencil data-icon="inline-start" />
                {t("pc.service.edit")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard title={t("pc.service.variants")} size="sm">
          <div className="@container/var overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]" data-testid="variants">
              <thead>
                <tr className="text-left">
                  <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("pc.service.class")}</th>
                  <th className="bg-surface-raised px-3 py-2 text-right font-medium">{t("pc.catalogue.duration")}</th>
                  {lists.map((l, i) => (
                    <th key={l.code} className={cn("bg-surface-raised px-3 py-2 text-right font-medium", i === lists.length - 1 && "rounded-r-md", i > 0 && "hidden @min-[30rem]/var:table-cell")}>
                      <span lang="en" className="font-mono">{l.code}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VEHICLE_CLASSES.map((c) => {
                  const v = catalogue.variants.get(variantKey(service.id, c))
                  return (
                    <tr key={c}>
                      <td className="border-b border-hairline px-3 py-2">{tk(`reports.enum.vehicleClass.${c}`)}</td>
                      <td className="border-b border-hairline px-3 py-2 text-right nums">{v ? t("stl.quote.minutes", { min: num(v.durationMin) }) : "-"}</td>
                      {lists.map((l, i) => (
                        <td key={l.code} className={cn("border-b border-hairline px-3 py-2 text-right font-mono", i > 0 && "hidden @min-[30rem]/var:table-cell")}>
                          <MoneyText poisha={servicePrice(catalogue, l.list, service.id, c)} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <SectionCard title={t("pc.service.about")} size="sm">
          <KeyValueGrid
            items={[
              { label: t("pc.catalogue.warranty"), value: service.warrantyMonths ? t("pc.catalogue.months", { count: num(service.warrantyMonths) }) : t("pc.service.noWarranty") },
              { label: t("pc.service.revenue"), value: <span lang="en" className="font-mono text-xs">{service.revenueTag}</span> },
              { label: t("common.description"), value: locale === "bn" ? service.descriptionBn || "-" : service.descriptionEn || "-", wide: true },
            ]}
          />
          {addOns.length ? (
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("pc.service.addOns")}</div>
              <ul className="flex flex-col gap-1 text-[0.8125rem]">
                {addOns.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className="truncate">{nameOf(a, locale)}</span>
                    <MoneyText poisha={a.priceP} className="font-mono" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard
        title={t("pc.service.recipe")}
        icon={Beaker}
        size="sm"
        action={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setRecipeFor("*")} data-testid="recipe-edit-base">
                {t("pc.service.editBase")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRecipeFor(cls)} data-testid="recipe-edit-class">
                {t("pc.service.editClass", { cls })}
              </Button>
            </div>
          ) : null
        }
      >
        <div className="mb-3 flex flex-wrap gap-1" role="tablist">
          {VEHICLE_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={cls === c}
              onClick={() => setCls(c)}
              data-testid="recipe-class"
              data-class={c}
              className={cn("h-8 rounded-full px-3 text-[0.8125rem]", cls === c ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground hover:text-foreground")}
            >
              {tk(`reports.enum.vehicleClass.${c}`)}
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{classRows ? t("pc.service.classOwn") : t("pc.service.classScaled", { factor: num(({ HB: 0.85, SD: 1, SUV: 1.25, LSUV: 1.5, MPV: 1.5 } as const)[cls]) })}</p>
        {recipe.length ? (
          <div className="@container/rc overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="text-left">
                  <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("common.item")}</th>
                  <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[30rem]/rc:table-cell">{t("pc.service.sedanQty")}</th>
                  <th className="bg-surface-raised px-3 py-2 text-right font-medium">{t("pc.service.classQty", { cls })}</th>
                  <th className="rounded-r-md bg-surface-raised px-3 py-2 text-right font-medium">{t("pc.service.stdCost")}</th>
                </tr>
              </thead>
              <tbody>
                {recipe.map((r) => {
                  const item = catalogue.items.get(r.itemId)
                  return (
                    <tr key={r.itemId} data-testid="recipe-row" data-sku={item?.sku}>
                      <td className="border-b border-hairline px-3 py-2">
                        <div className="truncate">{nameOf(item, locale)}</div>
                        <div lang="en" className="font-mono text-xs text-muted-foreground">{item?.sku}</div>
                      </td>
                      <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono nums @min-[30rem]/rc:table-cell">
                        {num(r.sedanQty, { maximumFractionDigits: 3 })} {item?.baseUom}
                      </td>
                      <td className="border-b border-hairline px-3 py-2 text-right font-mono nums font-medium">
                        {num(r.qtyBase, { maximumFractionDigits: 3 })} {item?.baseUom}
                      </td>
                      <td className="border-b border-hairline px-3 py-2 text-right font-mono">{item ? <MoneyText poisha={standardValue(item, r.qtyBase)} /> : "-"}</td>
                    </tr>
                  )
                })}
                <tr className="font-semibold">
                  <td className="rounded-l-md bg-surface-raised px-3 py-2">{t("pc.service.jobCost")}</td>
                  <td className="hidden bg-surface-raised @min-[30rem]/rc:table-cell" />
                  <td className="bg-surface-raised px-3 py-2 text-right text-xs font-normal text-muted-foreground">
                    {retail ? t("pc.service.margin", { pct: num(Math.round((1 - recipeCost / Math.max(1, servicePrice(catalogue, retail, service.id, cls))) * 1000) / 10) }) : null}
                  </td>
                  <td className="rounded-r-md bg-surface-raised px-3 py-2 text-right font-mono">
                    <MoneyText poisha={recipeCost} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t("pc.service.noRecipe")}</p>
        )}
      </SectionCard>
      {editing ? <ServiceDialog service={service} catalogue={catalogue} onClose={() => setEditing(false)} /> : null}
      {recipeFor_ ? <RecipeDialog service={service} catalogue={catalogue} vehicleClass={recipeFor_} onClose={() => setRecipeFor(null)} /> : null}
    </div>
  )
}

function ServiceDialog({ service, catalogue, onClose }: { service: ServiceRow; catalogue: Catalogue; onClose: () => void }) {
  const { t, tk } = useLocale()
  const save = useCommand(saveService)
  const [form, setForm] = React.useState({
    nameEn: service.nameEn,
    nameBn: service.nameBn,
    descriptionEn: service.descriptionEn,
    descriptionBn: service.descriptionBn,
    warrantyMonths: service.warrantyMonths ?? 0,
    active: service.active,
  })
  const [durations, setDurations] = React.useState<Record<VehicleClass, number | null>>(
    () => Object.fromEntries(VEHICLE_CLASSES.map((c) => [c, catalogue.variants.get(variantKey(service.id, c))?.durationMin ?? 60])) as Record<VehicleClass, number | null>
  )
  const submit = async () => {
    const out = await save.run({
      serviceId: service.id,
      expectedVersion: service.version,
      code: service.code,
      category: service.category,
      ...form,
      warrantyMonths: form.warrantyMonths || undefined,
      variants: VEHICLE_CLASSES.map((c) => ({
        vehicleClass: c,
        durationMin: durations[c] ?? 60,
        basePriceP: catalogue.variants.get(variantKey(service.id, c))?.basePriceP ?? 0,
        active: true,
      })),
    })
    if (out) {
      toast.success(t("pc.service.saved", { code: service.code }))
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="service-dialog">
        <DialogHeader>
          <DialogTitle>{t("pc.service.editTitle", { code: service.code })}</DialogTitle>
          <DialogDescription>{t("pc.service.editBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("stl.quick.nameEn")}>
            <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          </Field>
          <Field label={t("stl.quick.nameBn")}>
            <Input value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} />
          </Field>
          <Field label={t("pc.service.descEn")} className="sm:col-span-2">
            <Textarea value={form.descriptionEn} onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })} className="min-h-14" />
          </Field>
          <Field label={t("pc.service.descBn")} className="sm:col-span-2">
            <Textarea value={form.descriptionBn} onChange={(e) => setForm({ ...form, descriptionBn: e.target.value })} className="min-h-14" />
          </Field>
          <Field label={t("pc.service.warrantyMonths")}>
            <QtyInput value={form.warrantyMonths} onChange={(v) => setForm({ ...form, warrantyMonths: v ?? 0 })} unit={t("pc.service.monthsUnit")} />
          </Field>
          <label className="flex items-center justify-between gap-3 self-end pb-2 text-[0.8125rem]">
            {t("shared.status.active")}
            <Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} />
          </label>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {VEHICLE_CLASSES.map((c) => (
            <Field key={c} label={<span title={tk(`reports.enum.vehicleClass.${c}`)} lang="en" className="font-mono">{c}</span>}>
              <QtyInput value={durations[c]} onChange={(v) => setDurations((d) => ({ ...d, [c]: v }))} unit="min" />
            </Field>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("pc.service.pricesHint")}</p>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={save.pending || form.nameEn.trim().length < 2} data-testid="service-save">
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecipeDialog({ service, catalogue, vehicleClass, onClose }: { service: ServiceRow; catalogue: Catalogue; vehicleClass: VehicleClass | "*"; onClose: () => void }) {
  const db = useDb()
  const { t, locale } = useLocale()
  const save = useCommand(saveRecipe)
  const start = catalogue.recipes.filter((r) => r.serviceId === service.id && r.vehicleClass === vehicleClass).map((r) => ({ itemId: r.itemId, qty: r.qtyBase as number | null }))
  const [rows, setRows] = React.useState(start.length || vehicleClass === "*" ? start : recipeFor(catalogue, service.id, vehicleClass).map((r) => ({ itemId: r.itemId, qty: r.qtyBase as number | null })))
  const [itemId, setItemId] = React.useState<Id | null>(null)
  const items = useLiveQuery(() => db.items.bulkGet(rows.map((r) => r.itemId)), [db, rows.map((r) => r.itemId).join(",")])
  const submit = async () => {
    const out = await save.run({ serviceId: service.id, vehicleClass, lines: rows.filter((r) => r.qty && r.qty > 0).map((r) => ({ itemId: r.itemId, qtyBase: r.qty! })) })
    if (out) {
      toast.success(t("pc.service.recipeSaved", { code: service.code }))
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="recipe-dialog">
        <DialogHeader>
          <DialogTitle>{vehicleClass === "*" ? t("pc.service.editBase") : t("pc.service.editClass", { cls: vehicleClass })}</DialogTitle>
          <DialogDescription>{vehicleClass === "*" ? t("pc.service.baseBody") : t("pc.service.classBody")}</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {rows.map((r, i) => {
            const item = items?.[i]
            return (
              <li key={r.itemId} className="flex items-center gap-2 rounded-md bg-surface-raised/60 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                  {nameOf(item ?? undefined, locale)} <span lang="en" className="font-mono text-xs text-muted-foreground">{item?.sku}</span>
                </span>
                <QtyInput value={r.qty} onChange={(v) => setRows((cur) => cur.map((x, k) => (k === i ? { ...x, qty: v } : x)))} unit={item?.baseUom} className="w-28" />
                <Button variant="ghost" size="icon-sm" aria-label={t("common.remove")} onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}>
                  <Trash2 />
                </Button>
              </li>
            )
          })}
        </ul>
        <div className="flex gap-2">
          <ItemPicker value={itemId} onChange={(id) => setItemId(id)} kinds={["chemical", "consumable"]} className="min-w-0 flex-1" testId="recipe-item" />
          <Button
            variant="outline"
            disabled={!itemId || rows.some((r) => r.itemId === itemId)}
            onClick={() => {
              if (itemId) setRows((cur) => [...cur, { itemId, qty: null }])
              setItemId(null)
            }}
          >
            <Plus data-icon="inline-start" />
            {t("common.add")}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={save.pending} data-testid="recipe-save">
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
