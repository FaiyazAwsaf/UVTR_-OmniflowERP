"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"

import { MoneyInput, QtyInput } from "@/components/shared/money-input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import type { ItemRow, VatCategory } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { Field, OptionSelect } from "@/modules/ic/components/scm-ui"

import { saveItem } from "../commands"

const VATS: VatCategory[] = ["standard", "reduced-10", "reduced-7.5", "reduced-5", "exempt"]

type Draft = {
  sku: string
  nameEn: string
  nameBn: string
  categoryId: string
  kind: ItemRow["kind"]
  brand: string
  baseUom: string
  purchaseUom: string
  purchaseFactor: number | null
  salesUom: string
  salesFactor: number | null
  trackBatch: boolean
  shelfLifeDays: number | null
  standardCostP: number | null
  retailPriceP: number | null
  vatCategory: VatCategory
  barcode: string
  status: ItemRow["status"]
}

function draftOf(item?: ItemRow): Draft {
  return {
    sku: item?.sku ?? "",
    nameEn: item?.nameEn ?? "",
    nameBn: item?.nameBn ?? "",
    categoryId: item?.categoryId ?? "cat_chem",
    kind: item?.kind ?? "chemical",
    brand: item?.brand ?? "",
    baseUom: item?.baseUom ?? "ml",
    purchaseUom: item?.purchaseUom ?? "can",
    purchaseFactor: item?.purchaseFactor ?? 5000,
    salesUom: item?.salesUom ?? "",
    salesFactor: item?.salesFactor ?? null,
    trackBatch: item?.trackBatch ?? true,
    shelfLifeDays: item?.shelfLifeDays ?? 730,
    standardCostP: item?.standardCostP ?? null,
    retailPriceP: item?.retailPriceP ?? null,
    vatCategory: item?.vatCategory ?? "standard",
    barcode: item?.barcode ?? "",
    status: item?.status ?? "active",
  }
}

/** Create or edit an item (pm.saveItem): SKU, names, category, units and factors, batch tracking, costs, VAT, barcode. */
export function ItemFormDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: ItemRow
  onSaved?: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="item-form">
        {open ? <ItemForm item={item} onDone={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ItemForm({ item, onDone, onSaved }: { item?: ItemRow; onDone: () => void; onSaved?: (id: string) => void }) {
  const db = useDb()
  const { t, tk, locale, num } = useLocale()
  const save = useCommand(saveItem)
  const [draft, setDraft] = React.useState<Draft>(() => draftOf(item))
  const lookups = useLiveQuery(async () => ({ categories: await db.itemCategories.toArray(), uoms: await db.uoms.toArray() }), [db])
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const uomOptions = (lookups?.uoms ?? []).map((u) => ({ value: u.id, label: `${u.code} · ${nameOf(u, locale)}` }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const out = await save.run({
      id: item?.id,
      expectedVersion: item?.version,
      sku: draft.sku,
      nameEn: draft.nameEn,
      nameBn: draft.nameBn,
      categoryId: draft.categoryId,
      kind: draft.kind,
      brand: draft.brand || undefined,
      baseUom: draft.baseUom,
      purchaseUom: draft.purchaseUom,
      purchaseFactor: draft.purchaseFactor ?? 0,
      salesUom: draft.salesUom || undefined,
      salesFactor: draft.salesUom ? (draft.salesFactor ?? 1) : undefined,
      trackBatch: draft.trackBatch,
      shelfLifeDays: draft.trackBatch && draft.shelfLifeDays ? draft.shelfLifeDays : undefined,
      standardCostP: draft.standardCostP ?? 0,
      retailPriceP: draft.retailPriceP ?? undefined,
      vatCategory: draft.vatCategory,
      barcode: draft.barcode,
      status: draft.status,
    })
    if (out) {
      toast.success(t("pm.form.saved", { sku: draft.sku.toUpperCase() }))
      onDone()
      onSaved?.(out.id)
    }
  }

  return (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{item ? t("pm.form.editTitle", { sku: item.sku }) : t("pm.form.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("pm.form.sku")}>
              <Input data-testid="item-sku" value={draft.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} className="font-mono" required />
            </Field>
            <Field label={t("pm.form.status")}>
              <OptionSelect
                value={draft.status}
                onChange={(v) => set("status", v)}
                label={t("pm.form.status")}
                options={[
                  { value: "active", label: t("pm.form.active") },
                  { value: "inactive", label: t("pm.form.inactive") },
                ]}
              />
            </Field>
            <Field label={t("pm.form.nameEn")}>
              <Input data-testid="item-name-en" value={draft.nameEn} onChange={(e) => set("nameEn", e.target.value)} required />
            </Field>
            <Field label={t("pm.form.nameBn")}>
              <Input value={draft.nameBn} onChange={(e) => set("nameBn", e.target.value)} lang="bn" />
            </Field>
            <Field label={t("pm.form.category")}>
              <OptionSelect
                value={draft.categoryId}
                onChange={(v) => set("categoryId", v)}
                label={t("pm.form.category")}
                options={(lookups?.categories ?? []).map((c) => ({ value: c.id, label: nameOf(c, locale) }))}
              />
            </Field>
            <Field label={t("pm.form.kind")}>
              <OptionSelect
                value={draft.kind}
                onChange={(v) => set("kind", v)}
                label={t("pm.form.kind")}
                options={(["chemical", "consumable", "retail"] as const).map((k) => ({ value: k, label: t(`pm.kind.${k}`) }))}
              />
            </Field>
            <Field label={t("pm.form.brand")}>
              <Input value={draft.brand} onChange={(e) => set("brand", e.target.value)} />
            </Field>
            <Field label={t("pm.form.barcode")}>
              <Input value={draft.barcode} onChange={(e) => set("barcode", e.target.value.replace(/\D/g, ""))} className="font-mono" inputMode="numeric" />
            </Field>
          </div>

          <div className="grid gap-4 rounded-md bg-surface-raised/50 p-4 sm:grid-cols-3">
            <Field label={t("pm.form.baseUom")}>
              <OptionSelect value={draft.baseUom} onChange={(v) => set("baseUom", v)} label={t("pm.form.baseUom")} options={uomOptions} />
            </Field>
            <Field label={t("pm.form.purchaseUom")}>
              <OptionSelect value={draft.purchaseUom} onChange={(v) => set("purchaseUom", v)} label={t("pm.form.purchaseUom")} options={uomOptions} />
            </Field>
            <Field
              label={t("pm.form.purchaseFactor")}
              hint={
                draft.purchaseFactor
                  ? t("pm.form.conversionPreview", { unit: draft.purchaseUom, qty: num(draft.purchaseFactor), base: draft.baseUom })
                  : undefined
              }
            >
              <QtyInput value={draft.purchaseFactor} onChange={(v) => set("purchaseFactor", v)} unit={draft.baseUom} data-testid="item-factor" />
            </Field>
            <Field label={t("pm.form.salesUom")}>
              <OptionSelect
                value={draft.salesUom || "none"}
                onChange={(v) => set("salesUom", v === "none" ? "" : v)}
                label={t("pm.form.salesUom")}
                options={[{ value: "none", label: t("pm.form.none") }, ...uomOptions]}
              />
            </Field>
            {draft.salesUom ? (
              <Field label={t("pm.form.salesFactor")}>
                <QtyInput value={draft.salesFactor} onChange={(v) => set("salesFactor", v)} unit={draft.baseUom} />
              </Field>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.trackBatch} onCheckedChange={(v) => set("trackBatch", !!v)} />
              {t("pm.form.trackBatch")}
            </label>
            {draft.trackBatch ? (
              <Field label={t("pm.form.shelfLifeDays")}>
                <QtyInput value={draft.shelfLifeDays} onChange={(v) => set("shelfLifeDays", v === null ? null : Math.round(v))} />
              </Field>
            ) : (
              <span />
            )}
            <Field label={t("pm.form.standardCost")}>
              <MoneyInput valueP={draft.standardCostP} onChange={(v) => set("standardCostP", v)} data-testid="item-cost" />
            </Field>
            <Field label={t("pm.form.retailPrice")}>
              <MoneyInput valueP={draft.retailPriceP} onChange={(v) => set("retailPriceP", v)} />
            </Field>
            <Field label={t("pm.form.vatCategory")}>
              <OptionSelect
                value={draft.vatCategory}
                onChange={(v) => set("vatCategory", v)}
                label={t("pm.form.vatCategory")}
                options={VATS.map((v) => ({ value: v, label: tk(`pm.vat.${v}`) }))}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="neutral" onClick={onDone}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.pending} data-testid="item-save">
              {t("pm.form.save")}
            </Button>
          </DialogFooter>
        </form>
  )
}
