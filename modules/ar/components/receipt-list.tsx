"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus, Printer } from "lucide-react"

import { amountInWords } from "@/components/shared/amount-in-words"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PrintLayout } from "@/components/shared/print-layout"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { locations } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { Id, PartyRow, ReceiptRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, useUserMap, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { CsvButton, LinkButton, ListTable, NativeSelect, SearchBox, type Column } from "@/modules/par/components/kit"
import { PrintDialog } from "@/modules/par/components/print-dialog"

type Row = { receipt: ReceiptRow; party: PartyRow | undefined }

const METHODS = ["cash", "card", "bkash", "nagad", "bank-transfer", "cheque"] as const

/** /ar/receipts: every receipt with its allocations; `?id=` opens one (plan §9). */
export function ReceiptList() {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const openId = params.get("id")
  const { t, tk, locale, dmy } = useLocale()
  const { can } = usePermissions()
  const [method, setMethod] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [query, setQuery] = React.useState("")

  const data = useLiveQuery(async () => {
    const receipts = await db.receipts.toArray()
    const parties = new Map((await db.parties.bulkGet([...new Set(receipts.map((r) => r.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return receipts
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at))
      .map((receipt) => ({ receipt, party: parties.get(receipt.partyId) }))
  }, [db])

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(({ receipt: r, party }) => {
      if (method && r.method !== method) return false
      if (status && r.status !== status) return false
      if (!q) return true
      return r.receiptNo.toLowerCase().includes(q) || (party?.nameEn.toLowerCase().includes(q) ?? false) || (party?.nameBn.includes(query.trim()) ?? false) || (r.ref ?? "").toLowerCase().includes(q)
    })
  }, [data, method, status, query])

  const columns: Column<Row>[] = [
    { key: "date", header: t("ar.receipts.colDate"), sortValue: (r) => r.receipt.date, cell: (r) => <span className="nums">{dmy(r.receipt.date)}</span> },
    {
      key: "no",
      header: t("ar.receipts.colNo"),
      sortValue: (r) => r.receipt.receiptNo,
      cell: (r) => (
        <span lang="en" className="font-mono text-link">
          {r.receipt.receiptNo}
        </span>
      ),
    },
    { key: "party", header: t("ar.receipts.colParty"), hide: "sm", sortValue: (r) => r.party?.nameEn ?? "", cell: (r) => <span className="truncate">{nameOf(r.party, locale)}</span> },
    { key: "method", header: t("ar.receipts.colMethod"), hide: "md", cell: (r) => <span className="text-muted-foreground">{tk(`ar.method.${r.receipt.method}`)}</span> },
    {
      key: "deductions",
      header: t("ar.receipts.colDeductions"),
      align: "right",
      hide: "lg",
      cell: (r) => (r.receipt.vdsDeductedP + r.receipt.aitDeductedP ? <MoneyText poisha={r.receipt.vdsDeductedP + r.receipt.aitDeductedP} className="font-mono" /> : <span className="text-muted-foreground">-</span>),
    },
    { key: "amount", header: t("ar.receipts.colAmount"), align: "right", sortValue: (r) => r.receipt.amountP, cell: (r) => <MoneyText poisha={r.receipt.amountP} className="font-mono" /> },
    { key: "status", header: t("ar.receipts.colStatus"), cell: (r) => <DocStatus status={r.receipt.status} /> },
  ]

  const open = (id: Id | null) => router.replace(id ? `/ar/receipts?id=${id}` : "/ar/receipts", { scroll: false })

  return (
    <div className="flex flex-col gap-4" data-testid="receipt-list">
      <PageHeader
        title={t("ar.pages.receipts")}
        subtitle={t("ar.receipts.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="ar.export"
              fileName="receipts"
              rows={rows.map(({ receipt: r, party }) => ({
                date: r.date,
                receiptNo: r.receiptNo,
                party: party?.nameEn ?? "",
                method: r.method,
                amountP: r.amountP,
                vdsP: r.vdsDeductedP,
                aitP: r.aitDeductedP,
                status: r.status,
              }))}
              columns={[
                { key: "date", label: t("ar.receipts.colDate") },
                { key: "receiptNo", label: t("ar.receipts.colNo") },
                { key: "party", label: t("ar.receipts.colParty") },
                { key: "method", label: t("ar.receipts.colMethod") },
                { key: "amountP", label: t("ar.receipts.colAmount") },
                { key: "vdsP", label: t("ar.receipts.vds") },
                { key: "aitP", label: t("ar.receipts.ait") },
                { key: "status", label: t("ar.receipts.colStatus") },
              ]}
            />
            {can("ar.receipt.create") ? (
              <LinkButton href="/ar/receipts/new" testId="receipt-new">
                <Plus />
                {t("ar.receipts.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder={t("ar.receipts.searchPlaceholder")} testId="receipt-search" />
          <NativeSelect value={method} onChange={setMethod} placeholder={t("ar.receipts.methodAll")} className="w-44" ariaLabel={t("ar.receipts.colMethod")} options={METHODS.map((m) => ({ value: m, label: tk(`ar.method.${m}`) }))} />
          <NativeSelect
            value={status}
            onChange={setStatus}
            placeholder={t("ar.receipts.statusAll")}
            className="w-40"
            ariaLabel={t("ar.receipts.colStatus")}
            options={["posted", "pending", "bounced", "timed-out"].map((s) => ({ value: s, label: tk(`shared.status.${s}`) }))}
          />
        </div>
        <ListTable
          rows={data ? rows : undefined}
          columns={columns}
          rowKey={(r) => r.receipt.id}
          rowTestId="receipt-row"
          rowAttrs={(r) => ({ "receipt-no": r.receipt.receiptNo, status: r.receipt.status })}
          rowClassName={(r) => (r.receipt.id === openId ? "bg-primary-soft" : undefined)}
          onRowClick={(r) => open(r.receipt.id)}
          dense
        />
      </section>
      <ReceiptDetail receiptId={openId} onClose={() => open(null)} />
    </div>
  )
}

/** One receipt: allocations, deductions, cheque, voucher and the money receipt print. */
export function ReceiptDetail({ receiptId, onClose }: { receiptId: Id | null; onClose: () => void }) {
  const db = useDb()
  const { t, tk, locale, dmy } = useLocale()
  const users = useUserMap()
  const [printing, setPrinting] = React.useState(false)
  const data = useLiveQuery(async () => {
    if (!receiptId) return null
    const receipt = await db.receipts.get(receiptId)
    if (!receipt) return null
    const [party, account, cheque, invoices] = await Promise.all([
      db.parties.get(receipt.partyId),
      db.cashBankAccounts.get(receipt.cashBankAccountId),
      receipt.chequeId ? db.cheques.get(receipt.chequeId) : undefined,
      db.salesInvoices.bulkGet(receipt.allocations.map((a) => a.invoiceId)),
    ])
    const journal = receipt.journalId ? await db.journals.get(receipt.journalId) : undefined
    return { receipt, party, account, cheque, invoices: new Map(invoices.filter(Boolean).map((i) => [i!.id, i!])), journal }
  }, [db, receiptId])

  const r = data?.receipt
  const location = r ? locations.find((l) => l.id === r.locationId) : undefined
  return (
    <>
      <Dialog open={!!receiptId && !!data} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-xl" data-testid="receipt-detail">
          {r && data ? (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <DialogTitle>
                    <span lang="en" className="font-mono">
                      {r.receiptNo}
                    </span>
                  </DialogTitle>
                  <DocStatus status={r.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  <Link href={`/par/${r.partyId}`} className="text-link hover:underline">
                    {nameOf(data.party, locale)}
                  </Link>{" "}
                  · {dmy(r.date)} · {tk(`ar.method.${r.method}`)}
                </p>
              </DialogHeader>
              <KeyValueGrid
                columns={2}
                items={[
                  { label: t("ar.receipts.colAmount"), value: <MoneyText poisha={r.amountP} className="font-mono" /> },
                  { label: t("ar.receipts.account"), value: nameOf(data.account, locale) },
                  { label: t("ar.receipts.vds"), value: <MoneyText poisha={r.vdsDeductedP} className="font-mono" /> },
                  { label: t("ar.receipts.ait"), value: <MoneyText poisha={r.aitDeductedP} className="font-mono" /> },
                  { label: t("ar.receipts.certificate"), value: r.certificateNo ?? "-", mono: true },
                  { label: t("ar.receipts.advance"), value: <MoneyText poisha={r.advanceP} className="font-mono" /> },
                  { label: t("ar.receipts.reference"), value: r.ref ?? "-", mono: true },
                  { label: t("ar.receipts.takenBy"), value: userName(users.get(r.takenBy), locale) || "-" },
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("ar.receipts.allocations")}</span>
                {r.allocations.length ? (
                  r.allocations.map((a) => {
                    const inv = data.invoices.get(a.invoiceId)
                    return (
                      <div key={a.invoiceId} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                        {inv ? <DocLink docType="salesInvoices" docId={inv.id} docNo={inv.invoiceNo} /> : <span>{a.invoiceId}</span>}
                        <MoneyText poisha={a.amountP} className="font-mono" />
                      </div>
                    )
                  })
                ) : (
                  <span className="text-sm text-muted-foreground">{t("ar.receipts.none")}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[0.8125rem]">
                {data.cheque ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{t("ar.receipts.cheque")}</span>
                    <DocLink docType="cheques" docId={data.cheque.id} docNo={data.cheque.chequeNo} />
                    <DocStatus status={data.cheque.status} />
                  </span>
                ) : null}
                {data.journal ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{t("ar.receipts.journal")}</span>
                    <DocLink docType="journals" docId={data.journal.id} docNo={data.journal.journalNo} />
                  </span>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="neutral" onClick={onClose}>
                  {t("ar.receipts.close")}
                </Button>
                <Button variant="outline" onClick={() => setPrinting(true)} data-testid="receipt-print">
                  <Printer />
                  {t("ar.receipts.print")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {r && data ? (
        <PrintDialog open={printing} onOpenChange={setPrinting} title={t("ar.receipts.moneyReceipt")} docNo={r.receiptNo}>
          <PrintLayout size="A5" title={t("ar.receipts.moneyReceipt")} docNo={r.receiptNo} location={location?.code} meta={dmy(r.date)}>
            <div className="flex flex-col gap-3 text-[0.8125rem]">
              <div>
                <span className="text-[#555]">{t("ar.receipts.receivedFrom")}: </span>
                <span className="font-semibold">{nameOf(data.party, locale)}</span>{" "}
                <span lang="en" className="font-mono text-xs">
                  ({data.party?.code})
                </span>
              </div>
              <div>
                <span className="text-[#555]">{t("ar.receipts.theSumOf")}: </span>
                <MoneyText poisha={r.amountP} className="font-mono font-semibold" />
                <div className="text-xs italic">{amountInWords(r.amountP, locale)}</div>
              </div>
              <div>
                <span className="text-[#555]">{t("ar.receipts.colMethod")}: </span>
                {tk(`ar.method.${r.method}`)}
                {data.cheque ? (
                  <span lang="en" className="font-mono">
                    {" "}
                    {data.cheque.chequeNo} ({data.cheque.bankName})
                  </span>
                ) : null}
              </div>
              {r.allocations.length ? (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#111]">
                      <th className="py-1 text-left">{t("ar.receipts.against")}</th>
                      <th className="py-1 text-right">{t("common.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.allocations.map((a) => (
                      <tr key={a.invoiceId} className="border-b border-[#e0e0e0]">
                        <td lang="en" className="py-1 font-mono">
                          {data.invoices.get(a.invoiceId)?.invoiceNo ?? a.invoiceId}
                        </td>
                        <td className="py-1 text-right">
                          <MoneyText poisha={a.amountP} className="font-mono" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {r.vdsDeductedP + r.aitDeductedP ? (
                <div className="text-xs">
                  {t("ar.receipts.vds")}: <MoneyText poisha={r.vdsDeductedP} className="font-mono" /> · {t("ar.receipts.ait")}:{" "}
                  <MoneyText poisha={r.aitDeductedP} className="font-mono" />
                  {r.certificateNo ? (
                    <span lang="en" className="font-mono">
                      {" "}
                      ({r.certificateNo})
                    </span>
                  ) : null}
                </div>
              ) : null}
              {r.advanceP ? (
                <div className="text-xs">
                  {t("ar.receipts.advance")}: <MoneyText poisha={r.advanceP} className="font-mono" />
                </div>
              ) : null}
              <div className="mt-8 flex justify-end">
                <div className="w-48 border-t border-[#111] pt-1 text-center text-xs">{t("ar.receipts.signature")}</div>
              </div>
            </div>
          </PrintLayout>
        </PrintDialog>
      ) : null}
    </>
  )
}
