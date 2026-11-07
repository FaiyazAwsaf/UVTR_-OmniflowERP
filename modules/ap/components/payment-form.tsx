"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ShieldAlert, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PartyPicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { defaultTaxSettings } from "@/config/rules.config"
import { useDb } from "@/core/db/DbProvider"
import { readSetting } from "@/core/db/settings"
import type { Id, PayMethod } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useLimit } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { withholdingFor } from "@/core/tax/withholding"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { apOpenItems } from "@/modules/ar/queries"
import { Banner, Field, NativeSelect, Pills, TextInput, useActionKey, useToday } from "@/modules/par/components/kit"

import { payAccountFits, recordPayment } from "../commands"
import { reservedByBill } from "../queries"

const METHODS: PayMethod[] = ["bank-transfer", "cheque", "cash", "bkash"]

/** /ap/payments/new: pay vendor bills with AIT and VDS withheld (plan §9). */
export function PaymentForm() {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const today = useToday()
  const { t, tk, locale, money, dmy } = useLocale()
  const limit = useLimit("payment")
  const record = useCommand(recordPayment)
  const action = useActionKey("vp")
  const [vendorId, setVendorId] = React.useState<Id | null>(params.get("party"))
  const preBill = params.get("bill")
  const [method, setMethod] = React.useState<PayMethod>("bank-transfer")
  const [accountId, setAccountId] = React.useState("")
  const [chequeNo, setChequeNo] = React.useState("")
  const [date, setDate] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [sel, setSel] = React.useState<Record<Id, { on: boolean; amountP: number | null }>>({})
  const day = date || today

  const data = useLiveQuery(async () => {
    const [accounts, tax] = await Promise.all([db.cashBankAccounts.toArray(), readSetting(db, "tax").catch(() => defaultTaxSettings)])
    if (!vendorId || !today) return { accounts, tax, vendor: undefined, bills: [] }
    const [vendor, items, reserved] = await Promise.all([db.parties.get(vendorId), apOpenItems(db, today, vendorId), reservedByBill(db, vendorId)])
    const bills = items
      .map((i) => ({ ...i, reservedP: reserved.get(i.bill.id) ?? 0, availableP: i.openP - (reserved.get(i.bill.id) ?? 0) }))
      .sort((a, b) => (a.bill.dueDate < b.bill.dueDate ? -1 : 1))
    return { accounts, tax, vendor, bills }
  }, [db, vendorId, today])

  const accounts = (data?.accounts ?? []).filter((a) => a.active && payAccountFits(a.kind, a.accountTag, method))
  const account = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.accountTag === "BANK_MAIN") ?? accounts.find((a) => a.locationId === "loc_hq") ?? accounts[0]
  const vendor = data?.vendor
  const bills = React.useMemo(() => data?.bills ?? [], [data])

  const chosen = bills
    .map((b) => {
      const s = sel[b.bill.id] ?? { on: preBill ? b.bill.id === preBill : bills.length === 1, amountP: b.availableP }
      return { b, s, amountP: s.amountP ?? 0 }
    })
    .filter((x) => x.s.on && x.amountP > 0)
  const over = chosen.some((x) => x.amountP > x.b.availableP)
  const wh = withholdingFor(
    vendor?.vendorTaxCategory,
    chosen.map((x) => ({ allocatedP: x.amountP, billNetP: x.b.bill.subtotalP, billVatP: x.b.bill.inputVatP, billTotalP: x.b.bill.totalP })),
    data?.tax ?? defaultTaxSettings
  )
  const gross = chosen.reduce((s, x) => s + x.amountP, 0)
  const valid = !!vendor && !!account && chosen.length > 0 && !over && (method !== "cheque" || chequeNo.trim().length >= 3) && !!day
  const needsApproval = gross > limit

  const save = async () => {
    if (!valid || !vendor || !account) return
    const r = await record.run({
      partyId: vendor.id,
      date: day,
      method,
      cashBankAccountId: account.id,
      allocations: chosen.map((x) => ({ billId: x.b.bill.id, amountP: x.amountP })),
      chequeNo: method === "cheque" ? chequeNo.trim() : undefined,
      reason: reason.trim(),
      idempotencyKey: action.key,
    })
    if (r) {
      action.renew()
      toast.success(r.status === "posted" ? t("ap.pay.saved", { no: r.paymentNo }) : t("ap.pay.submitted", { no: r.paymentNo }))
      router.push(`/ap/payments/${r.paymentId}`)
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="payment-form">
      <PageHeader title={t("ap.pages.paymentNew")} subtitle={t("ap.pay.subtitle")} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("ap.pay.vendor")} size="sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("ap.pay.vendor")} className="sm:col-span-2">
                <PartyPicker
                  value={vendorId}
                  kind="vendor"
                  testId="payment-vendor"
                  onChange={(id) => {
                    setVendorId(id)
                    setSel({})
                  }}
                />
              </Field>
              <Field group label={t("ap.pay.method")} className="sm:col-span-2">
                <Pills
                  value={method}
                  testId="payment-method"
                  onChange={(m) => {
                    setMethod(m as PayMethod)
                    setAccountId("")
                  }}
                  options={METHODS.map((m) => ({ value: m, label: tk(`ap.method.${m}`) }))}
                />
              </Field>
              <Field label={t("ap.pay.account")}>
                <NativeSelect value={account?.id ?? ""} onChange={setAccountId} testId="payment-account" options={accounts.map((a) => ({ value: a.id, label: nameOf(a, locale) }))} />
              </Field>
              <Field label={t("ap.pay.date")}>
                <DateField value={day} onChange={setDate} max={today || undefined} />
              </Field>
              {method === "cheque" ? (
                <Field label={t("ap.pay.chequeNo")}>
                  <TextInput value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} lang="en" className="font-mono" testId="payment-cheque-no" />
                </Field>
              ) : null}
            </div>
          </SectionCard>
          <SectionCard title={t("ap.pay.bills")} size="sm">
            <div className="@container/bills min-w-0 overflow-x-auto" data-testid="payment-bills">
              {!vendor ? (
                <p className="py-4 text-sm text-muted-foreground">{t("ap.pay.pickVendor")}</p>
              ) : !bills.length ? (
                <p className="py-4 text-sm text-muted-foreground">{t("ap.pay.noBills")}</p>
              ) : (
                <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
                  <thead>
                    <tr className="[&>th]:h-9 [&>th]:bg-surface-raised [&>th]:px-2 [&>th]:font-medium">
                      <th className="w-8 rounded-l-md" />
                      <th className="text-left">{t("ap.pay.colBill")}</th>
                      <th className="hidden text-left @min-[30rem]/bills:table-cell">{t("ap.pay.colDue")}</th>
                      <th className="text-right">{t("ap.pay.colOpen")}</th>
                      <th className="w-40 rounded-r-md text-right">{t("ap.pay.colPay")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b) => {
                      const s = sel[b.bill.id] ?? { on: preBill ? b.bill.id === preBill : bills.length === 1, amountP: b.availableP }
                      return (
                        <tr key={b.bill.id} data-testid="pay-bill-row" data-bill-no={b.bill.billNo} className="[&>td]:border-b [&>td]:border-hairline [&>td]:px-2 [&>td]:py-1.5">
                          <td>
                            <Checkbox checked={s.on} disabled={b.availableP <= 0} onCheckedChange={(v) => setSel((x) => ({ ...x, [b.bill.id]: { ...s, on: !!v } }))} data-testid="pay-bill-check" />
                          </td>
                          <td>
                            <div className="flex flex-col">
                              <DocLink docType="vendorBills" docId={b.bill.id} docNo={b.bill.billNo} showApp={false} />
                              <span lang="en" className="font-mono text-xs text-muted-foreground">
                                {b.bill.vendorRef}
                              </span>
                            </div>
                          </td>
                          <td className="hidden @min-[30rem]/bills:table-cell">
                            <span className={cn("nums", b.dpd > 0 && "text-destructive")}>{dmy(b.bill.dueDate)}</span>
                          </td>
                          <td className="text-right">
                            <MoneyText poisha={b.availableP} className="font-mono" />
                            {b.reservedP ? <span className="block text-xs text-muted-foreground">{t("ap.pay.reserved", { amount: money(b.reservedP) })}</span> : null}
                          </td>
                          <td>
                            <MoneyInput
                              valueP={s.amountP}
                              disabled={!s.on}
                              aria-invalid={(s.amountP ?? 0) > b.availableP || undefined}
                              onChange={(v) => setSel((x) => ({ ...x, [b.bill.id]: { ...s, amountP: v } }))}
                              data-testid="pay-bill-amount"
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
          <SectionCard title={t("ap.pay.withholding")} size="sm" subtitle={vendor?.vendorTaxCategory ? t("ap.pay.category", { category: tk(`par.taxCategory.${vendor.vendorTaxCategory}`) }) : undefined}>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ap.pay.gross")}</dt>
                <dd data-testid="payment-gross">
                  <MoneyText poisha={gross} className="font-mono" />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ap.pay.ait")}</dt>
                <dd data-testid="withholding-ait" data-amount={wh.aitP}>
                  <MoneyText poisha={wh.aitP} className="font-mono" />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ap.pay.vds")}</dt>
                <dd data-testid="withholding-vds" data-amount={wh.vdsP}>
                  <MoneyText poisha={wh.vdsP} className="font-mono" />
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-hairline pt-2 text-base font-semibold">
                <dt>{t("ap.pay.net")}</dt>
                <dd data-testid="payment-net" data-amount={wh.netPaidP}>
                  <MoneyText poisha={wh.netPaidP} className="font-mono" />
                </dd>
              </div>
            </dl>
            {gross > 0 ? (
              <Banner className="mt-3" tone={needsApproval ? "warning" : "success"} icon={needsApproval ? <ShieldAlert /> : <ShieldCheck />} testId="payment-limit">
                {needsApproval ? t("ap.pay.limitOver", { limit: money(Number.isFinite(limit) ? limit : 0) }) : t("ap.pay.limitOk")}
              </Banner>
            ) : null}
            {needsApproval ? (
              <Field label={t("ap.pay.reason")} className="mt-3">
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            ) : null}
            <Button className="mt-4 w-full" disabled={!valid || record.pending} onClick={save} data-testid="payment-save">
              {t("ap.pay.save")}
            </Button>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
