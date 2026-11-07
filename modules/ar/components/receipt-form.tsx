"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangle, Smartphone, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PartyPicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { defaultTaxSettings } from "@/config/rules.config"
import { useDb } from "@/core/db/DbProvider"
import { readSetting } from "@/core/db/settings"
import type { CashBankAccountRow, Id, ReceiptMethod } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useActor } from "@/core/session/actor"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { Banner, Field, NativeSelect, Pills, TextInput, useActionKey, useToday } from "@/modules/par/components/kit"

import { recordReceipt } from "../commands"
import { accountFitsMethod } from "../ledger"
import { allocateOldestFirst, deductionsFor, oldestFirst } from "../lib"
import { arOpenItems } from "../queries"

const METHODS: ReceiptMethod[] = ["cash", "card", "bkash", "nagad", "bank-transfer", "cheque"]

/** The default account for a method at a location (tills by studio, BRAC for transfers, DBBL for cheques). */
export function defaultAccount(accounts: CashBankAccountRow[], method: ReceiptMethod, locationId: Id | null | undefined): CashBankAccountRow | undefined {
  const fits = accounts.filter((a) => a.active && accountFitsMethod(a, method))
  if (method === "cash") return fits.find((a) => a.kind === "cash-till" && a.locationId === locationId) ?? fits.find((a) => a.kind === "cash-till") ?? fits[0]
  if (method === "bank-transfer") return fits.find((a) => a.accountTag === "BANK_MAIN") ?? fits[0]
  if (method === "cheque") return fits.find((a) => a.accountTag === "BANK_COLLECTION") ?? fits[0]
  return fits[0]
}

/** /ar/receipts/new: a customer receipt with the allocation grid, deductions and cheque details (plan §9). */
export function ReceiptForm() {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const actor = useActor()
  const today = useToday()
  const { t, tk, locale, money, dmy, num } = useLocale()
  const record = useCommand(recordReceipt)
  const action = useActionKey("mr")

  const [partyId, setPartyId] = React.useState<Id | null>(params.get("party"))
  const [method, setMethod] = React.useState<ReceiptMethod>("bank-transfer")
  const [accountId, setAccountId] = React.useState<string>("")
  const [date, setDate] = React.useState("")
  const [amountP, setAmountP] = React.useState<number | null>(null)
  const [ref, setRef] = React.useState("")
  const [chequeNo, setChequeNo] = React.useState("")
  const [bank, setBank] = React.useState("")
  const [chequeDate, setChequeDate] = React.useState("")
  const [alloc, setAlloc] = React.useState<Record<string, number | null>>({})
  const [manualAlloc, setManualAlloc] = React.useState(false)
  const [vds, setVds] = React.useState<number | null>(null)
  const [ait, setAit] = React.useState<number | null>(null)
  const [manualDed, setManualDed] = React.useState(false)
  const [certificateNo, setCertificateNo] = React.useState("")
  const [mfsOpen, setMfsOpen] = React.useState(false)

  const day = date || today

  const data = useLiveQuery(async () => {
    const [accounts, tax, party, items] = await Promise.all([
      db.cashBankAccounts.toArray(),
      readSetting(db, "tax").catch(() => defaultTaxSettings),
      partyId ? db.parties.get(partyId) : undefined,
      partyId && today ? arOpenItems(db, today, partyId) : Promise.resolve([]),
    ])
    return { accounts, tax, party, items: items.filter((i) => i.availableP > 0 || i.invoice.reservedP > 0).sort((a, b) => oldestFirst(a.invoice, b.invoice)) }
  }, [db, partyId, today])

  const accounts = React.useMemo(() => (data?.accounts ?? []).filter((a) => a.active && accountFitsMethod(a, method)), [data, method])
  const account = accounts.find((a) => a.id === accountId) ?? defaultAccount(data?.accounts ?? [], method, actor?.locationId)
  const party = data?.party
  const items = React.useMemo(() => data?.items ?? [], [data])
  const invoiceMap = React.useMemo(() => new Map(items.map((i) => [i.invoice.id, i.invoice])), [items])

  // Oldest-first allocation follows the amount until the user edits the grid.
  const auto = React.useMemo(() => {
    if (!party || !data) return { allocations: [], restP: 0 }
    return allocateOldestFirst(
      amountP ?? 0,
      items.filter((i) => i.availableP > 0).map((i) => ({ ...i.invoice, availableP: i.availableP })),
      party,
      data.tax
    )
  }, [amountP, items, party, data])
  const allocations = React.useMemo(() => {
    if (!manualAlloc) return auto.allocations
    return Object.entries(alloc)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([invoiceId, v]) => ({ invoiceId, amountP: v ?? 0 }))
  }, [manualAlloc, alloc, auto])
  const proposed = React.useMemo(
    () => (party && data ? deductionsFor(party, allocations, invoiceMap, data.tax) : { vdsP: 0, aitP: 0 }),
    [party, data, allocations, invoiceMap]
  )
  const vdsP = manualDed ? (vds ?? 0) : proposed.vdsP
  const aitP = manualDed ? (ait ?? 0) : proposed.aitP
  const allocatedP = allocations.reduce((s, a) => s + a.amountP, 0)
  const advanceP = (amountP ?? 0) + vdsP + aitP - allocatedP
  const overAlloc = allocations.some((a) => {
    const item = items.find((i) => i.invoice.id === a.invoiceId)
    return !item || a.amountP > item.availableP
  })
  const needsCert = vdsP + aitP > 0 && !certificateNo.trim()
  const chequeOk = method !== "cheque" || (chequeNo.trim().length >= 3 && bank.trim().length >= 2 && !!chequeDate)
  const valid =
    !!party && !!account && (amountP ?? 0) >= 0 && ((amountP ?? 0) > 0 || allocatedP > 0) && advanceP >= 0 && !overAlloc && !needsCert && chequeOk && !!day

  const resetAfterSave = () => {
    action.renew()
  }

  const save = async (confirmed?: boolean) => {
    if (!valid || !party || !account) return
    const result = await record.run({
      partyId: party.id,
      locationId: actor?.locationId ?? undefined,
      date: day,
      method,
      cashBankAccountId: account.id,
      amountP: amountP ?? 0,
      allocations,
      vdsDeductedP: vdsP,
      aitDeductedP: aitP,
      certificateNo: certificateNo.trim() || undefined,
      ref: ref.trim() || undefined,
      cheque: method === "cheque" ? { chequeNo: chequeNo.trim(), bankName: bank.trim(), chequeDate } : undefined,
      confirmed,
      idempotencyKey: action.key,
    })
    if (result) {
      resetAfterSave()
      toast.success(result.status === "pending" ? t("ar.form.savedPending", { no: result.receiptNo }) : t("ar.form.saved", { no: result.receiptNo }))
      if (result.released) toast.success(t("ar.form.released", { party: nameOf(party, locale) }))
      router.push(`/ar/receipts?id=${result.receiptId}`)
    }
  }

  const onSave = () => {
    if (method === "bkash" || method === "nagad") setMfsOpen(true)
    else void save()
  }

  return (
    <div className="flex flex-col gap-4" data-testid="receipt-form">
      <PageHeader title={t("ar.pages.receiptNew")} subtitle={t("ar.form.subtitle")} />
      {party && party.status !== "active" ? (
        <Banner icon={<AlertTriangle />} testId="credit-hold-banner">
          {t("ar.form.onHold", { party: nameOf(party, locale), reason: party.holdReason ?? "" })}
        </Banner>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("ar.form.customer")} size="sm">
            <div className="grid gap-3 @container sm:grid-cols-2">
              <Field label={t("ar.form.customer")} className="sm:col-span-2">
                <PartyPicker
                  value={partyId}
                  onChange={(id) => {
                    setPartyId(id)
                    setAlloc({})
                    setManualAlloc(false)
                    setManualDed(false)
                  }}
                  testId="receipt-party"
                />
              </Field>
              <Field group label={t("ar.form.method")} className="sm:col-span-2">
                <Pills
                  value={method}
                  testId="receipt-method"
                  onChange={(m) => {
                    setMethod(m as ReceiptMethod)
                    setAccountId("")
                  }}
                  options={METHODS.map((m) => ({ value: m, label: tk(`ar.method.${m}`) }))}
                />
              </Field>
              <Field label={t("ar.form.account")}>
                <NativeSelect
                  value={account?.id ?? ""}
                  onChange={setAccountId}
                  testId="receipt-account"
                  options={accounts.map((a) => ({ value: a.id, label: nameOf(a, locale) }))}
                />
              </Field>
              <Field label={t("ar.form.date")}>
                <DateField value={day} onChange={setDate} max={today || undefined} data-testid="receipt-date" />
              </Field>
              <Field label={t("ar.form.amount")} hint={t("ar.form.amountHint")}>
                <MoneyInput
                  valueP={amountP}
                  onChange={(v) => {
                    setAmountP(v)
                    setManualAlloc(false)
                  }}
                  data-testid="receipt-amount"
                />
              </Field>
              {method !== "cash" && method !== "cheque" ? (
                <Field label={t("ar.form.reference")} hint={t("ar.form.referenceHint")}>
                  <TextInput value={ref} onChange={(e) => setRef(e.target.value)} lang="en" className="font-mono" testId="receipt-ref" />
                </Field>
              ) : null}
            </div>
            {method === "bkash" || method === "nagad" ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Smartphone className="size-4" />
                <SimulatedBadge />
              </div>
            ) : null}
            {method === "cheque" ? (
              <div className="mt-4 grid gap-3 rounded-lg bg-surface-raised/50 p-3 sm:grid-cols-3" data-testid="receipt-cheque">
                <Field label={t("ar.form.chequeNo")}>
                  <TextInput value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} lang="en" className="font-mono" testId="cheque-no" />
                </Field>
                <Field label={t("ar.form.bank")}>
                  <TextInput value={bank} onChange={(e) => setBank(e.target.value)} testId="cheque-bank" />
                </Field>
                <Field label={t("ar.form.chequeDate")}>
                  <DateField value={chequeDate} onChange={setChequeDate} data-testid="cheque-date" />
                </Field>
                <p className="text-xs text-muted-foreground sm:col-span-3">{chequeDate && chequeDate > day ? t("ar.form.pdc") : t("ar.form.chequeNote")}</p>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            title={t("ar.form.allocation")}
            subtitle={t("ar.form.allocationHint")}
            size="sm"
            action={
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setManualAlloc(false)
                    setAlloc({})
                  }}
                  data-testid="alloc-auto"
                >
                  <Wand2 />
                  <span className="hidden sm:inline">{t("ar.form.autoAllocate")}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setManualAlloc(true)
                    setAlloc({})
                  }}
                  data-testid="alloc-clear"
                >
                  {t("ar.form.clearAllocation")}
                </Button>
              </div>
            }
          >
            <div data-testid="receipt-allocation" className="@container/alloc flex flex-col">
              {!party ? (
                <p className="py-4 text-sm text-muted-foreground">{t("ar.form.pickCustomer")}</p>
              ) : !items.length ? (
                <p className="py-4 text-sm text-muted-foreground">{t("ar.form.noOpen")}</p>
              ) : (
                <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
                  <thead>
                    <tr>
                      <th className="h-9 rounded-l-md bg-surface-raised px-2 text-left font-medium">{t("ar.form.colInvoice")}</th>
                      <th className="hidden h-9 bg-surface-raised px-2 text-left font-medium @min-[34rem]/alloc:table-cell">{t("ar.form.colDue")}</th>
                      <th className="h-9 bg-surface-raised px-2 text-right font-medium">{t("ar.form.colOpen")}</th>
                      <th className="h-9 w-40 rounded-r-md bg-surface-raised px-2 text-right font-medium">{t("ar.form.colAllocate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const current = allocations.find((a) => a.invoiceId === i.invoice.id)?.amountP ?? 0
                      const over = current > i.availableP
                      return (
                        <tr key={i.invoice.id} data-testid="alloc-row" data-invoice-no={i.invoice.invoiceNo}>
                          <td className="border-b border-hairline px-2 py-1.5">
                            <div className="flex flex-col">
                              <DocLink docType="salesInvoices" docId={i.invoice.id} docNo={i.invoice.invoiceNo} showApp={false} />
                              <span className="text-xs text-muted-foreground">{dmy(i.invoice.date)}</span>
                            </div>
                          </td>
                          <td className="hidden border-b border-hairline px-2 py-1.5 @min-[34rem]/alloc:table-cell">
                            <span className={cn("nums", i.dpd > 0 && "text-destructive")}>{dmy(i.invoice.dueDate)}</span>
                            {i.dpd > 0 ? <span className="block text-xs text-destructive">{t("ar.credit.days", { count: num(i.dpd) })}</span> : null}
                          </td>
                          <td className="border-b border-hairline px-2 py-1.5 text-right">
                            <MoneyText poisha={i.availableP} className="font-mono" />
                            {i.invoice.reservedP > 0 ? <span className="block text-xs text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning">{t("ar.form.reserved", { amount: money(i.invoice.reservedP) })}</span> : null}
                          </td>
                          <td className="border-b border-hairline px-2 py-1.5">
                            <MoneyInput
                              valueP={current || null}
                              aria-invalid={over || undefined}
                              disabled={i.availableP <= 0}
                              data-testid="alloc-input"
                              onChange={(v) => {
                                const base: Record<string, number | null> = manualAlloc ? { ...alloc } : Object.fromEntries(auto.allocations.map((a) => [a.invoiceId, a.amountP]))
                                base[i.invoice.id] = v
                                setAlloc(base)
                                setManualAlloc(true)
                              }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("ar.form.deductions")} size="sm">
            <p className="mb-3 text-xs text-muted-foreground">{t("ar.form.deductionsHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label={t("ar.form.vds")}>
                <MoneyInput
                  valueP={vdsP}
                  onChange={(v) => {
                    if (!manualDed) setAit(aitP)
                    setVds(v)
                    setManualDed(true)
                  }}
                  data-testid="receipt-vds"
                />
              </Field>
              <Field label={t("ar.form.ait")}>
                <MoneyInput
                  valueP={aitP}
                  onChange={(v) => {
                    if (!manualDed) setVds(vdsP)
                    setAit(v)
                    setManualDed(true)
                  }}
                  data-testid="receipt-ait"
                />
              </Field>
              <Field label={t("ar.form.certificateNo")} error={needsCert ? t("ar.form.certificateRequired") : undefined} className="sm:col-span-2 xl:col-span-1">
                <TextInput value={certificateNo} onChange={(e) => setCertificateNo(e.target.value)} lang="en" className="font-mono" testId="receipt-certificate" />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title={t("ar.form.summary")} size="sm">
            <dl className="flex flex-col gap-2 text-sm" data-testid="receipt-summary">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ar.form.amount")}</dt>
                <dd>
                  <MoneyText poisha={amountP ?? 0} className="font-mono" />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ar.form.deducted")}</dt>
                <dd>
                  <MoneyText poisha={vdsP + aitP} className="font-mono" />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ar.form.allocated")}</dt>
                <dd>
                  <MoneyText poisha={allocatedP} className="font-mono" />
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-hairline pt-2 font-semibold">
                <dt>{t("ar.form.toAdvance")}</dt>
                <dd data-testid="receipt-advance">
                  <MoneyText poisha={Math.max(0, advanceP)} className="font-mono" />
                </dd>
              </div>
              {advanceP < 0 ? <p className="text-xs text-destructive">{t("ar.form.overAllocated", { amount: money(-advanceP) })}</p> : null}
            </dl>
            <Button className="mt-4 w-full" disabled={!valid || record.pending} onClick={onSave} data-testid="receipt-save">
              {t("ar.form.save")}
            </Button>
          </SectionCard>
        </div>
      </div>

      <Dialog open={mfsOpen} onOpenChange={setMfsOpen}>
        <DialogContent data-testid="mfs-dialog">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{t("ar.form.mfsTitle")}</DialogTitle>
              <SimulatedBadge />
            </div>
            <DialogDescription>{t("ar.form.mfsBody", { wallet: tk(`ar.method.${method}`), amount: money(amountP ?? 0) })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="neutral" onClick={() => setMfsOpen(false)}>
              {t("ar.form.mfsCancel")}
            </Button>
            <Button
              data-testid="mfs-approve"
              onClick={() => {
                setMfsOpen(false)
                void save(true)
              }}
            >
              {t("ar.form.mfsApproved")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
