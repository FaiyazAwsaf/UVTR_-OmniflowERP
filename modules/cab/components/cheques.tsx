"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarDays, MessageSquare } from "lucide-react"
import { toast } from "sonner"

import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { ChequeRow, PartyRow, ReceiptRow, SalesInvoiceRow, SmsRow, VendorPaymentRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { invoiceAvailableP, invoiceOpenP } from "@/modules/ar/lib"
import { CsvButton, ListTable, NativeSelect, Pills, SearchBox, Stat, useToday, type Column } from "@/modules/par/components/kit"
import { ReasonDialog } from "@/modules/par/components/reason-dialog"

import { updateCheque } from "../commands"
import { canSeeAccount } from "../lib"

type Row = { cheque: ChequeRow; party: PartyRow | undefined; receipt: ReceiptRow | undefined; payment: VendorPaymentRow | undefined }

/** /cab/cheques: the cheque register with the PDC calendar; deposit, clear, bounce (plan §9). */
export function Cheques() {
  const db = useDb()
  const params = useSearchParams()
  const focus = params.get("id")
  const today = useToday()
  const { t, tk, locale, dmy, num, money } = useLocale()
  const { can } = usePermissions()
  const update = useCommand(updateCheque)
  const [direction, setDirection] = React.useState<"received" | "issued">("received")
  const [status, setStatus] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [bouncing, setBouncing] = React.useState<ChequeRow | null>(null)

  const data = useLiveQuery(async () => {
    // Cheques sit on Head Office's bank accounts: own-location roles do not list them.
    const accounts = new Map((await db.cashBankAccounts.toArray()).map((a) => [a.id, a]))
    const cheques = (await db.cheques.toArray()).filter((c) => canSeeAccount(can, accounts.get(c.cashBankAccountId)))
    const [parties, receipts, payments] = await Promise.all([
      db.parties.bulkGet([...new Set(cheques.map((c) => c.partyId))]),
      db.receipts.bulkGet(cheques.flatMap((c) => (c.receiptId ? [c.receiptId] : []))),
      db.vendorPayments.bulkGet(cheques.flatMap((c) => (c.paymentId ? [c.paymentId] : []))),
    ])
    const pm = new Map(parties.filter(Boolean).map((p) => [p!.id, p!]))
    const rm = new Map(receipts.filter(Boolean).map((r) => [r!.id, r!]))
    const vm = new Map(payments.filter(Boolean).map((p) => [p!.id, p!]))
    return cheques
      .sort((a, b) => (a.chequeDate < b.chequeDate ? 1 : a.chequeDate > b.chequeDate ? -1 : b.chequeNo.localeCompare(a.chequeNo)))
      .map((cheque) => ({ cheque, party: pm.get(cheque.partyId), receipt: cheque.receiptId ? rm.get(cheque.receiptId) : undefined, payment: cheque.paymentId ? vm.get(cheque.paymentId) : undefined }))
  }, [db, can])

  const focused = data?.find((r) => r.cheque.id === focus)
  const dir = focused && focused.cheque.direction !== direction && !query && !status ? focused.cheque.direction : direction
  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (data ?? []).filter(
      (r) => r.cheque.direction === dir && (!status || r.cheque.status === status) && (!q || r.cheque.chequeNo.includes(q) || (r.party?.nameEn.toLowerCase().includes(q) ?? false))
    )
    // The cheque the address names first (a notice, a launcher), then open cheques (in hand, deposited, issued, presented), then the rest.
    const open = (s: string) => (s === "in-hand" || s === "deposited" || s === "issued" || s === "presented" ? 0 : 1)
    const rank = (r: Row) => (r.cheque.id === focus ? -1 : open(r.cheque.status))
    return list.sort((a, b) => rank(a) - rank(b))
  }, [data, dir, status, query, focus])

  const act = async (c: ChequeRow, action: "deposit" | "clear" | "bounce" | "present", reason = "") => {
    const r = await update.run({ chequeId: c.id, action, expectedStatus: c.status, reason })
    if (r) {
      const key = action === "deposit" ? "deposited" : action === "clear" ? "cleared" : action === "bounce" ? "bounced" : "presented"
      toast.success(tk(`cab.cheques.${key}`, { no: c.chequeNo }))
    }
  }

  const calendar = React.useMemo(() => {
    if (!today) return []
    const inHand = (data ?? []).filter((r) => r.cheque.direction === "received" && r.cheque.status === "in-hand")
    return Array.from({ length: 14 }, (_, i) => {
      const day = addDaysISO(today, i)
      const list = inHand.filter((r) => (i === 0 ? r.cheque.chequeDate <= day : r.cheque.chequeDate === day))
      return { day, count: list.length, amountP: list.reduce((s, r) => s + r.cheque.amountP, 0) }
    })
  }, [data, today])

  const canUpdate = can("cab.cheque.update")
  const columns: Column<Row>[] = [
    {
      key: "no",
      header: t("cab.cheques.colNo"),
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span lang="en" className="font-mono font-medium">
            {r.cheque.chequeNo}
          </span>
          {r.cheque.isPdc ? (
            <StatusPill tone="info" className="h-5 px-1.5 text-[0.625rem]">
              {t("cab.cheques.pdc")}
            </StatusPill>
          ) : null}
        </span>
      ),
    },
    {
      key: "party",
      header: t("cab.cheques.colParty"),
      hide: "sm",
      cell: (r) => (
        <Link href={`/par/${r.cheque.partyId}`} className="truncate text-link hover:underline">
          {nameOf(r.party, locale)}
        </Link>
      ),
    },
    { key: "bank", header: t("cab.cheques.colBank"), hide: "lg", cell: (r) => <span className="text-muted-foreground">{r.cheque.bankName}</span> },
    { key: "date", header: t("cab.cheques.colDate"), sortValue: (r) => r.cheque.chequeDate, cell: (r) => <span className={cn("nums", r.cheque.status === "in-hand" && today && r.cheque.chequeDate <= today && "font-medium text-link")}>{dmy(r.cheque.chequeDate)}</span> },
    {
      key: "doc",
      header: t("cab.cheques.colDoc"),
      hide: "lg",
      cell: (r) =>
        r.receipt ? (
          <DocLink docType="receipts" docId={r.receipt.id} docNo={r.receipt.receiptNo} />
        ) : r.payment ? (
          <DocLink docType="vendorPayments" docId={r.payment.id} docNo={r.payment.paymentNo} />
        ) : null,
    },
    { key: "amount", header: t("cab.cheques.colAmount"), align: "right", sortValue: (r) => r.cheque.amountP, cell: (r) => <MoneyText poisha={r.cheque.amountP} className="font-mono" /> },
    { key: "status", header: t("cab.cheques.colStatus"), cell: (r) => <DocStatus status={r.cheque.status} /> },
    {
      key: "actions",
      header: "",
      cell: ({ cheque: c }) => {
        if (!canUpdate) return null
        const due = !today || c.chequeDate <= today
        const btn = (label: string, testId: string, onClick: () => void, opts: { disabled?: boolean; destructive?: boolean } = {}) => (
          <Button
            key={testId}
            size="xs"
            variant={opts.destructive ? "destructive-outline" : "outline"}
            data-testid={testId}
            disabled={opts.disabled || update.pending}
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
          >
            {label}
          </Button>
        )
        const out: React.ReactNode[] = []
        if (c.direction === "received") {
          if (c.status === "in-hand") {
            out.push(due ? btn(t("cab.cheques.deposit"), "cheque-deposit", () => act(c, "deposit")) : <span key="due" className="text-xs text-muted-foreground">{t("cab.cheques.notDue", { date: dmy(c.chequeDate) })}</span>)
            out.push(btn(t("cab.cheques.bounce"), "cheque-bounce", () => setBouncing(c), { destructive: true }))
          } else if (c.status === "deposited") {
            out.push(btn(t("cab.cheques.clear"), "cheque-clear", () => act(c, "clear")))
            out.push(btn(t("cab.cheques.bounce"), "cheque-bounce", () => setBouncing(c), { destructive: true }))
          }
        } else if (c.status === "issued") {
          out.push(btn(t("cab.cheques.present"), "cheque-present", () => act(c, "present")))
        } else if (c.status === "presented") {
          out.push(btn(t("cab.cheques.clear"), "cheque-clear", () => act(c, "clear")))
        }
        return <div className="flex flex-wrap justify-end gap-1">{out}</div>
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="cheques">
      <PageHeader
        title={t("cab.pages.cheques")}
        subtitle={t("cab.cheques.subtitle")}
        actions={
          <CsvButton
            exportKey="cab.export"
            fileName="cheques"
            rows={rows.map((r) => ({ direction: r.cheque.direction, chequeNo: r.cheque.chequeNo, party: r.party?.nameEn ?? "", bank: r.cheque.bankName, chequeDate: r.cheque.chequeDate, amountP: r.cheque.amountP, status: r.cheque.status }))}
            columns={[
              { key: "chequeNo", label: t("cab.cheques.colNo") },
              { key: "party", label: t("cab.cheques.colParty") },
              { key: "bank", label: t("cab.cheques.colBank") },
              { key: "chequeDate", label: t("cab.cheques.colDate") },
              { key: "amountP", label: t("cab.cheques.colAmount") },
              { key: "status", label: t("cab.cheques.colStatus") },
            ]}
          />
        }
      />
      <SectionCard title={t("cab.cheques.calendar")} subtitle={t("cab.cheques.calendarHint")} size="sm" icon={CalendarDays}>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" data-testid="pdc-calendar">
          {calendar.map((d) => (
            <div key={d.day} className={cn("flex min-w-0 flex-col gap-0.5 rounded-md p-2 text-xs", d.count ? "bg-primary-soft" : "bg-surface-raised/50")}>
              <span className="nums text-muted-foreground">{dmy(d.day).slice(0, 5)}</span>
              {d.count ? (
                <>
                  <span className="font-semibold">{num(d.count)}</span>
                  <span className="truncate font-mono text-[0.6875rem]">{money(d.amountP)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
      {focused ? <ChequeDetail row={focused} /> : null}
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pills
            value={dir}
            onChange={(v) => setDirection(v as "received" | "issued")}
            testId="cheque-direction"
            options={[
              { value: "received", label: t("cab.cheques.received") },
              { value: "issued", label: t("cab.cheques.issued") },
            ]}
          />
          <SearchBox value={query} onChange={setQuery} />
          <NativeSelect
            value={status}
            onChange={setStatus}
            placeholder={t("cab.cheques.statusAll")}
            className="w-40"
            ariaLabel={t("cab.cheques.colStatus")}
            options={(dir === "received" ? ["in-hand", "deposited", "cleared", "bounced"] : ["issued", "presented", "cleared"]).map((s) => ({ value: s, label: tk(`shared.status.${s}`) }))}
          />
          <span className="ml-auto text-xs text-muted-foreground">{t("cab.cheques.count", { count: num(rows.length) })}</span>
        </div>
        <ListTable
          rows={data ? rows : undefined}
          columns={columns}
          rowKey={(r) => r.cheque.id}
          rowTestId="cheque-row"
          rowAttrs={(r) => ({ "cheque-no": r.cheque.chequeNo, status: r.cheque.status })}
          rowClassName={(r) => (r.cheque.id === focus ? "bg-primary-soft" : undefined)}
        />
      </section>
      <ReasonDialog
        open={!!bouncing}
        onOpenChange={(o) => !o && setBouncing(null)}
        title={t("cab.cheques.bounceTitle", { no: bouncing?.chequeNo ?? "" })}
        body={t("cab.cheques.bounceBody")}
        confirmLabel={t("cab.cheques.bounce")}
        requireReason={false}
        destructive
        pending={update.pending}
        testId="bounce-dialog"
        onConfirm={async (reason) => {
          if (!bouncing) return
          await act(bouncing, "bounce", reason)
          setBouncing(null)
        }}
      />
    </div>
  )
}

/**
 * The cheque the address names (`?id=`): who gave it, what its receipt
 * reserves on which invoices (outstanding again after a bounce), and the
 * customer's notice once it bounced (numbers, dates and amounts only).
 */
function ChequeDetail({ row }: { row: Row }) {
  const db = useDb()
  const { t, locale, dmy } = useLocale()
  const { cheque, receipt, party } = row
  const detail = useLiveQuery(async () => {
    const invoiceIds = receipt?.allocations.map((a) => a.invoiceId) ?? []
    const invoices = (await db.salesInvoices.bulkGet(invoiceIds)).filter(Boolean) as SalesInvoiceRow[]
    let notice: SmsRow | undefined
    if (cheque.status === "bounced") {
      const sms = await db.sms.where("partyId").equals(cheque.partyId).toArray()
      notice = sms.filter((m) => m.templateId === "cheque-bounced" && m.text.includes(cheque.chequeNo)).sort((a, b) => b.queuedAt - a.queuedAt)[0]
    }
    return { invoices: new Map(invoices.map((i) => [i.id, i])), notice }
  }, [db, cheque.id, cheque.status, cheque.version, receipt?.id, receipt?.version])

  return (
    <SectionCard
      title={t("cab.cheques.detailTitle", { no: cheque.chequeNo })}
      subtitle={`${nameOf(party, locale)} · ${cheque.bankName}`}
      size="sm"
      action={<DocStatus status={cheque.status} />}
    >
      <div className="flex flex-col gap-3" data-testid="cheque-detail" data-cheque-no={cheque.chequeNo} data-status={cheque.status}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("cab.cheques.colAmount")} value={<MoneyText poisha={cheque.amountP} />} />
          <Stat label={t("cab.cheques.colDate")} value={dmy(cheque.chequeDate)} />
          <Stat label={t("cab.cheques.receivedOn")} value={cheque.receivedOn ? dmy(cheque.receivedOn) : "-"} />
          <Stat label={t("cab.cheques.colDoc")} value={receipt ? <DocLink docType="receipts" docId={receipt.id} docNo={receipt.receiptNo} showApp={false} /> : "-"} />
        </div>
        {receipt?.allocations.length ? (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="[&>th]:h-8 [&>th]:bg-surface-raised [&>th]:px-2 [&>th]:font-medium [&>th]:whitespace-nowrap">
                  <th className="rounded-l-md text-left">{t("cab.cheques.colInvoice")}</th>
                  <th className="text-right">{t("cab.cheques.colAllocated")}</th>
                  <th className="text-right">{t("cab.cheques.colOutstanding")}</th>
                  <th className="hidden text-right sm:table-cell">{t("cab.cheques.colReserved")}</th>
                  <th className="rounded-r-md text-right">{t("cab.cheques.colAvailable")}</th>
                </tr>
              </thead>
              <tbody>
                {receipt.allocations.map((a) => {
                  const inv = detail?.invoices.get(a.invoiceId)
                  return (
                    <tr key={a.invoiceId} data-testid="cheque-invoice" data-invoice-no={inv?.invoiceNo} data-available={inv ? invoiceAvailableP(inv) : undefined} className="[&>td]:border-b [&>td]:border-hairline [&>td]:px-2 [&>td]:py-1.5">
                      <td>{inv ? <DocLink docType="salesInvoices" docId={inv.id} docNo={inv.invoiceNo} /> : null}</td>
                      <td className="text-right">
                        <MoneyText poisha={a.amountP} className="font-mono" />
                      </td>
                      <td className="text-right">{inv ? <MoneyText poisha={invoiceOpenP(inv)} className="font-mono font-semibold" /> : null}</td>
                      <td className="hidden text-right sm:table-cell">{inv ? <MoneyText poisha={inv.reservedP} className="font-mono text-muted-foreground" /> : null}</td>
                      <td className="text-right">{inv ? <MoneyText poisha={invoiceAvailableP(inv)} className="font-mono" /> : null}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {cheque.status === "bounced" ? (
          <div className="flex flex-col gap-1.5 rounded-lg bg-surface-raised/60 p-3" data-testid="cheque-notice">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MessageSquare className="size-3.5" />
              <span>{detail?.notice ? t("cab.cheques.noticeSent", { to: detail.notice.to }) : t("cab.cheques.noticeNone")}</span>
              <SimulatedBadge className="ml-auto" />
            </div>
            {detail?.notice ? (
              <p lang={detail.notice.lang} className="text-sm">
                {detail.notice.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}
