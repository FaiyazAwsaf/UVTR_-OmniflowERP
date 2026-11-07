"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeftRight, PiggyBank } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDb } from "@/core/db/DbProvider"
import type { CashBankAccountRow, FundTransferRow, Id } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useActor } from "@/core/session/actor"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { CsvButton, Field, ListTable, NativeSelect, TextInput, useActionKey, useToday, type Column } from "@/modules/par/components/kit"

import { topUpPettyCash, transferFunds } from "../commands"
import { cashPosition } from "../queries"

/** Accounts with their GL balances, live (for the transfer dialogs). */
export function useBalances(): { accounts: CashBankAccountRow[]; balance: Map<Id, number> } | undefined {
  const db = useDb()
  const today = useToday()
  return useLiveQuery(async () => {
    if (!today) return undefined
    const rows = await cashPosition(db, today)
    return { accounts: rows.map((r) => r.account), balance: new Map(rows.map((r) => [r.account.id, r.balanceP])) }
  }, [db, today])
}

/** /cab/transfers: contra transfers incl. till deposits and petty cash top-ups (plan §9). */
export function Transfers() {
  const db = useDb()
  const params = useSearchParams()
  const focus = params.get("id")
  const { t, tk, locale, dmy, num } = useLocale()
  const { can } = usePermissions()
  const [open, setOpen] = React.useState<"transfer" | "topup" | null>(params.get("new") ? "transfer" : null)
  const data = useLiveQuery(async () => {
    const [transfers, accounts] = await Promise.all([db.fundTransfers.toArray(), db.cashBankAccounts.toArray()])
    return { transfers: transfers.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.transferNo.localeCompare(a.transferNo))), accounts: new Map(accounts.map((a) => [a.id, a])) }
  }, [db])

  const columns: Column<FundTransferRow>[] = [
    { key: "date", header: t("cab.transfers.colDate"), cell: (r) => <span className="nums">{dmy(r.date)}</span> },
    { key: "no", header: t("cab.transfers.colNo"), cell: (r) => <DocLink docType="journals" docId={r.journalId} docNo={r.transferNo} showApp={false} /> },
    { key: "kind", header: t("cab.transfers.colKind"), hide: "lg", cell: (r) => <span className="text-muted-foreground">{tk(`cab.transfers.kinds.${r.kind}`)}</span> },
    { key: "from", header: t("cab.transfers.colFrom"), hide: "sm", cell: (r) => nameOf(data?.accounts.get(r.fromAccountId), locale) },
    { key: "to", header: t("cab.transfers.colTo"), hide: "md", cell: (r) => nameOf(data?.accounts.get(r.toAccountId), locale) },
    { key: "fees", header: t("cab.transfers.colFees"), align: "right", hide: "lg", cell: (r) => (r.feesP ? <MoneyText poisha={r.feesP} className="font-mono" /> : "-") },
    { key: "amount", header: t("cab.transfers.colAmount"), align: "right", cell: (r) => <MoneyText poisha={r.amountP} className="font-mono" /> },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="transfers">
      <PageHeader
        title={t("cab.pages.transfers")}
        subtitle={t("cab.transfers.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="cab.export"
              fileName="transfers"
              rows={(data?.transfers ?? []).map((r) => ({ date: r.date, no: r.transferNo, kind: r.kind, from: data?.accounts.get(r.fromAccountId)?.nameEn ?? "", to: data?.accounts.get(r.toAccountId)?.nameEn ?? "", amountP: r.amountP, feesP: r.feesP }))}
              columns={[
                { key: "date", label: t("cab.transfers.colDate") },
                { key: "no", label: t("cab.transfers.colNo") },
                { key: "kind", label: t("cab.transfers.colKind") },
                { key: "from", label: t("cab.transfers.colFrom") },
                { key: "to", label: t("cab.transfers.colTo") },
                { key: "amountP", label: t("cab.transfers.colAmount") },
                { key: "feesP", label: t("cab.transfers.colFees") },
              ]}
            />
            {can("cab.pettycash.create") ? (
              <Button variant="outline" onClick={() => setOpen("topup")} data-testid="topup-new">
                <PiggyBank />
                {t("cab.transfers.topUp")}
              </Button>
            ) : null}
            {can("cab.transfer.create") ? (
              <Button onClick={() => setOpen("transfer")} data-testid="transfer-new">
                <ArrowLeftRight />
                {t("cab.transfers.new")}
              </Button>
            ) : null}
          </>
        }
      />
      <section className="surface-card flex flex-col gap-3 p-4 md:p-5">
        <span className="text-xs text-muted-foreground">{t("cab.transfers.count", { count: num(data?.transfers.length ?? 0) })}</span>
        <ListTable rows={data?.transfers} columns={columns} rowKey={(r) => r.id} rowTestId="transfer-row" rowClassName={(r) => (r.id === focus ? "bg-primary-soft" : undefined)} dense />
      </section>
      <TransferDialog open={open === "transfer"} onOpenChange={(o) => setOpen(o ? "transfer" : null)} />
      <TopUpDialog open={open === "topup"} onOpenChange={(o) => setOpen(o ? "topup" : null)} />
    </div>
  )
}

function TransferDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale, money } = useLocale()
  const actor = useActor()
  const today = useToday()
  const { can } = usePermissions()
  const run = useCommand(transferFunds)
  const action = useActionKey("ct")
  const data = useBalances()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [amountP, setAmountP] = React.useState<number | null>(null)
  const [feesP, setFeesP] = React.useState<number | null>(null)
  const [date, setDate] = React.useState("")
  const [ref, setRef] = React.useState("")
  const accounts = data?.accounts ?? []
  const fromOptions = accounts.filter((a) => can("cab.transfer.create", a.locationId ?? "loc_hq"))
  const fromId = from || fromOptions.find((a) => a.kind === "cash-till" && a.locationId === actor?.locationId)?.id || fromOptions[0]?.id || ""
  const fromAcc = accounts.find((a) => a.id === fromId)
  const toId =
    to ||
    accounts.find((a) => a.id !== fromId && a.accountTag === (fromAcc?.kind === "cash-till" ? "BANK_COLLECTION" : "BANK_MAIN"))?.id ||
    accounts.find((a) => a.id !== fromId && a.kind === "bank")?.id ||
    ""
  const balance = data?.balance.get(fromId) ?? 0
  const valid = !!fromId && !!toId && fromId !== toId && (amountP ?? 0) > 0 && (amountP ?? 0) + (feesP ?? 0) <= balance
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="transfer-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid) return
            const r = await run.run({ fromAccountId: fromId, toAccountId: toId, amountP: amountP ?? 0, feesP: feesP ?? 0, date: date || undefined, ref: ref || undefined, idempotencyKey: action.key })
            if (r) {
              action.renew()
              toast.success(t("cab.transfers.saved", { no: r.transferNo }))
              setAmountP(null)
              setFeesP(null)
              onOpenChange(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("cab.transfers.formTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("cab.transfers.from")} hint={t("cab.transfers.balance", { amount: money(balance) })}>
              <NativeSelect value={fromId} onChange={setFrom} testId="transfer-from" options={fromOptions.map((a) => ({ value: a.id, label: nameOf(a, locale) }))} />
            </Field>
            <Field label={t("cab.transfers.to")}>
              <NativeSelect value={toId} onChange={setTo} testId="transfer-to" options={accounts.filter((a) => a.id !== fromId).map((a) => ({ value: a.id, label: nameOf(a, locale) }))} />
            </Field>
            <Field label={t("cab.transfers.amount")}>
              <MoneyInput valueP={amountP} onChange={setAmountP} data-testid="transfer-amount" />
            </Field>
            <Field label={t("cab.transfers.fees")}>
              <MoneyInput valueP={feesP} onChange={setFeesP} />
            </Field>
            <Field label={t("cab.transfers.date")}>
              <DateField value={date || today} onChange={setDate} max={today || undefined} />
            </Field>
            <Field label={t("cab.transfers.ref")}>
              <TextInput value={ref} onChange={(e) => setRef(e.target.value)} lang="en" className="font-mono" />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || run.pending} data-testid="transfer-save">
              {t("cab.transfers.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Petty cash top-up (`cab.topUpPettyCash`), shared with the petty cash screen. */
export function TopUpDialog({ open, onOpenChange, pettyId }: { open: boolean; onOpenChange: (o: boolean) => void; pettyId?: Id }) {
  const { t, locale, money } = useLocale()
  const { can } = usePermissions()
  const run = useCommand(topUpPettyCash)
  const action = useActionKey("ct")
  const data = useBalances()
  const [petty, setPetty] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [amountP, setAmountP] = React.useState<number | null>(null)
  const accounts = data?.accounts ?? []
  const boxes = accounts.filter((a) => a.kind === "petty-cash" && can("cab.pettycash.create", a.locationId ?? null))
  const pettyAcc = boxes.find((a) => a.id === (petty || pettyId)) ?? boxes[0]
  const sources = accounts.filter((a) => (a.kind === "bank" || a.kind === "cash-till") && can("cab.pettycash.create", a.locationId ?? "loc_hq"))
  const fromId = from || sources.find((a) => a.kind === "bank")?.id || sources.find((a) => a.locationId === pettyAcc?.locationId)?.id || sources[0]?.id || ""
  const shortfall = pettyAcc ? (pettyAcc.imprestP ?? 0) - (data?.balance.get(pettyAcc.id) ?? 0) : 0
  const valid = !!pettyAcc && !!fromId && ((amountP ?? 0) > 0 || shortfall > 0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="topup-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid || !pettyAcc) return
            const r = await run.run({ pettyAccountId: pettyAcc.id, fromAccountId: fromId, amountP: amountP ?? undefined, idempotencyKey: action.key })
            if (r) {
              action.renew()
              toast.success(t("cab.transfers.saved", { no: r.transferNo }))
              setAmountP(null)
              onOpenChange(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("cab.transfers.topUpTitle")}</DialogTitle>
          </DialogHeader>
          <Field label={t("cab.transfers.petty")} hint={pettyAcc ? `${t("cab.petty.balance")} ${money(data?.balance.get(pettyAcc.id) ?? 0)} · ${t("cab.petty.imprest")} ${money(pettyAcc.imprestP ?? 0)}` : undefined}>
            <NativeSelect value={pettyAcc?.id ?? ""} onChange={setPetty} options={boxes.map((a) => ({ value: a.id, label: nameOf(a, locale) }))} />
          </Field>
          <Field label={t("cab.transfers.from")} hint={t("cab.transfers.balance", { amount: money(data?.balance.get(fromId) ?? 0) })}>
            <NativeSelect value={fromId} onChange={setFrom} options={sources.map((a) => ({ value: a.id, label: nameOf(a, locale) }))} />
          </Field>
          <Field label={t("cab.transfers.amount")} hint={t("cab.transfers.topUpHint")}>
            <MoneyInput valueP={amountP} onChange={setAmountP} placeholder={money(Math.max(0, shortfall))} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || run.pending} data-testid="topup-save">
              {t("cab.transfers.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
