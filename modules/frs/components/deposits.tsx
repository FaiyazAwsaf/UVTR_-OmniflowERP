"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Landmark } from "lucide-react"
import { toast } from "sonner"

import { DocLink } from "@/components/shared/doc-link"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDb } from "@/core/db/DbProvider"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { payTax } from "../commands"
import { loadVatMonth } from "../queries"
import { depositDue, dueDateOf, type TaxKind } from "../vat"

const freshKey = () => `frs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Tax deposits for a month (accounting_rules.md §4.1): net VAT (after the
 * return), VDS and AIT withheld from vendors; what is due, deposited and
 * left, the treasury challans, and "Deposit" (frs.payTax, R27b, simulated
 * treasury challan). Shared by the VAT and withholding screens.
 */
export function DepositsCard({ month, monthLabel, kinds }: { month: string; monthLabel: string; kinds: TaxKind[] }) {
  const db = useDb()
  const { t, tk, dmy, money } = useLocale()
  const canPay = useCan("frs.tax.pay")
  const [paying, setPaying] = React.useState<{ kind: TaxKind; amountP: number } | null>(null)
  const data = useLiveQuery(async () => {
    if (!month) return null
    const [figures, vatReturn, deposits] = await Promise.all([
      loadVatMonth(db, month),
      db.vatReturns.where("month").equals(month).first(),
      db.taxDeposits.where("forMonth").equals(month).toArray(),
    ])
    return { figures, vatReturn, deposits }
  }, [db, month])
  const due = dueDateOf(month)

  return (
    <SectionCard
      title={t("frs.deposits.title", { month: monthLabel })}
      subtitle={t("frs.deposits.hint")}
      icon={Landmark}
      action={<SimulatedBadge />}
      size="sm"
    >
      <ul className="flex flex-col @container" data-testid="tax-deposits">
        {kinds.map((kind) => {
          const d = data ? depositDue(kind, month, data.figures, data.vatReturn, data.deposits) : { dueP: 0, paidP: 0, leftP: 0 }
          const deposits = (data?.deposits ?? []).filter((x) => x.kind === kind)
          const blocked = kind === "vat" && !data?.vatReturn
          return (
            <li key={kind} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-hairline py-2.5 last:border-b-0" data-testid="tax-deposit-row" data-kind={kind}>
              <span className="w-44 min-w-0 font-medium">{tk(`frs.deposits.kinds.${kind}`)}</span>
              <span className="flex flex-col text-xs">
                <span className="text-muted-foreground">{t("frs.deposits.due")}</span>
                <MoneyText poisha={d.dueP} className="font-mono" />
              </span>
              <span className="flex flex-col text-xs">
                <span className="text-muted-foreground">{t("frs.deposits.paid")}</span>
                <MoneyText poisha={d.paidP} className="font-mono" />
              </span>
              <span className="min-w-0 flex-1 text-xs">
                {deposits.map((x) => (
                  <span key={x.id} className="mr-3 inline-flex items-center gap-1.5">
                    <DocLink docType="taxDeposits" docId={x.id} docNo={x.depositNo} showApp={false} />
                    <span lang="en" className="font-mono text-muted-foreground">
                      {x.challanRef}
                    </span>
                    <span className="text-muted-foreground">{dmy(x.date)}</span>
                  </span>
                ))}
              </span>
              {d.leftP > 0 ? (
                <Button
                  size="sm"
                  disabled={!canPay || blocked}
                  onClick={() => setPaying({ kind, amountP: d.leftP })}
                  data-testid="tax-pay"
                  data-kind={kind}
                  title={blocked ? t("frs.deposits.needReturn") : undefined}
                >
                  {t("frs.deposits.pay")} <MoneyText poisha={d.leftP} className="font-mono" />
                </Button>
              ) : d.dueP > 0 ? (
                <StatusText tone="success" dot>
                  {t("frs.home.paid")}
                </StatusText>
              ) : (
                <StatusText tone="muted" dot>
                  {blocked ? t("frs.deposits.needReturn") : t("frs.home.notDue")}
                </StatusText>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t("frs.vat.monthDue", { month: monthLabel, date: dmy(due) })}</p>
      <PayDialog
        month={month}
        monthLabel={monthLabel}
        paying={paying}
        onClose={() => setPaying(null)}
        label={paying ? tk(`frs.deposits.kinds.${paying.kind}`) : ""}
        amount={paying ? money(paying.amountP) : ""}
      />
    </SectionCard>
  )
}

function PayDialog({
  month,
  monthLabel,
  paying,
  label,
  amount,
  onClose,
}: {
  month: string
  monthLabel: string
  paying: { kind: TaxKind; amountP: number } | null
  label: string
  amount: string
  onClose: () => void
}) {
  const db = useDb()
  const { t, money, locale } = useLocale()
  const command = useCommand(payTax)
  const banks = useLiveQuery(async () => (await db.cashBankAccounts.toArray()).filter((c) => c.kind === "bank" && c.active), [db])
  const [picked, setBankId] = React.useState("")
  const bankId = picked || banks?.find((b) => b.accountTag === "BANK_MAIN")?.id || banks?.[0]?.id || ""
  const bank = banks?.find((b) => b.id === bankId)
  const run = async () => {
    if (!paying) return
    const result = await command.run({ kind: paying.kind, forMonth: month, cashBankAccountId: bankId, idempotencyKey: freshKey() })
    onClose()
    if (result) toast.success(t("frs.deposits.paidToast", { no: result.depositNo, amount: money(result.amountP) }))
  }
  return (
    <Dialog open={!!paying} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="tax-pay-dialog">
        <DialogHeader>
          <DialogTitle>{t("frs.deposits.payTitle", { kind: label, month: monthLabel })}</DialogTitle>
          <DialogDescription>{t("frs.deposits.payBody", { amount, bank: bank ? nameOf(bank, locale) : "" })}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("frs.deposits.bank")}</span>
          <Select value={bankId} onValueChange={(v) => v && setBankId(v as string)}>
            <SelectTrigger className="w-full" data-testid="tax-pay-bank">
              <SelectValue>{() => (bank ? nameOf(bank, locale) : "-")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(banks ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {nameOf(b, locale)}
                  <span lang="en" className="ml-auto pl-3 font-mono text-xs text-muted-foreground">
                    {b.accountNoMasked ?? b.code}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <DialogFooter className="items-center">
          <SimulatedBadge className={cn("mr-auto")} />
          <Button variant="neutral" onClick={onClose}>
            {t("fa.common.cancel")}
          </Button>
          <Button onClick={run} disabled={command.pending} data-testid="tax-pay-confirm">
            <Landmark />
            {t("frs.deposits.pay")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
