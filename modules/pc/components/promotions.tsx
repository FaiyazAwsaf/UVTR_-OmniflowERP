"use client"

import * as React from "react"
import { Pencil, Plus, Tag } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DateText } from "@/components/shared/date-text"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { PromotionRow, ServiceCategory } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field } from "@/modules/stl/components/kit"

import { savePromotion } from "../commands"
import { useCatalogue } from "../queries"
import { CATEGORIES } from "./catalogue"

const statusOf = (p: PromotionRow, today: string) => (!p.active ? "inactive" : p.validTo < today ? "expired" : p.validFrom > today ? "pending" : "active")

/** /pc/promotions: percent or amount off services of some categories, with validity and use count. */
export function PromotionsPage() {
  const { t, tk, locale, num } = useLocale()
  const catalogue = useCatalogue()
  const canEdit = useCan("pc.catalog.edit")
  const [editing, setEditing] = React.useState<PromotionRow | "new" | null>(null)
  const today = dhakaDate(now())
  const promos = [...(catalogue?.promotions.values() ?? [])].sort((a, b) => (a.validTo < b.validTo ? 1 : -1))
  return (
    <div className="flex flex-col gap-4" data-testid="pc-promotions">
      <PageHeader
        title={t("pc.pages.promotions")}
        subtitle={t("pc.promos.subtitle")}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing("new")} data-testid="promotion-new">
              <Plus data-icon="inline-start" />
              {t("pc.promos.new")}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {promos.map((p) => {
          const status = statusOf(p, today)
          return (
            <section key={p.id} className="surface-card flex flex-col gap-3 p-5" data-testid="promotion-card" data-code={p.code}>
              <header className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="icon-well flex size-10 shrink-0 items-center justify-center text-link">
                    <Tag className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div lang="en" className="font-mono text-sm font-semibold">{p.code}</div>
                    <div className="truncate text-[0.8125rem] text-muted-foreground">{nameOf(p, locale)}</div>
                  </div>
                </div>
                <DocStatus status={status} />
              </header>
              <div className="text-2xl font-semibold">{p.kind === "pct" ? `${num(p.value)}%` : <MoneyText poisha={p.value} />}</div>
              <dl className="grid grid-cols-2 gap-2 text-[0.8125rem]">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pc.promos.appliesTo")}</dt>
                  <dd>{p.appliesTo.map((c) => tk(`reports.enum.category.${c}`)).join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pc.lists.validity")}</dt>
                  <dd className="nums">
                    <DateText value={p.validFrom} /> → <DateText value={p.validTo} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pc.promos.minOrder")}</dt>
                  <dd>{p.minOrderP ? <MoneyText poisha={p.minOrderP} /> : "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pc.promos.used")}</dt>
                  <dd className="nums">{num(p.usedCount)}</dd>
                </div>
              </dl>
              {canEdit ? (
                <div>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                    <Pencil data-icon="inline-start" />
                    {t("common.edit")}
                  </Button>
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
      {editing ? <PromotionDialog promo={editing === "new" ? null : editing} today={today} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function PromotionDialog({ promo, today, onClose }: { promo: PromotionRow | null; today: string; onClose: () => void }) {
  const { t, tk } = useLocale()
  const save = useCommand(savePromotion)
  const [form, setForm] = React.useState({
    code: promo?.code ?? "",
    nameEn: promo?.nameEn ?? "",
    nameBn: promo?.nameBn ?? "",
    kind: promo?.kind ?? ("pct" as "pct" | "amount"),
    pct: promo?.kind === "pct" ? promo.value : 10,
    amountP: promo?.kind === "amount" ? promo.value : (null as number | null),
    appliesTo: promo?.appliesTo ?? (["wash"] as ServiceCategory[]),
    validFrom: promo?.validFrom ?? today,
    validTo: promo?.validTo ?? addDaysISO(today, 30),
    minOrderP: promo?.minOrderP ?? (0 as number | null),
    active: promo?.active ?? true,
  })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const value = form.kind === "pct" ? form.pct : (form.amountP ?? 0)
  const valid = form.code.trim().length >= 3 && form.nameEn.trim().length >= 2 && value > 0 && form.appliesTo.length > 0 && !!form.validFrom && !!form.validTo
  const submit = async () => {
    const out = await save.run({
      promotionId: promo?.id,
      expectedVersion: promo?.version,
      code: form.code,
      nameEn: form.nameEn,
      nameBn: form.nameBn || form.nameEn,
      kind: form.kind,
      value,
      appliesTo: form.appliesTo,
      validFrom: form.validFrom,
      validTo: form.validTo,
      minOrderP: form.minOrderP ?? 0,
      active: form.active,
    })
    if (out) {
      toast.success(t("pc.promos.saved", { code: form.code.toUpperCase() }))
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="promotion-dialog">
        <DialogHeader>
          <DialogTitle>{promo ? t("pc.promos.editTitle", { code: promo.code }) : t("pc.promos.new")}</DialogTitle>
          <DialogDescription>{t("pc.promos.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pc.lists.code")}>
            <Input value={form.code} disabled={!!promo} onChange={(e) => set({ code: e.target.value.toUpperCase() })} className="font-mono uppercase" data-testid="promotion-code" />
          </Field>
          <Field label={t("pc.promos.kind")}>
            <div className="flex gap-1">
              {(["pct", "amount"] as const).map((k) => (
                <button key={k} type="button" onClick={() => set({ kind: k })} className={cn("h-10 flex-1 rounded-md text-[0.8125rem]", form.kind === k ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground")}>
                  {t(`pc.promos.kinds.${k}`)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("stl.quick.nameEn")}>
            <Input value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} data-testid="promotion-name" />
          </Field>
          <Field label={t("stl.quick.nameBn")}>
            <Input value={form.nameBn} onChange={(e) => set({ nameBn: e.target.value })} />
          </Field>
          {form.kind === "pct" ? (
            <Field label={t("pc.promos.pct")}>
              <Input value={String(form.pct)} inputMode="decimal" onChange={(e) => set({ pct: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} className="text-right font-mono" data-testid="promotion-value" />
            </Field>
          ) : (
            <Field label={t("pc.promos.amount")}>
              <MoneyInput valueP={form.amountP} onChange={(v) => set({ amountP: v })} />
            </Field>
          )}
          <Field label={t("pc.promos.minOrder")}>
            <MoneyInput valueP={form.minOrderP} onChange={(v) => set({ minOrderP: v })} />
          </Field>
          <Field label={t("common.from")}>
            <DateField value={form.validFrom} onChange={(v) => set({ validFrom: v })} />
          </Field>
          <Field label={t("common.to")}>
            <DateField value={form.validTo} onChange={(v) => set({ validTo: v })} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("pc.promos.appliesTo")}</div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-[0.8125rem]">
                <Checkbox checked={form.appliesTo.includes(c)} onCheckedChange={(v) => set({ appliesTo: v ? [...form.appliesTo, c] : form.appliesTo.filter((x) => x !== c) })} />
                {tk(`reports.enum.category.${c}`)}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
          {t("shared.status.active")}
          <Switch checked={form.active} onCheckedChange={(active) => set({ active })} />
        </label>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || save.pending} data-testid="promotion-save">
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
