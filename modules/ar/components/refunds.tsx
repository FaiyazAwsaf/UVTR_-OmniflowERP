"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { DocLink } from "@/components/shared/doc-link"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type { CustomerRefundRow, Id, PartyRow, ReceiptMethod } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useActor } from "@/core/session/actor"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { CsvButton, Field, ListTable, NativeSelect, Pills, useActionKey, type Column } from "@/modules/par/components/kit"

import { recordRefund } from "../commands"
import { accountFitsMethod } from "../ledger"
import { customerAdvances } from "../queries"
import { defaultAccount } from "./receipt-form"

type Row = { refund: CustomerRefundRow; party: PartyRow | undefined }
const METHODS = ["cash", "bkash", "nagad", "bank-transfer"] as const
const SOURCES = ["deposit", "credit-note", "overpayment"] as const

/** /ar/refunds: refunds of customer advances (R28) and the customers holding one (plan §9). */
export function Refunds() {
  const db = useDb()
  const params = useSearchParams()
  const focus = params.get("id")
  const { t, tk, locale, dmy, num } = useLocale()
  const { can } = usePermissions()
  const [open, setOpen] = React.useState(false)
  const [preset, setPreset] = React.useState<Id | null>(null)

  const data = useLiveQuery(async () => {
    const [refunds, advances] = await Promise.all([db.customerRefunds.toArray(), customerAdvances(db)])
    const ids = new Set([...refunds.map((r) => r.partyId), ...advances.keys()])
    const parties = new Map((await db.parties.bulkGet([...ids])).filter(Boolean).map((p) => [p!.id, p!]))
    return {
      rows: refunds.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.refundNo.localeCompare(a.refundNo))).map((refund) => ({ refund, party: parties.get(refund.partyId) })),
      holders: [...advances.entries()].filter(([, v]) => v > 0).map(([id, v]) => ({ party: parties.get(id), advanceP: v, id })).sort((a, b) => b.advanceP - a.advanceP),
    }
  }, [db])

  const columns: Column<Row>[] = [
    { key: "date", header: t("ar.refunds.colDate"), sortValue: (r) => r.refund.date, cell: (r) => <span className="nums">{dmy(r.refund.date)}</span> },
    { key: "no", header: t("ar.refunds.colNo"), cell: (r) => <DocLink docType="customerRefunds" docId={r.refund.id} docNo={r.refund.refundNo} showApp={false} /> },
    { key: "party", header: t("ar.refunds.colParty"), hide: "sm", cell: (r) => (r.party ? <Link href={`/par/${r.party.id}`} className="text-link hover:underline">{nameOf(r.party, locale)}</Link> : "-") },
    { key: "method", header: t("ar.refunds.colMethod"), hide: "md", cell: (r) => tk(`ar.method.${r.refund.method}`) },
    { key: "source", header: t("ar.refunds.colSource"), hide: "lg", cell: (r) => tk(`ar.refunds.sources.${r.refund.source}`) },
    { key: "reason", header: t("ar.refunds.colReason"), hide: "lg", cell: (r) => <span className="line-clamp-1 text-muted-foreground">{r.refund.reason}</span> },
    { key: "amount", header: t("ar.refunds.colAmount"), align: "right", sortValue: (r) => r.refund.amountP, cell: (r) => <MoneyText poisha={r.refund.amountP} className="font-mono" /> },
    { key: "journal", header: "", hide: "md", cell: (r) => <DocLink docType="journals" docId={r.refund.journalId} docNo={tk("ar.receipts.journal")} showApp={false} className="text-xs" /> },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="refunds">
      <PageHeader
        title={t("ar.pages.refunds")}
        subtitle={t("ar.refunds.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="ar.export"
              fileName="refunds"
              rows={(data?.rows ?? []).map(({ refund: r, party }) => ({ date: r.date, refundNo: r.refundNo, party: party?.nameEn ?? "", method: r.method, amountP: r.amountP, reason: r.reason }))}
              columns={[
                { key: "date", label: t("ar.refunds.colDate") },
                { key: "refundNo", label: t("ar.refunds.colNo") },
                { key: "party", label: t("ar.refunds.colParty") },
                { key: "method", label: t("ar.refunds.colMethod") },
                { key: "amountP", label: t("ar.refunds.colAmount") },
                { key: "reason", label: t("ar.refunds.colReason") },
              ]}
            />
            {can("ar.refund.create") ? (
              <Button
                data-testid="refund-new"
                onClick={() => {
                  setPreset(null)
                  setOpen(true)
                }}
              >
                <Plus />
                {t("ar.refunds.new")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="surface-card flex min-w-0 flex-col gap-3 p-4 md:p-5">
          <span className="text-xs text-muted-foreground">{t("ar.refunds.count", { count: num(data?.rows.length ?? 0) })}</span>
          <ListTable
            rows={data?.rows}
            columns={columns}
            rowKey={(r) => r.refund.id}
            rowTestId="refund-row"
            rowClassName={(r) => (r.refund.id === focus ? "bg-primary-soft" : undefined)}
            empty={<EmptyState icon={Undo2} title={t("common.noResults")} size="sm" />}
          />
        </section>
        <SectionCard title={t("ar.refunds.withAdvance")} size="sm">
          {data?.holders.length ? (
            <ul className="flex max-h-96 flex-col overflow-y-auto">
              {data.holders.slice(0, 30).map((h) => (
                <li key={h.id} className="flex items-center gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0">
                  <Link href={`/par/${h.id}`} className="min-w-0 flex-1 truncate text-link hover:underline">
                    {nameOf(h.party, locale)}
                  </Link>
                  <MoneyText poisha={h.advanceP} className="font-mono" />
                  {can("ar.refund.create") ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setPreset(h.id)
                        setOpen(true)
                      }}
                    >
                      <Undo2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Undo2} title={t("ar.refunds.noAdvance")} size="sm" />
          )}
        </SectionCard>
      </div>
      <RefundDialog open={open} onOpenChange={setOpen} presetPartyId={preset} advances={new Map((data?.holders ?? []).map((h) => [h.id, h.advanceP]))} holders={data?.holders ?? []} />
    </div>
  )
}

function RefundDialog({
  open,
  onOpenChange,
  presetPartyId,
  advances,
  holders,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetPartyId: Id | null
  advances: Map<Id, number>
  holders: { id: Id; party: PartyRow | undefined; advanceP: number }[]
}) {
  const db = useDb()
  const actor = useActor()
  const { t, tk, locale } = useLocale()
  const refund = useCommand(recordRefund)
  const action = useActionKey("rf")
  const [partyId, setPartyId] = React.useState<string>("")
  const [method, setMethod] = React.useState<(typeof METHODS)[number]>("cash")
  const [accountId, setAccountId] = React.useState("")
  const [amountP, setAmountP] = React.useState<number | null>(null)
  const [source, setSource] = React.useState<(typeof SOURCES)[number]>("deposit")
  const [reason, setReason] = React.useState("")
  const [seen, setSeen] = React.useState<string | null>(null)
  const openKey = open ? (presetPartyId ?? "any") : null
  if (openKey !== seen) {
    setSeen(openKey)
    if (open) {
      setPartyId(presetPartyId ?? "")
      setAmountP(presetPartyId ? (advances.get(presetPartyId) ?? null) : null)
      setReason("")
    }
  }
  const accounts = useLiveQuery(() => db.cashBankAccounts.toArray(), [db]) ?? []
  const fits = accounts.filter((a) => a.active && accountFitsMethod(a, method as ReceiptMethod))
  const account = fits.find((a) => a.id === accountId) ?? defaultAccount(accounts, method as ReceiptMethod, actor?.locationId)
  const advance = partyId ? (advances.get(partyId) ?? 0) : 0
  const valid = !!partyId && !!account && (amountP ?? 0) > 0 && (amountP ?? 0) <= advance && reason.trim().length >= 3

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="refund-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid || !account) return
            const r = await refund.run({
              partyId,
              locationId: actor?.locationId ?? undefined,
              method,
              cashBankAccountId: account.id,
              amountP: amountP ?? 0,
              source,
              reason: reason.trim(),
              idempotencyKey: action.key,
            })
            if (r) {
              action.renew()
              toast.success(t("ar.refunds.saved", { no: r.refundNo }))
              onOpenChange(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("ar.refunds.formTitle")}</DialogTitle>
          </DialogHeader>
          <Field label={t("ar.refunds.customer")}>
            <NativeSelect
              value={partyId}
              onChange={(v) => {
                setPartyId(v)
                setAmountP(advances.get(v) ?? null)
              }}
              placeholder={t("ar.refunds.customer")}
              testId="refund-party"
              options={holders.map((h) => ({ value: h.id, label: `${nameOf(h.party, locale)} (${h.party?.code ?? ""})` }))}
            />
          </Field>
          {partyId ? (
            <div className="flex items-center justify-between rounded-md bg-surface-raised/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("ar.refunds.advance")}</span>
              <MoneyText poisha={advance} className="font-mono font-semibold" />
            </div>
          ) : null}
          <Field group label={t("ar.refunds.method")}>
            <Pills
              value={method}
              onChange={(m) => {
                setMethod(m as (typeof METHODS)[number])
                setAccountId("")
              }}
              options={METHODS.map((m) => ({ value: m, label: tk(`ar.method.${m}`) }))}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("ar.refunds.account")}>
              <NativeSelect value={account?.id ?? ""} onChange={setAccountId} options={fits.map((a) => ({ value: a.id, label: nameOf(a, locale) }))} />
            </Field>
            <Field label={t("ar.refunds.amount")}>
              <MoneyInput valueP={amountP} onChange={setAmountP} aria-invalid={(amountP ?? 0) > advance || undefined} data-testid="refund-amount" />
            </Field>
          </div>
          <Field group label={t("ar.refunds.source")}>
            <Pills value={source} onChange={(s) => setSource(s as (typeof SOURCES)[number])} options={SOURCES.map((s) => ({ value: s, label: tk(`ar.refunds.sources.${s}`) }))} />
          </Field>
          <Field label={t("ar.refunds.reason")}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} data-testid="refund-reason" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || refund.pending} data-testid="refund-save">
              {t("ar.refunds.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
