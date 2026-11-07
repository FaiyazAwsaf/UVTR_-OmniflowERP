"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { merchantFeeP } from "@/core/connectors/payments"
import { useDb } from "@/core/db/DbProvider"
import type { SettlementRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { CsvButton, Field, ListTable, NativeSelect, Pills, Stat, TextInput, useActionKey, useToday, type Column } from "@/modules/par/components/kit"

import { recordSettlement } from "../commands"
import { useBalances } from "./transfers"

const TAG = { card: "CARD_CLEARING", bkash: "MFS_BKASH", nagad: "MFS_NAGAD" } as const

/** /cab/settlements: card and MFS clearing settled to the bank with fees (plan §9). */
export function Settlements() {
  const db = useDb()
  const params = useSearchParams()
  const focus = params.get("id")
  const { t, tk, locale, dmy, num } = useLocale()
  const { can } = usePermissions()
  const balances = useBalances()
  const [open, setOpen] = React.useState(false)
  const data = useLiveQuery(async () => {
    const [rows, accounts] = await Promise.all([db.settlements.toArray(), db.cashBankAccounts.toArray()])
    return { rows: rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.settlementNo.localeCompare(a.settlementNo))), accounts: new Map(accounts.map((a) => [a.id, a])) }
  }, [db])
  const clearing = (balances?.accounts ?? []).filter((a) => a.kind === "mfs" || a.kind === "card-clearing")

  const columns: Column<SettlementRow>[] = [
    { key: "date", header: t("cab.settle.colDate"), cell: (r) => <span className="nums">{dmy(r.date)}</span> },
    { key: "no", header: t("cab.settle.colNo"), cell: (r) => <DocLink docType="journals" docId={r.journalId} docNo={r.settlementNo} showApp={false} /> },
    { key: "kind", header: t("cab.settle.colKind"), cell: (r) => tk(`cab.settle.kinds.${r.kind}`) },
    { key: "bank", header: t("cab.settle.colBank"), hide: "lg", cell: (r) => nameOf(data?.accounts.get(r.bankAccountId), locale) },
    { key: "ref", header: t("cab.settle.colRef"), hide: "lg", cell: (r) => <span lang="en" className="font-mono text-xs">{r.ref}</span> },
    { key: "gross", header: t("cab.settle.colGross"), align: "right", hide: "sm", cell: (r) => <MoneyText poisha={r.grossP} className="font-mono" /> },
    { key: "fees", header: t("cab.settle.colFees"), align: "right", hide: "md", cell: (r) => <MoneyText poisha={r.feesP} className="font-mono" /> },
    { key: "net", header: t("cab.settle.colNet"), align: "right", cell: (r) => <MoneyText poisha={r.netP} className="font-mono" /> },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="settlements">
      <PageHeader
        title={t("cab.pages.settlements")}
        subtitle={t("cab.settle.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="cab.export"
              fileName="settlements"
              rows={(data?.rows ?? []).map((r) => ({ date: r.date, no: r.settlementNo, kind: r.kind, grossP: r.grossP, feesP: r.feesP, netP: r.netP, ref: r.ref }))}
              columns={[
                { key: "date", label: t("cab.settle.colDate") },
                { key: "no", label: t("cab.settle.colNo") },
                { key: "kind", label: t("cab.settle.colKind") },
                { key: "grossP", label: t("cab.settle.colGross") },
                { key: "feesP", label: t("cab.settle.colFees") },
                { key: "netP", label: t("cab.settle.colNet") },
                { key: "ref", label: t("cab.settle.colRef") },
              ]}
            />
            {can("cab.settlement.create") ? (
              <Button onClick={() => setOpen(true)} data-testid="settlement-new">
                <Plus />
                {t("cab.settle.new")}
              </Button>
            ) : null}
          </>
        }
      />
      <section className="surface-card flex flex-wrap gap-x-8 gap-y-3 p-4">
        {clearing.map((a) => (
          <Stat key={a.id} label={nameOf(a, locale)} value={<MoneyText poisha={balances?.balance.get(a.id) ?? 0} />} />
        ))}
        <SimulatedBadge className="ml-auto self-center" />
      </section>
      <section className="surface-card flex flex-col gap-3 p-4 md:p-5">
        <span className="text-xs text-muted-foreground">{t("cab.settle.count", { count: num(data?.rows.length ?? 0) })}</span>
        <ListTable rows={data?.rows} columns={columns} rowKey={(r) => r.id} rowTestId="settlement-row" rowClassName={(r) => (r.id === focus ? "bg-primary-soft" : undefined)} dense />
      </section>
      <SettlementDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

function SettlementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale, money } = useLocale()
  const today = useToday()
  const run = useCommand(recordSettlement)
  const action = useActionKey("set")
  const balances = useBalances()
  const [kind, setKind] = React.useState<"card" | "bkash" | "nagad">("card")
  const [bankId, setBankId] = React.useState("")
  const [grossP, setGrossP] = React.useState<number | null>(null)
  const [feesP, setFeesP] = React.useState<number | null>(null)
  const [ref, setRef] = React.useState("")
  const [date, setDate] = React.useState("")
  const accounts = balances?.accounts ?? []
  const clearingAcc = accounts.find((a) => a.accountTag === TAG[kind])
  const clearingBal = clearingAcc ? (balances?.balance.get(clearingAcc.id) ?? 0) : 0
  const banks = accounts.filter((a) => a.kind === "bank")
  const bank = banks.find((b) => b.id === bankId) ?? banks.find((b) => b.accountTag === "BANK_MAIN") ?? banks[0]
  const gross = grossP ?? clearingBal
  const fees = feesP ?? merchantFeeP(kind, gross)
  const valid = !!bank && gross > 0 && gross <= clearingBal && fees < gross && ref.trim().length >= 2
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="settlement-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid || !bank) return
            const r = await run.run({ kind, bankAccountId: bank.id, grossP: gross, feesP: fees, ref: ref.trim(), date: date || undefined, idempotencyKey: action.key })
            if (r) {
              action.renew()
              toast.success(t("cab.settle.saved", { no: r.settlementNo }))
              setGrossP(null)
              setFeesP(null)
              setRef("")
              onOpenChange(false)
            }
          }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{t("cab.settle.formTitle")}</DialogTitle>
              <SimulatedBadge />
            </div>
          </DialogHeader>
          <Field group label={t("cab.settle.kind")} hint={t("cab.settle.clearing", { amount: money(clearingBal) })}>
            <Pills
              value={kind}
              onChange={(v) => {
                setKind(v as "card" | "bkash" | "nagad")
                setGrossP(null)
                setFeesP(null)
              }}
              testId="settlement-kind"
              options={(["card", "bkash", "nagad"] as const).map((k) => ({ value: k, label: t(`cab.settle.kinds.${k}`) }))}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("cab.settle.bank")}>
              <NativeSelect value={bank?.id ?? ""} onChange={setBankId} options={banks.map((b) => ({ value: b.id, label: nameOf(b, locale) }))} />
            </Field>
            <Field label={t("cab.settle.gross")}>
              <MoneyInput valueP={gross} onChange={setGrossP} data-testid="settlement-gross" />
            </Field>
            <Field label={t("cab.settle.fees")} hint={t("cab.settle.feesHint")}>
              <MoneyInput valueP={fees} onChange={setFeesP} />
            </Field>
            <Field label={t("cab.settle.net")}>
              <div className="flex h-10 items-center justify-end rounded-md bg-surface-raised/60 px-3">
                <MoneyText poisha={gross - fees} className="font-mono font-semibold" />
              </div>
            </Field>
            <Field label={t("cab.settle.ref")}>
              <TextInput value={ref} onChange={(e) => setRef(e.target.value)} lang="en" className="font-mono" testId="settlement-ref" />
            </Field>
            <Field label={t("ar.form.date")}>
              <DateField value={date || today} onChange={setDate} max={today || undefined} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || run.pending} data-testid="settlement-save">
              {t("cab.settle.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
