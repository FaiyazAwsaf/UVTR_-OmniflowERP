"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import type { ItemCategoryRow, UomRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field, HIDE, LinesTable, OptionSelect } from "@/modules/ic/components/scm-ui"

import { saveCategory, saveUom } from "../commands"

/** /pm/categories: item categories with their inventory and cost accounts. */
export function CategoriesScreen() {
  const db = useDb()
  const { t, tk, locale, num } = useLocale()
  const canEdit = useCan("pm.item.edit")
  const [editing, setEditing] = React.useState<ItemCategoryRow | "new" | null>(null)
  const data = useLiveQuery(async () => {
    const [categories, items] = await Promise.all([db.itemCategories.toArray(), db.items.toArray()])
    const counts = new Map<string, number>()
    for (const i of items) counts.set(i.categoryId, (counts.get(i.categoryId) ?? 0) + 1)
    return { categories: categories.sort((a, b) => a.code.localeCompare(b.code)), counts }
  }, [db])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("pm.categories.title")}
        subtitle={t("pm.categories.subtitle")}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing("new")} data-testid="category-new">
              <Plus />
              {t("pm.categories.new")}
            </Button>
          ) : null
        }
      />
      <SectionCard title={t("pm.categories.title")}>
        <LinesTable
          head={[
            { label: t("pm.categories.code") },
            { label: t("pm.categories.name") },
            { label: t("pm.categories.inventoryTag"), hide: "md" },
            { label: t("pm.categories.costTag"), hide: "lg" },
            { label: t("pm.categories.items"), align: "right" },
            { label: "" },
          ]}
        >
          {(data?.categories ?? []).map((c) => (
            <tr key={c.id} data-testid="category-row">
              <td lang="en" className="font-mono">
                {c.code}
              </td>
              <td>{nameOf(c, locale)}</td>
              <td className={HIDE.md}>{tk(`pm.tag.${c.inventoryTag}`)}</td>
              <td className={HIDE.lg}>{tk(`pm.tag.${c.costTag}`)}</td>
              <td className="text-right nums">{num(data?.counts.get(c.id) ?? 0)}</td>
              <td className="text-right">
                {canEdit ? (
                  <Button variant="link" size="sm" onClick={() => setEditing(c)}>
                    {t("pm.categories.edit")}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </LinesTable>
      </SectionCard>
      <CategoryDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function CategoryDialog({ target, onClose }: { target: ItemCategoryRow | "new" | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{target ? <CategoryForm current={target === "new" ? undefined : target} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  )
}

function CategoryForm({ current, onClose }: { current?: ItemCategoryRow; onClose: () => void }) {
  const { t, tk } = useLocale()
  const save = useCommand(saveCategory)
  const [code, setCode] = React.useState(current?.code ?? "")
  const [nameEn, setNameEn] = React.useState(current?.nameEn ?? "")
  const [nameBn, setNameBn] = React.useState(current?.nameBn ?? "")
  const [inventoryTag, setInventoryTag] = React.useState<ItemCategoryRow["inventoryTag"]>(current?.inventoryTag ?? "INV_CHEMICAL")
  const [costTag, setCostTag] = React.useState<ItemCategoryRow["costTag"]>(current?.costTag ?? "CONSUMABLES_USED")
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await save.run({ id: current?.id, expectedVersion: current?.version, code, nameEn, nameBn, inventoryTag, costTag })
        if (out) {
          toast.success(t("pm.categories.saved"))
          onClose()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{current ? t("pm.categories.editTitle", { code: current.code }) : t("pm.categories.newTitle")}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("pm.categories.code")}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" required />
        </Field>
        <span />
        <Field label={t("pm.categories.nameEn")}>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
        </Field>
        <Field label={t("pm.categories.nameBn")}>
          <Input value={nameBn} onChange={(e) => setNameBn(e.target.value)} lang="bn" />
        </Field>
        <Field label={t("pm.categories.inventoryTag")}>
          <OptionSelect
            value={inventoryTag}
            onChange={setInventoryTag}
            label={t("pm.categories.inventoryTag")}
            options={(["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL"] as const).map((v) => ({ value: v, label: tk(`pm.tag.${v}`) }))}
          />
        </Field>
        <Field label={t("pm.categories.costTag")}>
          <OptionSelect
            value={costTag}
            onChange={setCostTag}
            label={t("pm.categories.costTag")}
            options={(["CONSUMABLES_USED", "COGS"] as const).map((v) => ({ value: v, label: tk(`pm.tag.${v}`) }))}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={save.pending}>
          {t("pm.categories.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** /pm/uom: units of measure (base units carry stock; purchase and sales units convert). */
export function UomScreen() {
  const db = useDb()
  const { t, locale, num } = useLocale()
  const canEdit = useCan("pm.item.edit")
  const [editing, setEditing] = React.useState<UomRow | "new" | null>(null)
  const data = useLiveQuery(async () => {
    const [uoms, items] = await Promise.all([db.uoms.toArray(), db.items.toArray()])
    const counts = new Map<string, number>()
    for (const i of items) for (const u of new Set([i.baseUom, i.purchaseUom, i.salesUom].filter(Boolean) as string[])) counts.set(u, (counts.get(u) ?? 0) + 1)
    const order = { volume: 0, mass: 1, count: 2 }
    return { uoms: uoms.sort((a, b) => order[a.dimension] - order[b.dimension] || a.code.localeCompare(b.code)), counts }
  }, [db])
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("pm.uom.title")}
        subtitle={t("pm.uom.subtitle")}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing("new")} data-testid="uom-new">
              <Plus />
              {t("pm.uom.new")}
            </Button>
          ) : null
        }
      />
      <SectionCard title={t("pm.uom.title")}>
        <LinesTable
          head={[
            { label: t("pm.uom.code") },
            { label: t("pm.uom.name") },
            { label: t("pm.uom.dimension"), hide: "sm" },
            { label: t("pm.uom.usedBy"), align: "right" },
            { label: "" },
          ]}
        >
          {(data?.uoms ?? []).map((u) => (
            <tr key={u.id} data-testid="uom-row">
              <td lang="en" className="font-mono">
                {u.code}
              </td>
              <td>{nameOf(u, locale)}</td>
              <td className={cn(HIDE.sm)}>{t(`pm.dimension.${u.dimension}`)}</td>
              <td className="text-right">{t("pm.uom.itemsCount", { count: num(data?.counts.get(u.id) ?? 0) })}</td>
              <td className="text-right">
                {canEdit ? (
                  <Button variant="link" size="sm" onClick={() => setEditing(u)}>
                    {t("pm.uom.edit")}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </LinesTable>
      </SectionCard>
      <UomDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function UomDialog({ target, onClose }: { target: UomRow | "new" | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{target ? <UomForm current={target === "new" ? undefined : target} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  )
}

function UomForm({ current, onClose }: { current?: UomRow; onClose: () => void }) {
  const { t } = useLocale()
  const save = useCommand(saveUom)
  const [code, setCode] = React.useState(current?.code ?? "")
  const [nameEn, setNameEn] = React.useState(current?.nameEn ?? "")
  const [nameBn, setNameBn] = React.useState(current?.nameBn ?? "")
  const [dimension, setDimension] = React.useState<UomRow["dimension"]>(current?.dimension ?? "count")
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await save.run({ code, nameEn, nameBn, dimension, expectedVersion: current?.version })
        if (out) {
          toast.success(t("pm.uom.saved"))
          onClose()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{current ? t("pm.uom.editTitle", { code: current.code }) : t("pm.uom.newTitle")}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("pm.uom.code")}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} className="font-mono" disabled={!!current} required />
        </Field>
        <Field label={t("pm.uom.dimension")}>
          <OptionSelect
            value={dimension}
            onChange={setDimension}
            label={t("pm.uom.dimension")}
            options={(["volume", "mass", "count"] as const).map((d) => ({ value: d, label: t(`pm.dimension.${d}`) }))}
          />
        </Field>
        <Field label={t("pm.uom.nameEn")}>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
        </Field>
        <Field label={t("pm.uom.nameBn")}>
          <Input value={nameBn} onChange={(e) => setNameBn(e.target.value)} lang="bn" />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={save.pending}>
          {t("pm.uom.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
