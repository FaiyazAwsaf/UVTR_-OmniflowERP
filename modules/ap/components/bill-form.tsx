"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCircle2, PauseCircle, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { MoneyInput, QtyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PartyPicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { locations } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { useDb } from "@/core/db/DbProvider"
import type { ExpenseTag, Id, VendorTaxCategory } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { nameOf } from "@/core/security/users"
import { percentOf } from "@/core/tax/vat"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { Banner, Field, NativeSelect, Pills, TextInput, useActionKey, useToday } from "@/modules/par/components/kit"

import { EXPENSE_TAGS, recordBill } from "../commands"
import { goodsLineValues, matchLine } from "../lib"
import { billableLines } from "../queries"

type GoodsState = Record<Id, { include: boolean; qty: number | null; priceP: number | null }>
type ExpenseLine = { tag: ExpenseTag; description: string; locationId: string; netP: number | null; vatPct: string }

const DEFAULT_TAG: Record<VendorTaxCategory, ExpenseTag> = {
  goods: "OFFICE",
  services: "SECURITY",
  rent: "RENT",
  professional: "PROFESSIONAL",
  utility: "UTILITIES",
  exempt: "OFFICE",
}

/** /ap/bills/new: a goods bill from GRNs with the three-way match panel, or an expense bill (plan §9). */
export function BillForm() {
  const db = useDb()
  const router = useRouter()
  const today = useToday()
  const { t, tk, locale, num, money } = useLocale()
  const record = useCommand(recordBill)
  const action = useActionKey("bl")
  const [kind, setKind] = React.useState<"goods" | "expense">("goods")
  const [vendorId, setVendorId] = React.useState<Id | null>(null)
  const [vendorRef, setVendorRef] = React.useState("")
  const [date, setDate] = React.useState("")
  const [dueDate, setDueDate] = React.useState("")
  const [mushak, setMushak] = React.useState(true)
  const [reason, setReason] = React.useState("")
  const [goods, setGoods] = React.useState<GoodsState>({})
  const [expense, setExpense] = React.useState<ExpenseLine[]>([])
  const day = date || today

  const data = useLiveQuery(async () => {
    if (!vendorId) return { vendor: undefined, lines: [] }
    const [vendor, lines] = await Promise.all([db.parties.get(vendorId), billableLines(db, vendorId)])
    return { vendor, lines }
  }, [db, vendorId])
  const vendor = data?.vendor
  const lines = React.useMemo(() => data?.lines ?? [], [data])

  const goodsRows = React.useMemo(
    () =>
      lines.map((l) => {
        const s = goods[l.grnLine.id] ?? { include: l.availableQty > 0, qty: l.availableQty, priceP: l.grnLine.unitCostP }
        const qty = s.qty ?? 0
        const priceP = s.priceP ?? 0
        const vatRate = l.poLine?.vatRatePct ?? rules.vatStandardPct
        const values = goodsLineValues(qty, priceP, l.grnLine.unitCostP, vatRate)
        const diffs = s.include
          ? matchLine({ poLineId: l.poLine?.id, itemId: l.grnLine.itemId, availableQty: l.availableQty, poPriceP: l.grnLine.unitCostP, billQty: qty, billPriceP: priceP }, rules.threeWayMatch.priceTolerancePct)
          : []
        return { l, s, qty, priceP, values, diffs, over: s.include && qty > l.availableQty + 1e-9 }
      }),
    [lines, goods]
  )
  const included = goodsRows.filter((r) => r.s.include && r.qty > 0)
  const expenseRows = expense.map((e) => {
    const netP = e.netP ?? 0
    const vatPct = Number(e.vatPct) || 0
    return { e, netP, vatP: percentOf(netP, vatPct), vatPct }
  })

  const subtotal = kind === "goods" ? included.reduce((s, r) => s + r.values.netP, 0) : expenseRows.reduce((s, r) => s + r.netP, 0)
  const vat = kind === "goods" ? included.reduce((s, r) => s + r.values.vatP, 0) : expenseRows.reduce((s, r) => s + r.vatP, 0)
  const ppv = included.reduce((s, r) => s + r.values.ppvP, 0)
  const mismatch = kind === "goods" && included.some((r) => r.diffs.length > 0)
  const valid =
    !!vendor &&
    vendorRef.trim().length >= 2 &&
    !!day &&
    (kind === "goods" ? included.length > 0 && !goodsRows.some((r) => r.over) && included.every((r) => r.priceP > 0) : expenseRows.length > 0 && expenseRows.every((r) => r.netP > 0 && r.e.description.trim().length >= 2))

  const setLine = (id: Id, patch: Partial<GoodsState[string]>, base: GoodsState[string]) => setGoods((g) => ({ ...g, [id]: { ...(g[id] ?? base), ...patch } }))

  const selectVendor = (id: Id | null) => {
    setVendorId(id)
    setGoods({})
  }
  const ensureExpense = () => {
    if (!expense.length) setExpense([{ tag: DEFAULT_TAG[vendor?.vendorTaxCategory ?? "goods"], description: "", locationId: "loc_hq", netP: null, vatPct: vendor?.vendorTaxCategory === "utility" ? "0" : "15" }])
  }

  const save = async () => {
    if (!valid || !vendor) return
    const result = await record.run({
      kind,
      partyId: vendor.id,
      vendorRef: vendorRef.trim(),
      date: day,
      dueDate: dueDate || undefined,
      hasMushak63: mushak,
      goodsLines: kind === "goods" ? included.map((r) => ({ grnLineId: r.l.grnLine.id, qty: r.qty, unitPriceP: r.priceP })) : [],
      expenseLines:
        kind === "expense"
          ? expenseRows.map((r) => ({ expenseTag: r.e.tag, description: r.e.description.trim(), netP: r.netP, vatRatePct: r.vatPct, locationId: r.e.locationId }))
          : [],
      reason: reason.trim(),
      idempotencyKey: action.key,
    })
    if (result) {
      action.renew()
      toast.success(result.status === "posted" ? t("ap.form.saved", { no: result.billNo }) : t("ap.form.savedHold", { no: result.billNo }))
      router.push(`/ap/bills/${result.billId}`)
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="bill-form">
      <PageHeader title={t("ap.pages.billNew")} subtitle={t("ap.form.subtitle")} />
      <SectionCard title={t("ap.form.vendor")} size="sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t("ap.form.kind")} className="sm:col-span-2 xl:col-span-4">
            <Pills
              value={kind}
              testId="bill-kind"
              onChange={(v) => {
                setKind(v as "goods" | "expense")
                if (v === "expense") ensureExpense()
              }}
              options={[
                { value: "goods", label: t("ap.form.goods") },
                { value: "expense", label: t("ap.form.expense") },
              ]}
            />
          </Field>
          <Field label={t("ap.form.vendor")} className="sm:col-span-2">
            <PartyPicker value={vendorId} onChange={(id) => selectVendor(id)} kind="vendor" testId="bill-vendor" />
          </Field>
          <Field label={t("ap.form.vendorRef")}>
            <TextInput value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} lang="en" className="font-mono" testId="bill-vendor-ref" />
          </Field>
          <Field label={t("ap.form.date")}>
            <DateField value={day} onChange={setDate} max={today || undefined} />
          </Field>
          <Field label={t("ap.form.dueDate")} hint={t("ap.form.dueHint")}>
            <DateField value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label={t("ap.form.mushak")} hint={t("ap.form.mushakHint")} className="sm:col-span-2 xl:col-span-3">
            <label className="flex items-center gap-2 pt-1 text-sm">
              <Checkbox checked={mushak} onCheckedChange={(v) => setMushak(!!v)} data-testid="bill-mushak" />
              {t("ap.bill.mushak")}
            </label>
          </Field>
        </div>
      </SectionCard>

      {kind === "goods" ? (
        <SectionCard title={t("ap.form.matchTitle")} subtitle={t("ap.form.matchHint", { pct: num(rules.threeWayMatch.priceTolerancePct) })} size="sm">
          <div data-testid="match-panel" className="@container/match min-w-0 overflow-x-auto">
            {!vendor ? (
              <p className="py-4 text-sm text-muted-foreground">{t("ap.form.pickVendor")}</p>
            ) : !lines.length ? (
              <p className="py-4 text-sm text-muted-foreground">{t("ap.form.noGrns")}</p>
            ) : (
              <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
                <thead>
                  <tr className="[&>th]:h-9 [&>th]:bg-surface-raised [&>th]:px-2 [&>th]:font-medium [&>th]:whitespace-nowrap">
                    <th className="w-8 rounded-l-md" />
                    <th className="text-left">{t("ap.form.colItem")}</th>
                    <th className="hidden text-left @min-[52rem]/match:table-cell">{t("ap.form.colGrn")}</th>
                    <th className="text-right">{t("ap.form.colAvailable")}</th>
                    <th className="hidden text-right @min-[40rem]/match:table-cell">{t("ap.form.colPoPrice")}</th>
                    <th className="text-right">{t("ap.form.colQty")}</th>
                    <th className="text-right">{t("ap.form.colPrice")}</th>
                    <th className="hidden text-right @min-[60rem]/match:table-cell">{t("ap.form.colNet")}</th>
                    <th className="rounded-r-md text-left">{t("ap.form.colResult")}</th>
                  </tr>
                </thead>
                <tbody>
                  {goodsRows.map(({ l, s, qty, priceP, values, diffs, over }) => (
                    <tr key={l.grnLine.id} data-testid="match-line" data-grn-line={l.grnLine.id} data-matched={s.include ? diffs.length === 0 : undefined} className={cn(!s.include && "opacity-55")}>
                      <td className="border-b border-hairline px-2 py-2">
                        <Checkbox checked={s.include} disabled={l.availableQty <= 0} onCheckedChange={(v) => setLine(l.grnLine.id, { include: !!v }, s)} aria-label={t("ap.form.include")} />
                      </td>
                      <td className="border-b border-hairline px-2 py-2">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{nameOf(l.item, locale)}</span>
                          <span lang="en" className="font-mono text-xs text-muted-foreground">
                            {l.item?.sku} · {l.po?.poNo}
                          </span>
                        </div>
                      </td>
                      <td lang="en" className="hidden border-b border-hairline px-2 py-2 font-mono text-xs @min-[52rem]/match:table-cell">
                        {l.grn.grnNo}
                      </td>
                      <td className="border-b border-hairline px-2 py-2 text-right">
                        <span className="nums font-mono">{num(l.availableQty, { maximumFractionDigits: 2 })}</span>
                        <span lang="en" className="ml-1 text-xs text-muted-foreground">
                          {l.item?.purchaseUom}
                        </span>
                        {l.heldQty > 0 ? <span className="block text-xs text-muted-foreground">{t("ap.form.held", { qty: num(l.heldQty) })}</span> : null}
                      </td>
                      <td className="hidden border-b border-hairline px-2 py-2 text-right @min-[40rem]/match:table-cell">
                        <MoneyText poisha={l.grnLine.unitCostP} className="font-mono" />
                      </td>
                      <td className="w-24 border-b border-hairline px-1 py-2">
                        <QtyInput value={s.qty} onChange={(v) => setLine(l.grnLine.id, { qty: v }, s)} disabled={!s.include} aria-invalid={over || undefined} data-testid="bill-qty" />
                      </td>
                      <td className="w-36 border-b border-hairline px-1 py-2">
                        <MoneyInput valueP={s.priceP} onChange={(v) => setLine(l.grnLine.id, { priceP: v }, s)} disabled={!s.include} data-testid="bill-price" />
                      </td>
                      <td className="hidden border-b border-hairline px-2 py-2 text-right @min-[60rem]/match:table-cell">
                        <MoneyText poisha={s.include ? values.netP : 0} className="font-mono" />
                      </td>
                      <td className="border-b border-hairline px-2 py-2">
                        {!s.include ? null : diffs.length ? (
                          <div className="flex flex-col gap-0.5">
                            {diffs.map((d) => (
                              <StatusText key={d.field} tone="warning" dot data-testid="match-diff" data-field={d.field}>
                                {d.field === "qty"
                                  ? t("ap.form.qtyDiff", { actual: num(d.actual, { maximumFractionDigits: 2 }), expected: num(d.expected, { maximumFractionDigits: 2 }) })
                                  : t("ap.form.priceDiff", { pct: `${(d.diffPct ?? 0) > 0 ? "+" : ""}${num(d.diffPct ?? 0, { maximumFractionDigits: 2 })}` })}
                              </StatusText>
                            ))}
                          </div>
                        ) : (
                          <StatusText tone="success" dot>
                            {t("ap.form.ok")}
                          </StatusText>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          title={t("ap.form.expenseLines")}
          subtitle={t("ap.form.demoValues")}
          size="sm"
          action={
            <Button size="sm" variant="outline" onClick={() => setExpense((x) => [...x, { tag: DEFAULT_TAG[vendor?.vendorTaxCategory ?? "goods"], description: "", locationId: "loc_hq", netP: null, vatPct: "15" }])}>
              <Plus />
              {t("ap.form.addLine")}
            </Button>
          }
        >
          <div className="flex flex-col gap-3" data-testid="expense-lines">
            {expense.map((e, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-surface-raised/40 p-2 md:grid-cols-[1.2fr_1.6fr_1fr_1fr_5rem_auto] md:items-end">
                <Field label={t("ap.form.colTag")}>
                  <NativeSelect value={e.tag} onChange={(v) => setExpense((x) => x.map((y, j) => (j === i ? { ...y, tag: v as ExpenseTag } : y)))} options={EXPENSE_TAGS.map((tag) => ({ value: tag, label: tk(`ap.expenseTag.${tag}`) }))} />
                </Field>
                <Field label={t("ap.form.colDescription")}>
                  <TextInput value={e.description} onChange={(ev) => setExpense((x) => x.map((y, j) => (j === i ? { ...y, description: ev.target.value } : y)))} testId="expense-description" />
                </Field>
                <Field label={t("ap.form.colLocation")}>
                  <NativeSelect value={e.locationId} onChange={(v) => setExpense((x) => x.map((y, j) => (j === i ? { ...y, locationId: v } : y)))} options={locations.map((l) => ({ value: l.id, label: l.name[locale] }))} />
                </Field>
                <Field label={t("ap.form.colAmount")}>
                  <MoneyInput valueP={e.netP} onChange={(v) => setExpense((x) => x.map((y, j) => (j === i ? { ...y, netP: v } : y)))} data-testid="expense-amount" />
                </Field>
                <Field label={t("ap.form.colVat")}>
                  <TextInput value={e.vatPct} onChange={(ev) => setExpense((x) => x.map((y, j) => (j === i ? { ...y, vatPct: ev.target.value.replace(/[^\d.]/g, "") } : y)))} inputMode="decimal" className="text-right font-mono" />
                </Field>
                <Button variant="ghost" size="icon" aria-label={t("common.remove")} onClick={() => setExpense((x) => x.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{t("ap.form.subtotal")}</span>
            <MoneyText poisha={subtotal} className="font-mono font-semibold" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{t("ap.form.vat")}</span>
            <MoneyText poisha={vat} className="font-mono font-semibold" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{t("ap.form.total")}</span>
            <span data-testid="bill-total">
              <MoneyText poisha={subtotal + vat} className="font-mono text-lg font-semibold" />
            </span>
          </div>
          {kind === "goods" ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t("ap.form.ppv")}</span>
              <MoneyText poisha={ppv} signed colorize className="font-mono font-semibold" />
            </div>
          ) : null}
        </div>
        {kind === "goods" && included.length ? (
          mismatch ? (
            <Banner icon={<PauseCircle />} testId="bill-result" className="flex-col">
              <p>{t("ap.form.resultMismatch")}</p>
              <Field label={t("ap.form.reason")} className="mt-2">
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)} testId="bill-reason" />
              </Field>
            </Banner>
          ) : (
            <Banner tone="success" icon={<CheckCircle2 />} testId="bill-result">
              {t("ap.form.resultMatched")}
            </Banner>
          )
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={() => router.push("/ap/bills")}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || record.pending} onClick={save} data-testid="bill-save">
            {t("ap.form.save")} · {money(subtotal + vat)}
          </Button>
        </div>
      </section>
    </div>
  )
}
