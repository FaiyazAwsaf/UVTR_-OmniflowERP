"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangle, Lock, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { MoneyInput } from "@/components/shared/money-input"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useDb } from "@/core/db/DbProvider"
import type { PartyContact, PartyRow, PartySegment, VendorTaxCategory } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { findLikelyDuplicates } from "@/core/search/fuzzy"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { createParty, updateParty, type PartyFieldsInput } from "../commands"
import { CUSTOMER_SEGMENTS, VENDOR_SEGMENTS } from "../lib"
import { Banner, Field, NativeSelect, Pills, TextInput } from "./kit"

type FormState = {
  isCustomer: boolean
  isVendor: boolean
  type: "individual" | "company"
  nameEn: string
  nameBn: string
  segment: PartySegment
  phone: string
  email: string
  line: string
  area: string
  city: string
  contacts: PartyContact[]
  bin: string
  tin: string
  nid: string
  tradeLicense: string
  creditLimitP: number | null
  paymentTermsDays: string
  priceListId: string
  vendorTaxCategory: VendorTaxCategory
  deductsVds: boolean
  deductsAit: boolean
  smsConsent: boolean
  notes: string
}

function fromParty(p?: PartyRow, asVendor = false): FormState {
  const address = p?.addresses[0]
  return {
    isCustomer: p ? p.isCustomer : !asVendor,
    isVendor: p ? p.isVendor : asVendor,
    type: p?.type ?? (asVendor ? "company" : "individual"),
    nameEn: p?.nameEn ?? "",
    nameBn: p && p.nameBn !== p.nameEn ? p.nameBn : "",
    segment: p?.segment ?? (asVendor ? "supplier" : "retail"),
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    line: address?.line ?? "",
    area: address?.area ?? "",
    city: address?.city ?? "Dhaka",
    contacts: p?.contacts ?? [],
    bin: p?.bin ?? "",
    tin: p?.tin ?? "",
    nid: p?.nid ?? "",
    tradeLicense: p?.tradeLicense ?? "",
    creditLimitP: p?.creditLimitP ?? 0,
    paymentTermsDays: String(p?.paymentTermsDays ?? 0),
    priceListId: p?.priceListId ?? "",
    vendorTaxCategory: p?.vendorTaxCategory ?? "goods",
    deductsVds: p?.deductsVds ?? false,
    deductsAit: p?.deductsAit ?? false,
    smsConsent: p?.smsConsent ?? true,
    notes: p?.notes ?? "",
  }
}

function toInput(f: FormState): PartyFieldsInput {
  return {
    isCustomer: f.isCustomer,
    isVendor: f.isVendor,
    type: f.type,
    nameEn: f.nameEn,
    nameBn: f.nameBn,
    segment: f.segment,
    phone: f.phone,
    email: f.email,
    addresses: f.line || f.area ? [{ label: "Main", line: f.line, area: f.area, city: f.city }] : [],
    contacts: f.contacts.filter((c) => c.name.trim()),
    bin: f.bin,
    tin: f.tin,
    nid: f.nid,
    tradeLicense: f.tradeLicense,
    creditLimitP: f.creditLimitP ?? 0,
    paymentTermsDays: Math.max(0, Math.round(Number(f.paymentTermsDays) || 0)),
    priceListId: f.isCustomer ? f.priceListId || undefined : undefined,
    vendorTaxCategory: f.isVendor ? f.vendorTaxCategory : undefined,
    deductsVds: f.deductsVds,
    deductsAit: f.deductsAit,
    smsConsent: f.smsConsent,
    notes: f.notes,
  }
}

const TAX_CATEGORIES: VendorTaxCategory[] = ["goods", "services", "rent", "professional", "utility", "exempt"]

/**
 * The party form (plan §9 /par/new, and edit on the party 360): customer or
 * vendor or both, contacts and address, tax IDs, credit and terms (only with
 * `par.credit.edit`), vendor tax category. Shows likely duplicates by name
 * and phone as you type; the same BIN or NID is refused.
 */
export function PartyForm({ party, onDone }: { party?: PartyRow; onDone?: () => void }) {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale } = useLocale()
  const canCredit = useCan("par.credit.edit")
  const canCustomer = useCan(party ? "par.customer.edit" : "par.customer.create")
  const canVendor = useCan(party ? "par.vendor.edit" : "par.vendor.create")
  const [f, setF] = React.useState<FormState>(() => fromParty(party, !party && !canCustomer && canVendor))
  // The version the form was opened at: a save against a newer one shows the conflict dialog (E15).
  const [openedVersion] = React.useState(party?.version)
  const create = useCommand(createParty)
  const update = useCommand(updateParty)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((prev) => ({ ...prev, [key]: value }))

  const data = useLiveQuery(async () => {
    const [parties, priceLists] = await Promise.all([db.parties.toArray(), db.priceLists.where("status").equals("published").toArray()])
    return { parties, priceLists }
  }, [db])

  const duplicates = React.useMemo(() => {
    if (!data || (f.nameEn.trim().length < 3 && f.phone.replace(/\D/g, "").length < 6)) return []
    return findLikelyDuplicates({ nameEn: f.nameEn, phone: f.phone }, data.parties, { excludeId: party?.id }).map((c) => ({
      ...c,
      party: data.parties.find((p) => p.id === c.partyId)!,
    }))
  }, [data, f.nameEn, f.phone, party?.id])
  const sameBin = f.bin.trim() ? data?.parties.find((p) => p.bin === f.bin.trim() && p.id !== party?.id) : undefined
  const sameNid = f.nid.trim() ? data?.parties.find((p) => p.nid === f.nid.trim() && p.id !== party?.id) : undefined

  const segments = [...(f.isCustomer ? CUSTOMER_SEGMENTS : []), ...(f.isVendor ? VENDOR_SEGMENTS : [])]
  const valid = (f.isCustomer || f.isVendor) && f.nameEn.trim().length >= 2 && f.phone.trim().length >= 5 && !sameBin && !sameNid
  const pending = create.pending || update.pending

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid) return
    const input = toInput(f)
    if (!segments.includes(input.segment)) input.segment = segments[0]
    if (party) {
      const result = await update.run({ partyId: party.id, expectedVersion: openedVersion ?? party.version, fields: input })
      if (result) {
        toast.success(t("par.form.saved"))
        onDone?.()
      }
    } else {
      const result = await create.run(input)
      if (result) {
        toast.success(t("par.form.created", { code: result.code }))
        router.push(`/par/${result.partyId}`)
      }
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="party-form">
      {duplicates.length ? (
        <Banner tone="warning" icon={<AlertTriangle />} testId="party-duplicate-warning">
          <p className="font-medium">{t("par.form.duplicateTitle")}</p>
          <p className="text-muted-foreground">{t("par.form.duplicateBody")}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {duplicates.map((d) => (
              <li key={d.partyId} className="flex flex-wrap items-center gap-x-2">
                <Link href={`/par/${d.partyId}`} className="font-medium text-link hover:underline">
                  {nameOf(d.party, locale)}
                </Link>
                <span lang="en" className="font-mono text-xs text-muted-foreground">
                  {d.party.code} · {d.party.phone}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({d.reasons.map((r) => tk(`par.form.reason.${r}`)).join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <div className="grid gap-4 @container/form lg:grid-cols-2">
        <SectionCard title={t("par.form.identity")} size="sm">
          <div className="grid gap-3 @min-[28rem]/form:grid-cols-2">
            <Field group label={t("par.form.kind")} error={!f.isCustomer && !f.isVendor ? t("par.form.kindRequired") : undefined}>
              <div className="flex flex-wrap gap-3 pt-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.isCustomer} disabled={!canCustomer} onCheckedChange={(v) => set("isCustomer", !!v)} data-testid="party-is-customer" />
                  {t("par.form.customer")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.isVendor} disabled={!canVendor} onCheckedChange={(v) => set("isVendor", !!v)} data-testid="party-is-vendor" />
                  {t("par.form.vendor")}
                </label>
              </div>
            </Field>
            <Field group label={t("par.form.type")}>
              <Pills
                value={f.type}
                onChange={(v) => set("type", v as FormState["type"])}
                options={[
                  { value: "individual", label: t("par.type.individual") },
                  { value: "company", label: t("par.type.company") },
                ]}
              />
            </Field>
            <Field label={t("par.form.nameEn")} className="@min-[28rem]/form:col-span-2">
              <TextInput value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} testId="party-name" autoComplete="off" required />
            </Field>
            <Field label={t("par.form.nameBn")} hint={t("par.form.nameBnHint")} className="@min-[28rem]/form:col-span-2">
              <TextInput value={f.nameBn} onChange={(e) => set("nameBn", e.target.value)} lang="bn" autoComplete="off" />
            </Field>
            <Field label={t("par.form.segment")}>
              <NativeSelect
                value={segments.includes(f.segment) ? f.segment : (segments[0] ?? "")}
                onChange={(v) => set("segment", v as PartySegment)}
                testId="party-segment"
                options={segments.map((s) => ({ value: s, label: tk(`reports.enum.segment.${s}`) }))}
              />
            </Field>
            <Field label={t("par.form.phone")}>
              <TextInput value={f.phone} onChange={(e) => set("phone", e.target.value)} testId="party-phone" inputMode="tel" lang="en" className="font-mono" required />
            </Field>
            <Field label={t("par.form.email")} className="@min-[28rem]/form:col-span-2">
              <TextInput value={f.email} onChange={(e) => set("email", e.target.value)} type="email" lang="en" />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title={t("par.form.taxIds")} size="sm">
          <div className="grid gap-3 @min-[28rem]/form:grid-cols-2">
            <Field label={t("par.form.bin")} error={sameBin ? t("par.form.sameBinError", { party: nameOf(sameBin, locale) }) : undefined}>
              <TextInput value={f.bin} onChange={(e) => set("bin", e.target.value)} testId="party-bin" lang="en" className="font-mono" />
            </Field>
            <Field label={t("par.form.tin")}>
              <TextInput value={f.tin} onChange={(e) => set("tin", e.target.value)} lang="en" className="font-mono" />
            </Field>
            <Field label={t("par.form.nid")} error={sameNid ? t("par.form.sameNidError", { party: nameOf(sameNid, locale) }) : undefined}>
              <TextInput value={f.nid} onChange={(e) => set("nid", e.target.value)} testId="party-nid" lang="en" className="font-mono" />
            </Field>
            <Field label={t("par.form.tradeLicense")}>
              <TextInput value={f.tradeLicense} onChange={(e) => set("tradeLicense", e.target.value)} lang="en" className="font-mono" />
            </Field>
          </div>
          {f.isVendor ? (
            <div className="mt-3 grid gap-3 @min-[28rem]/form:grid-cols-2">
              <Field label={t("par.form.vendorTax")} hint={t("par.form.vendorTaxHint")}>
                <NativeSelect
                  value={f.vendorTaxCategory}
                  onChange={(v) => set("vendorTaxCategory", v as VendorTaxCategory)}
                  testId="party-tax-category"
                  options={TAX_CATEGORIES.map((c) => ({ value: c, label: tk(`par.taxCategory.${c}`) }))}
                />
              </Field>
              {!f.isCustomer ? (
                <Field label={t("par.form.vendorTerms")}>
                  <TextInput value={f.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="font-mono" />
                </Field>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title={t("par.form.address")} size="sm">
          <div className="grid gap-3 @min-[28rem]/form:grid-cols-2">
            <Field label={t("par.form.addressLine")} className="@min-[28rem]/form:col-span-2">
              <TextInput value={f.line} onChange={(e) => set("line", e.target.value)} />
            </Field>
            <Field label={t("par.form.area")}>
              <TextInput value={f.area} onChange={(e) => set("area", e.target.value)} />
            </Field>
            <Field label={t("par.form.city")}>
              <TextInput value={f.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("par.form.contacts")}</span>
            {f.contacts.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 @min-[34rem]/form:grid-cols-[1.2fr_1fr_1fr_auto]">
                <TextInput
                  placeholder={t("par.form.contactName")}
                  value={c.name}
                  onChange={(e) => set("contacts", f.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  testId="contact-name"
                />
                <TextInput
                  placeholder={t("par.form.designation")}
                  value={c.designation}
                  className="hidden @min-[34rem]/form:block"
                  onChange={(e) => set("contacts", f.contacts.map((x, j) => (j === i ? { ...x, designation: e.target.value } : x)))}
                />
                <TextInput
                  placeholder={t("par.form.contactPhone")}
                  value={c.phone}
                  lang="en"
                  className="col-span-1 font-mono @max-[34rem]/form:order-3"
                  onChange={(e) => set("contacts", f.contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                  testId="contact-phone"
                />
                <Button type="button" variant="ghost" size="icon" aria-label={t("common.remove")} onClick={() => set("contacts", f.contacts.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" variant="link" size="sm" className="self-start" onClick={() => set("contacts", [...f.contacts, { name: "", designation: "", phone: "" }])}>
              <Plus />
              {t("par.form.addContact")}
            </Button>
          </div>
        </SectionCard>

        <SectionCard title={t("par.form.credit")} size="sm" action={!canCredit ? <Lock className="size-4 text-muted-foreground" /> : undefined}>
          {!canCredit ? <p className="mb-3 text-xs text-muted-foreground">{t("par.form.creditLocked")}</p> : null}
          <div className="grid gap-3 @min-[28rem]/form:grid-cols-2">
            {f.isCustomer ? (
              <>
                <Field label={t("par.form.creditLimit")}>
                  <MoneyInput valueP={f.creditLimitP} onChange={(v) => set("creditLimitP", v)} disabled={!canCredit} data-testid="party-credit-limit" />
                </Field>
                <Field label={t("par.form.terms")}>
                  <TextInput
                    value={f.paymentTermsDays}
                    disabled={!canCredit}
                    onChange={(e) => set("paymentTermsDays", e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    className="font-mono"
                  />
                </Field>
                <Field label={t("par.form.priceList")}>
                  <NativeSelect
                    value={f.priceListId}
                    disabled={!canCredit}
                    onChange={(v) => set("priceListId", v)}
                    placeholder={t("par.form.priceListDefault")}
                    options={(data?.priceLists ?? []).map((pl) => ({ value: pl.id, label: nameOf(pl, locale) }))}
                  />
                </Field>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={f.deductsVds} disabled={!canCredit} onCheckedChange={(v) => set("deductsVds", !!v)} />
                    {t("par.form.deductsVds")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={f.deductsAit} disabled={!canCredit} onCheckedChange={(v) => set("deductsAit", !!v)} />
                    {t("par.form.deductsAit")}
                  </label>
                </div>
              </>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.smsConsent} onCheckedChange={(v) => set("smsConsent", !!v)} />
              {t("par.form.smsConsent")}
            </label>
            <Field label={t("par.form.notes")} className="@min-[28rem]/form:col-span-2">
              <TextInput value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
        </SectionCard>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="neutral" onClick={() => (onDone ? onDone() : router.push("/par"))}>
          {t("par.form.cancel")}
        </Button>
        <Button type="submit" disabled={!valid || pending} data-testid="party-save">
          {party ? t("par.form.save") : duplicates.length ? t("par.form.createAnyway") : t("par.form.create")}
        </Button>
      </div>
    </form>
  )
}
