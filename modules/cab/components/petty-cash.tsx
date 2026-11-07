"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { PiggyBank, Plus, ShieldAlert, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { ApprovalChip } from "@/components/shared/approval-chip"
import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { locations } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { ExpenseTag, PettyCashVoucherRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useActor } from "@/core/session/actor"
import { useLimit, usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { Banner, CsvButton, Field, ListTable, NativeSelect, Stat, TextInput, useActionKey, useToday, type Column } from "@/modules/par/components/kit"

import { PETTY_TAGS, pettyCashVoucher } from "../commands"
import { canSeeAccount } from "../lib"
import { TopUpDialog, useBalances } from "./transfers"

/** /cab/petty-cash: imprest boxes, vouchers within the maker's limit or queued (plan §9). */
export function PettyCash() {
  const db = useDb()
  const params = useSearchParams()
  const focus = params.get("id")
  const { t, tk, locale, dmy, num } = useLocale()
  const { can } = usePermissions()
  const balances = useBalances()
  const [open, setOpen] = React.useState(false)
  const [topUp, setTopUp] = React.useState<string | null>(null)
  const data = useLiveQuery(async () => {
    const [all, transfers, accounts] = await Promise.all([db.pettyCashVouchers.toArray(), db.fundTransfers.toArray(), db.cashBankAccounts.toArray()])
    // Own-location roles see their own petty cash box and its vouchers only.
    const byId = new Map(accounts.map((a) => [a.id, a]))
    const vouchers = all.filter((v) => canSeeAccount(can, byId.get(v.cashBankAccountId)))
    return { vouchers: vouchers.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.voucherNo.localeCompare(a.voucherNo))), transfers }
  }, [db, can])

  const boxes = (balances?.accounts ?? []).filter((a) => a.kind === "petty-cash" && canSeeAccount(can, a))
  const lastTopUp = (id: string) => (data?.transfers ?? []).filter((x) => x.toAccountId === id).reduce((m, x) => (x.date > m ? x.date : m), "")

  const columns: Column<PettyCashVoucherRow>[] = [
    { key: "date", header: t("cab.petty.colDate"), cell: (r) => <span className="nums">{dmy(r.date)}</span> },
    {
      key: "no",
      header: t("cab.petty.colNo"),
      cell: (r) =>
        r.journalId ? (
          <DocLink docType="journals" docId={r.journalId} docNo={r.voucherNo} showApp={false} />
        ) : (
          <span lang="en" className="font-mono">
            {r.voucherNo}
          </span>
        ),
    },
    { key: "loc", header: t("cab.petty.colLocation"), hide: "lg", cell: (r) => locations.find((l) => l.id === r.locationId)?.name[locale] ?? "-" },
    { key: "expense", header: t("cab.petty.colExpense"), hide: "md", cell: (r) => <span className="text-muted-foreground">{tk(`ap.expenseTag.${r.expenseTag}`)}</span> },
    {
      key: "payee",
      header: t("cab.petty.colPayee"),
      hide: "sm",
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{r.payee}</span>
          <span className="truncate text-xs text-muted-foreground">{r.description}</span>
        </span>
      ),
    },
    { key: "amount", header: t("cab.petty.colAmount"), align: "right", cell: (r) => <MoneyText poisha={r.amountP} className="font-mono" /> },
    {
      key: "status",
      header: t("cab.petty.colStatus"),
      cell: (r) => (r.status === "pending-approval" && r.approvalId ? <ApprovalChip approvalId={r.approvalId} /> : <DocStatus status={r.status} />),
    },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="petty-cash">
      <PageHeader
        title={t("cab.pages.pettyCash")}
        subtitle={t("cab.petty.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="cab.export"
              fileName="petty-cash"
              rows={(data?.vouchers ?? []).map((v) => ({ date: v.date, no: v.voucherNo, expense: v.expenseTag, payee: v.payee, amountP: v.amountP, status: v.status }))}
              columns={[
                { key: "date", label: t("cab.petty.colDate") },
                { key: "no", label: t("cab.petty.colNo") },
                { key: "expense", label: t("cab.petty.colExpense") },
                { key: "payee", label: t("cab.petty.colPayee") },
                { key: "amountP", label: t("cab.petty.colAmount") },
                { key: "status", label: t("cab.petty.colStatus") },
              ]}
            />
            {can("cab.pettycash.create") ? (
              <Button onClick={() => setOpen(true)} data-testid="petty-new">
                <Plus />
                {t("cab.petty.new")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {boxes.map((box) => {
          const balance = balances?.balance.get(box.id) ?? 0
          const since = lastTopUp(box.id)
          const spent = (data?.vouchers ?? []).filter((v) => v.cashBankAccountId === box.id && v.status === "posted" && v.date >= since).reduce((s, v) => s + v.amountP, 0)
          const pending = (data?.vouchers ?? []).filter((v) => v.cashBankAccountId === box.id && v.status === "pending-approval").reduce((s, v) => s + v.amountP, 0)
          const pct = box.imprestP ? Math.max(0, Math.min(100, (balance / box.imprestP) * 100)) : 0
          return (
            <section key={box.id} className="surface-card flex flex-col gap-3 p-4" data-testid="petty-box" data-account={box.code}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="icon-well flex size-9 shrink-0 items-center justify-center text-link">
                    <PiggyBank className="size-4" />
                  </span>
                  <span className="truncate text-sm font-semibold">{nameOf(box, locale)}</span>
                </div>
                {can("cab.pettycash.create", box.locationId ?? null) ? (
                  <Button size="xs" variant="outline" onClick={() => setTopUp(box.id)}>
                    {t("cab.petty.topUp")}
                  </Button>
                ) : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
                <div className={cn("h-full rounded-full", pct < 30 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label={t("cab.petty.balance")} value={<MoneyText poisha={balance} />} />
                <Stat label={t("cab.petty.imprest")} value={<MoneyText poisha={box.imprestP ?? 0} />} />
                <Stat label={t("cab.petty.spent")} value={<MoneyText poisha={spent} />} />
                <Stat label={t("cab.petty.pending")} value={<MoneyText poisha={pending} />} tone={pending ? "warning" : undefined} />
              </div>
            </section>
          )
        })}
      </div>
      <section className="surface-card flex flex-col gap-3 p-4 md:p-5">
        <span className="text-xs text-muted-foreground">{t("cab.petty.count", { count: num(data?.vouchers.length ?? 0) })}</span>
        <ListTable rows={data?.vouchers} columns={columns} rowKey={(r) => r.id} rowTestId="petty-row" rowAttrs={(r) => ({ "voucher-no": r.voucherNo, status: r.status })} rowClassName={(r) => (r.id === focus ? "bg-primary-soft" : undefined)} dense />
      </section>
      <VoucherDialog open={open} onOpenChange={setOpen} />
      <TopUpDialog open={!!topUp} onOpenChange={(o) => !o && setTopUp(null)} pettyId={topUp ?? undefined} />
    </div>
  )
}

function VoucherDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, tk, locale, money } = useLocale()
  const actor = useActor()
  const today = useToday()
  const { can } = usePermissions()
  const limit = useLimit("petty-cash")
  const run = useCommand(pettyCashVoucher)
  const action = useActionKey("pcv")
  const balances = useBalances()
  const boxes = (balances?.accounts ?? []).filter((a) => a.kind === "petty-cash" && can("cab.pettycash.create", a.locationId ?? null))
  const [boxId, setBoxId] = React.useState("")
  const [tag, setTag] = React.useState<ExpenseTag>("CONVEYANCE")
  const [amountP, setAmountP] = React.useState<number | null>(null)
  const [payee, setPayee] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [date, setDate] = React.useState("")
  const box = boxes.find((b) => b.id === boxId) ?? boxes.find((b) => b.locationId === actor?.locationId) ?? boxes[0]
  const over = (amountP ?? 0) > limit
  const valid = !!box && (amountP ?? 0) > 0 && payee.trim().length >= 2 && description.trim().length >= 2
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="petty-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid || !box) return
            const r = await run.run({ cashBankAccountId: box.id, expenseTag: tag, amountP: amountP ?? 0, payee: payee.trim(), description: description.trim(), date: date || undefined, idempotencyKey: action.key })
            if (r) {
              action.renew()
              toast.success(r.status === "posted" ? t("cab.petty.saved", { no: r.voucherNo }) : t("cab.petty.queued", { no: r.voucherNo }))
              setAmountP(null)
              setPayee("")
              setDescription("")
              onOpenChange(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("cab.petty.formTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("cab.petty.box")} hint={box ? `${t("cab.petty.balance")} ${money(balances?.balance.get(box.id) ?? 0)}` : undefined}>
              <NativeSelect value={box?.id ?? ""} onChange={setBoxId} testId="petty-box-select" options={boxes.map((b) => ({ value: b.id, label: nameOf(b, locale) }))} />
            </Field>
            <Field label={t("cab.petty.expense")}>
              <NativeSelect value={tag} onChange={(v) => setTag(v as ExpenseTag)} options={PETTY_TAGS.map((x) => ({ value: x, label: tk(`ap.expenseTag.${x}`) }))} />
            </Field>
            <Field label={t("cab.petty.amount")}>
              <MoneyInput valueP={amountP} onChange={setAmountP} data-testid="petty-amount" />
            </Field>
            <Field label={t("cab.petty.date")}>
              <DateField value={date || today} onChange={setDate} max={today || undefined} />
            </Field>
            <Field label={t("cab.petty.payee")}>
              <TextInput value={payee} onChange={(e) => setPayee(e.target.value)} testId="petty-payee" />
            </Field>
            <Field label={t("cab.petty.description")}>
              <TextInput value={description} onChange={(e) => setDescription(e.target.value)} testId="petty-description" />
            </Field>
          </div>
          {(amountP ?? 0) > 0 ? (
            <Banner tone={over ? "warning" : "success"} icon={over ? <ShieldAlert /> : <ShieldCheck />}>
              {over ? t("cab.petty.limitOver", { limit: money(Number.isFinite(limit) ? limit : 0) }) : t("cab.petty.limitOk")}
            </Banner>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || run.pending} data-testid="petty-save">
              {t("cab.petty.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
