"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { FlaskConical, Pencil, Plus, Save } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { locations } from "@/config/brand.config"
import type { TaxSettings, VatCategory, VendorTaxCategory } from "@/config/rules.config"
import { useDb } from "@/core/db/DbProvider"
import type { AccountRow, AccountTag, CostCentreRow, Id } from "@/core/db/schema"
import { readSetting } from "@/core/db/settings"
import { useCommand } from "@/core/engine/useCommand"
import { CHART } from "@/core/ledger/chart"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { saveSettings } from "../commands"
import { useAccounts, useCostCentres } from "../queries"
import { Field } from "./common"

const TAG_ORDER = CHART.flatMap((c) => (c.tag ? [c.tag] : []))
const VAT_CATEGORIES: VatCategory[] = ["standard", "reduced-10", "reduced-7.5", "reduced-5", "exempt"]
const VENDOR_CATEGORIES: VendorTaxCategory[] = ["goods", "services", "rent", "professional", "utility", "exempt"]
const vatKey = (c: VatCategory) => c.replace(".", "_")

/** The "Demo values" note (ui_guidelines.md §4 banners; accounting_rules.md §4). */
export function DemoValues({ className }: { className?: string }) {
  const { t } = useLocale()
  return (
    <span
      data-testid="demo-values"
      className={cn("inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 text-[0.6875rem] font-medium text-muted-foreground", className)}
    >
      <FlaskConical className="size-3" />
      {t("fa.settings.demoValues")}
    </span>
  )
}

/**
 * FA settings (plan §9 `/fa/settings`): the posting account map per system
 * tag, cost centres, and tax rates by category with the withholding table,
 * labelled demo values. Saving needs fa.settings.configure.
 */
export function SettingsPage() {
  const { t } = useLocale()
  const canConfigure = useCan("fa.settings.configure")
  return (
    <div className="flex flex-col gap-5" data-testid="fa-settings">
      <PageHeader title={t("fa.settings.title")} subtitle={t("fa.settings.subtitle")} />
      {!canConfigure ? <p className="text-xs text-muted-foreground">{t("fa.settings.readOnly")}</p> : null}
      <Tabs defaultValue="posting">
        <TabsList>
          <TabsTrigger value="posting" data-testid="settings-tab-posting">
            {t("fa.settings.tabs.posting")}
          </TabsTrigger>
          <TabsTrigger value="centres" data-testid="settings-tab-centres">
            {t("fa.settings.tabs.costCentres")}
          </TabsTrigger>
          <TabsTrigger value="tax" data-testid="settings-tab-tax">
            {t("fa.settings.tabs.tax")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="posting" className="mt-4">
          <PostingMap canConfigure={canConfigure} />
        </TabsContent>
        <TabsContent value="centres" className="mt-4">
          <CostCentres canConfigure={canConfigure} />
        </TabsContent>
        <TabsContent value="tax" className="mt-4">
          <TaxRates canConfigure={canConfigure} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PostingMap({ canConfigure }: { canConfigure: boolean }) {
  const db = useDb()
  const { t, num, locale } = useLocale()
  const accounts = useAccounts()
  const row = useLiveQuery(() => db.settings.get("postingAccounts"), [db])
  const map = (row?.value ?? {}) as Record<AccountTag, Id>
  const [changes, setChanges] = React.useState<Partial<Record<AccountTag, Id>>>({})
  const command = useCommand(saveSettings)
  const byId = new Map((accounts ?? []).map((a) => [a.id, a]))
  const count = Object.keys(changes).length

  const save = async () => {
    const result = await command.run({ kind: "postingMap", map: changes as Record<string, string>, expectedVersion: row?.version })
    if (result) {
      setChanges({})
      toast.success(t("fa.settings.mapSaved"))
    }
  }

  return (
    <SectionCard
      title={t("fa.settings.tabs.posting")}
      subtitle={t("fa.settings.postingHint")}
      action={
        canConfigure ? (
          <Button size="sm" onClick={save} disabled={!count || command.pending} data-testid="settings-save-map">
            <Save />
            {t("fa.settings.saveMap")}
            {count ? ` (${num(count)})` : ""}
          </Button>
        ) : null
      }
    >
      <div className="@container overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[0.8125rem]" data-testid="posting-map">
          <thead>
            <tr>
              <th className="h-9 rounded-l-md bg-surface-raised px-3 text-left font-medium">{t("fa.settings.tag")}</th>
              <th className="h-9 rounded-r-md bg-surface-raised px-3 text-left font-medium">{t("fa.settings.mappedTo")}</th>
            </tr>
          </thead>
          <tbody>
            {TAG_ORDER.map((tag) => {
              const currentId = changes[tag] ?? map[tag]
              const current = byId.get(currentId)
              const base = byId.get(map[tag])
              const options = (accounts ?? []).filter(
                (a: AccountRow) => a.active && !a.isGroup && base && a.type === base.type && a.isControl === base.isControl
              )
              return (
                <tr key={tag} className={cn(changes[tag] && "bg-primary-soft")}>
                  <td className="h-10 border-b border-hairline px-3">
                    <span lang="en" className="font-mono text-xs">
                      {tag}
                    </span>
                  </td>
                  <td className="h-10 border-b border-hairline px-3 py-1">
                    {canConfigure ? (
                      <Select
                        value={currentId ?? ""}
                        onValueChange={(v) => {
                          if (!v) return
                          setChanges((prev) => {
                            const next = { ...prev }
                            if (v === map[tag]) delete next[tag]
                            else next[tag] = v as string
                            return next
                          })
                        }}
                      >
                        <SelectTrigger className="h-8 w-full max-w-md" data-testid={`map-${tag}`}>
                          <SelectValue>
                            {() =>
                              current ? (
                                <>
                                  <span lang="en" className="font-mono text-muted-foreground">
                                    {current.code}
                                  </span>{" "}
                                  {nameOf(current, locale)}
                                </>
                              ) : (
                                "-"
                              )
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              <span lang="en" className="font-mono text-muted-foreground">
                                {a.code}
                              </span>{" "}
                              {nameOf(a, locale)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : current ? (
                      <span>
                        <span lang="en" className="font-mono text-muted-foreground">
                          {current.code}
                        </span>{" "}
                        {nameOf(current, locale)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function CostCentres({ canConfigure }: { canConfigure: boolean }) {
  const { t, locale } = useLocale()
  const centres = useCostCentres()
  const [editing, setEditing] = React.useState<CostCentreRow | "new" | null>(null)
  return (
    <SectionCard
      title={t("fa.settings.tabs.costCentres")}
      action={
        canConfigure ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")} data-testid="cost-centre-new">
            <Plus />
            {t("fa.settings.newCostCentre")}
          </Button>
        ) : null
      }
    >
      <ul className="flex flex-col" data-testid="cost-centres">
        {(centres ?? []).map((c) => {
          const loc = locations.find((l) => l.id === c.locationId)
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline py-2.5 last:border-b-0">
              <span lang="en" className="w-24 font-mono text-sm">
                {c.code}
              </span>
              <span className="min-w-0 flex-1">{nameOf(c, locale)}</span>
              <span className="text-xs text-muted-foreground">{loc ? loc.name[locale] : "-"}</span>
              {canConfigure ? (
                <Button variant="ghost" size="icon-xs" aria-label={t("fa.common.edit")} onClick={() => setEditing(c)}>
                  <Pencil />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
      <CostCentreDialog centre={editing === "new" ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </SectionCard>
  )
}

function CostCentreDialog({ centre, open, onClose }: { centre: CostCentreRow | null; open: boolean; onClose: () => void }) {
  const { t, locale } = useLocale()
  const command = useCommand(saveSettings)
  const [code, setCode] = React.useState("")
  const [nameEn, setNameEn] = React.useState("")
  const [nameBn, setNameBn] = React.useState("")
  const [locationId, setLocationId] = React.useState("")
  const [seen, setSeen] = React.useState<string | null>(null)
  const key = open ? (centre?.id ?? "new") : null
  if (key !== seen) {
    setSeen(key)
    setCode(centre?.code ?? "CC-")
    setNameEn(centre?.nameEn ?? "")
    setNameBn(centre?.nameBn ?? "")
    setLocationId(centre?.locationId ?? "")
  }
  const loc = locations.find((l) => l.id === locationId)
  const run = async () => {
    const result = await command.run({
      kind: "costCentre",
      costCentreId: centre?.id,
      expectedVersion: centre?.version,
      code: code.trim().toUpperCase(),
      nameEn: nameEn.trim(),
      nameBn: nameBn.trim(),
      locationId: locationId || undefined,
    })
    if (result) {
      toast.success(t("fa.settings.costCentreSaved", { code: code.trim().toUpperCase() }))
      onClose()
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="cost-centre-dialog">
        <DialogHeader>
          <DialogTitle>{centre ? centre.code : t("fa.settings.newCostCentre")}</DialogTitle>
          <DialogDescription>{t("fa.settings.tabs.costCentres")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("fa.settings.code")}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" data-testid="cost-centre-code" />
          </Field>
          <Field label={t("fa.settings.location")}>
            <Select value={locationId || "none"} onValueChange={(v) => setLocationId(!v || v === "none" ? "" : (v as string))}>
              <SelectTrigger className="w-full">
                <SelectValue>{() => (loc ? loc.name[locale] : "-")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("fa.accounts.nameEn")}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
          <Field label={t("fa.accounts.nameBn")}>
            <Input value={nameBn} onChange={(e) => setNameBn(e.target.value)} lang="bn" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("fa.common.cancel")}
          </Button>
          <Button onClick={run} disabled={command.pending || !/^CC-[A-Z0-9]{2,6}$/i.test(code.trim()) || nameEn.trim().length < 2 || nameBn.trim().length < 2}>
            {t("fa.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PercentInput({
  value,
  onChange,
  disabled,
  testId,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  testId?: string
}) {
  const { t } = useLocale()
  const [text, setText] = React.useState<string | null>(null)
  return (
    <div className="relative w-28">
      <Input
        inputMode="decimal"
        value={text ?? String(value)}
        disabled={disabled}
        onFocus={() => setText(String(value))}
        onBlur={() => setText(null)}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))))
          if (Number.isFinite(n) && n >= 0 && n <= 100) onChange(n)
        }}
        className="pr-8 text-right font-mono"
        data-testid={testId}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{t("fa.settings.percent")}</span>
    </div>
  )
}

function TaxRates({ canConfigure }: { canConfigure: boolean }) {
  const db = useDb()
  const { t, tk } = useLocale()
  const row = useLiveQuery(async () => ({ row: await db.settings.get("tax"), value: await readSetting(db, "tax") }), [db])
  const [draft, setDraft] = React.useState<TaxSettings | null>(null)
  const command = useCommand(saveSettings)
  const tax = draft ?? row?.value
  if (!tax) return null
  const set = (next: TaxSettings) => setDraft(next)
  const save = async () => {
    if (!draft) return
    const result = await command.run({ kind: "tax", tax: draft, expectedVersion: row?.row?.version })
    if (result) {
      setDraft(null)
      toast.success(t("fa.settings.taxSaved"))
    }
  }
  return (
    <div className="flex flex-col gap-5" data-testid="tax-settings">
      <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised/60 px-4 py-3 text-xs text-muted-foreground">
        <DemoValues />
        <span className="min-w-0 flex-1">{t("fa.settings.demoNote")}</span>
        {canConfigure ? (
          <Button size="sm" onClick={save} disabled={!draft || command.pending} data-testid="settings-save-tax">
            <Save />
            {t("fa.settings.saveTax")}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-5 min-[1100px]:grid-cols-2">
        <SectionCard title={t("fa.settings.vatRates")} action={<DemoValues />} size="sm">
          <ul className="flex flex-col">
            {VAT_CATEGORIES.map((c) => (
              <li key={c} className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
                <span>{tk(`fa.settings.vatCategories.${vatKey(c)}`)}</span>
                <PercentInput
                  value={tax.vatRates[c]}
                  disabled={!canConfigure}
                  testId={`vat-rate-${vatKey(c)}`}
                  onChange={(v) => set({ ...tax, vatRates: { ...tax.vatRates, [c]: v } })}
                />
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title={t("fa.settings.withholding")} action={<DemoValues />} size="sm">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-medium">{t("fa.settings.vendorCategory")}</th>
                <th className="py-1 text-right font-medium">{t("fa.settings.aitPct")}</th>
                <th className="py-1 text-right font-medium">{t("fa.settings.vds")}</th>
              </tr>
            </thead>
            <tbody>
              {VENDOR_CATEGORIES.map((c) => (
                <tr key={c} className="border-b border-hairline last:border-b-0">
                  <td className="py-2">{tk(`fa.settings.vendorCategories.${c}`)}</td>
                  <td className="py-2">
                    <div className="flex justify-end">
                      <PercentInput
                        value={tax.withholding[c].aitPct}
                        disabled={!canConfigure}
                        onChange={(v) => set({ ...tax, withholding: { ...tax.withholding, [c]: { ...tax.withholding[c], aitPct: v } } })}
                      />
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <Switch
                      checked={tax.withholding[c].vds}
                      disabled={!canConfigure}
                      onCheckedChange={(v) => set({ ...tax, withholding: { ...tax.withholding, [c]: { ...tax.withholding[c], vds: v } } })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard title={t("fa.settings.customerDeductions")} action={<DemoValues />} size="sm">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span>{t("fa.settings.customerVds")}</span>
              <PercentInput
                value={tax.customerDeductions.vdsPctOfVat}
                disabled={!canConfigure}
                onChange={(v) => set({ ...tax, customerDeductions: { ...tax.customerDeductions, vdsPctOfVat: v } })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{t("fa.settings.customerAit")}</span>
              <PercentInput
                value={tax.customerDeductions.aitPct}
                disabled={!canConfigure}
                onChange={(v) => set({ ...tax, customerDeductions: { ...tax.customerDeductions, aitPct: v } })}
              />
            </div>
          </div>
        </SectionCard>
        <SectionCard title={t("fa.settings.thresholds")} size="sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{tax.thresholdsEnabled ? t("fa.settings.thresholdsOn") : t("fa.settings.thresholdsOff")}</span>
            <Switch checked={tax.thresholdsEnabled} disabled={!canConfigure} onCheckedChange={(v) => set({ ...tax, thresholdsEnabled: v })} />
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
