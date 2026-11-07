"use client"

import * as React from "react"
import { Layers, Pencil } from "lucide-react"
import { toast } from "sonner"

import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { VEHICLE_CLASSES, type PackageRow, type VehicleClass } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field } from "@/modules/stl/components/kit"

import { savePackage } from "../commands"
import { effectiveList, packagePrice, type Catalogue } from "../pricing"
import { useCatalogue } from "../queries"

/**
 * /pc/packages: packages with their components and the price per class on
 * the retail and dealer lists (bundle percent off, or fixed); on a quote a
 * package explodes into one line per component, priced pro rata.
 */
export function PackagesPage() {
  const { t, tk, locale, num } = useLocale()
  const catalogue = useCatalogue()
  const canEdit = useCan("pc.catalog.edit")
  const [editing, setEditing] = React.useState<PackageRow | null>(null)
  const today = dhakaDate(now())
  if (!catalogue) return null
  const lists = (["RETAIL", "DEALER"] as const).map((code) => ({
    code,
    list: effectiveList(catalogue, catalogue.priceLists.find((l) => l.code === code && l.status !== "draft")?.id, today),
  }))
  return (
    <div className="flex flex-col gap-4" data-testid="pc-packages">
      <PageHeader title={t("pc.pages.packages")} subtitle={t("pc.packages.subtitle")} />
      <div className="grid gap-4 xl:grid-cols-2">
        {[...catalogue.packages.values()].map((p) => (
          <SectionCard
            key={p.id}
            title={nameOf(p, locale)}
            subtitle={
              <>
                <span lang="en" className="font-mono">{p.code}</span> ·{" "}
                {p.pricing.kind === "bundle-pct" ? t("pc.packages.bundle", { pct: num(p.pricing.pct) }) : t("pc.packages.fixed")}
              </>
            }
            icon={Layers}
            size="sm"
            action={
              canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => setEditing(p)} data-testid="package-edit">
                  <Pencil data-icon="inline-start" />
                  {t("common.edit")}
                </Button>
              ) : null
            }
          >
            <ul className="mb-3 flex flex-wrap gap-1.5" data-testid="package-components">
              {p.serviceIds.map((id) => (
                <li key={id} className="rounded-full bg-surface-raised px-2.5 py-1 text-xs">
                  {nameOf(catalogue.services.get(id), locale)}
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] border-separate border-spacing-0 text-[0.8125rem]">
                <thead>
                  <tr className="text-left">
                    <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("pc.packages.list")}</th>
                    {VEHICLE_CLASSES.map((c, i) => (
                      <th key={c} className={cn("bg-surface-raised px-2 py-2 text-right font-medium", i === 4 && "rounded-r-md")} title={tk(`reports.enum.vehicleClass.${c}`)}>
                        <span lang="en" className="font-mono">{c}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lists.map(({ code, list }) => (
                    <tr key={code}>
                      <td lang="en" className="border-b border-hairline px-3 py-2 font-mono text-xs">{code}</td>
                      {VEHICLE_CLASSES.map((c) => (
                        <td key={c} className="border-b border-hairline px-2 py-2 text-right font-mono text-xs">
                          <MoneyText poisha={packagePrice(catalogue, list, p.id, c).totalP} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ))}
      </div>
      <SectionCard title={t("pc.catalogue.addOns")} size="sm">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[...catalogue.addOns.values()].map((a) => (
            <li key={a.id} className="flex flex-col gap-1 rounded-md bg-surface-raised/60 px-3 py-2 text-[0.8125rem]">
              <span className="font-medium">{nameOf(a, locale)}</span>
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                {t("stl.quote.minutes", { min: num(a.durationMin) })}
                <MoneyText poisha={a.priceP} className="font-mono text-foreground" />
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>
      {editing ? <PackageDialog pkg={editing} catalogue={catalogue} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function PackageDialog({ pkg, catalogue, onClose }: { pkg: PackageRow; catalogue: Catalogue; onClose: () => void }) {
  const { t, locale } = useLocale()
  const save = useCommand(savePackage)
  const [nameEn, setNameEn] = React.useState(pkg.nameEn)
  const [nameBn, setNameBn] = React.useState(pkg.nameBn)
  const [serviceIds, setServiceIds] = React.useState(pkg.serviceIds)
  const [pct, setPct] = React.useState(pkg.pricing.kind === "bundle-pct" ? pkg.pricing.pct : 10)
  const [prices, setPrices] = React.useState<Partial<Record<VehicleClass, number | null>>>(pkg.pricing.kind === "fixed" ? pkg.pricing.prices : {})
  const fixed = pkg.pricing.kind === "fixed"
  const submit = async () => {
    const out = await save.run({
      packageId: pkg.id,
      expectedVersion: pkg.version,
      code: pkg.code,
      nameEn,
      nameBn,
      serviceIds,
      pricing: fixed
        ? { kind: "fixed", prices: Object.fromEntries(Object.entries(prices).filter(([, v]) => v !== null && v !== undefined)) as Partial<Record<VehicleClass, number>> }
        : { kind: "bundle-pct", pct },
      active: true,
    })
    if (out) {
      toast.success(t("pc.packages.saved", { code: pkg.code }))
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="package-dialog">
        <DialogHeader>
          <DialogTitle>{t("pc.packages.editTitle", { code: pkg.code })}</DialogTitle>
          <DialogDescription>{t("pc.packages.editBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("stl.quick.nameEn")}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
          <Field label={t("stl.quick.nameBn")}>
            <Input value={nameBn} onChange={(e) => setNameBn(e.target.value)} />
          </Field>
        </div>
        <ul className="grid max-h-52 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {[...catalogue.services.values()].map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 rounded-md px-2 py-1 text-[0.8125rem] hover:bg-surface-raised">
                <Checkbox checked={serviceIds.includes(s.id)} onCheckedChange={(v) => setServiceIds((cur) => (v ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} />
                {nameOf(s, locale)}
              </label>
            </li>
          ))}
        </ul>
        {fixed ? (
          <div className="grid grid-cols-5 gap-2">
            {VEHICLE_CLASSES.map((c) => (
              <Field key={c} label={<span lang="en" className="font-mono">{c}</span>}>
                <MoneyInput valueP={prices[c] ?? null} onChange={(v) => setPrices((p) => ({ ...p, [c]: v }))} />
              </Field>
            ))}
          </div>
        ) : (
          <Field label={t("pc.packages.pct")}>
            <Input value={String(pct)} inputMode="decimal" onChange={(e) => setPct(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} className="w-28 text-right font-mono" />
          </Field>
        )}
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={save.pending || serviceIds.length < 2} data-testid="package-save">
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
