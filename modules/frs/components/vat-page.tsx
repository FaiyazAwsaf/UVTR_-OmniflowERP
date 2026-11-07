"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { FileCheck2, Receipt, Send } from "lucide-react"
import { toast } from "sonner"

import { DataTable, TableSearch, type ColumnDef } from "@/components/motion/data-table"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText } from "@/components/shared/status"
import { BiLabel, TaxDocHeader } from "@/components/shared/tax-doc-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { useUserMap, userName } from "@/core/security/users"
import { dictionaries, lookup, type TranslationKey } from "@/lib/i18n"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { CsvButton, PeriodSelect, Toolbar } from "@/modules/fa/components/common"
import { PaperTable, PrintPreview } from "@/modules/fa/components/print-preview"
import { useMonthLabel, usePeriods, useToday } from "@/modules/fa/queries"

import { submitVatReturn } from "../commands"
import { loadVatMonth, monthEnd } from "../queries"
import { dueDateOf } from "../vat"
import { DepositsCard } from "./deposits"

const freshKey = () => `frs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type RegisterRow = {
  id: string
  docType: string
  docNo: string
  date: string
  party: string
  bin: string
  ref: string
  netP: number
  vatP: number
  totalP: number
  creditable: boolean
  kind: "bill" | "debit-note" | "invoice" | "credit-note"
}

/**
 * VAT (plan §9 `/frs/vat`, accounting_rules.md §4.1): the Mushak 9.1
 * summary for a month from the ledger (output VAT, input VAT credits, VDS
 * credits, carry-forward, net payable), its simulated e-VAT submission
 * (frs.submitVatReturn, R27a) and the tax deposits (frs.payTax, R27b); the
 * 6.1 purchase register from bills and debit notes and the 6.2 sales
 * register from invoices and credit notes. Print and CSV.
 */
export function VatPage() {
  const db = useDb()
  const params = useSearchParams()
  const { t, date, dmy, time, money, num, locale } = useLocale()
  const monthLabel = useMonthLabel(date)
  const today = useToday()
  const periods = usePeriods()
  const users = useUserMap()
  const canSubmit = useCan("frs.vat.submit")
  const ready = today > "2000"
  const lastMonth = ready ? addDaysISO(`${today.slice(0, 7)}-01`, -1).slice(0, 7) : ""
  const [picked, setMonth] = React.useState<string>(params.get("month") ?? "")
  const [confirming, setConfirming] = React.useState(false)
  const [tab, setTab] = React.useState("summary")
  const [query, setQuery] = React.useState("")
  const submit = useCommand(submitVatReturn)

  // A deep link to a return or deposit opens its month.
  const linked = useLiveQuery(async () => {
    const id = params.get("id")
    const deposit = params.get("deposit")
    if (id) return (await db.vatReturns.get(id))?.month
    if (deposit) return (await db.taxDeposits.get(deposit))?.forMonth
    return undefined
  }, [db, params])
  const month = picked || linked || lastMonth

  const data = useLiveQuery(async () => {
    if (!month) return null
    const from = `${month}-01`
    const to = monthEnd(month)
    const [figures, vatReturn, bills, debitNotes, invoices, creditNotes] = await Promise.all([
      loadVatMonth(db, month),
      db.vatReturns.where("month").equals(month).first(),
      db.vendorBills.where("date").between(from, to, true, true).toArray(),
      db.debitNotes.toArray(),
      db.salesInvoices.where("date").between(from, to, true, true).toArray(),
      db.creditNotes.where("date").between(from, to, true, true).toArray(),
    ])
    const partyIds = new Set([...bills, ...invoices, ...creditNotes].map((d) => d.partyId).concat(debitNotes.map((d) => d.partyId)))
    const parties = new Map((await db.parties.bulkGet([...partyIds])).filter(Boolean).map((p) => [p!.id, p!]))
    const settlement = vatReturn?.journalId ? await db.journals.get(vatReturn.journalId) : undefined
    const purchases: RegisterRow[] = [
      ...bills
        .filter((b) => b.journalId && b.kind !== "opening")
        .map((b) => ({
          id: b.id,
          docType: "vendorBills",
          docNo: b.billNo,
          date: b.date,
          party: parties.get(b.partyId)?.nameEn ?? "",
          bin: parties.get(b.partyId)?.bin ?? "",
          ref: b.vendorRef,
          netP: b.subtotalP,
          vatP: b.inputVatP,
          totalP: b.totalP,
          creditable: b.hasMushak63,
          kind: "bill" as const,
        })),
      ...debitNotes
        .filter((d) => d.date >= from && d.date <= to)
        .map((d) => ({
          id: d.id,
          docType: "debitNotes",
          docNo: d.debitNoteNo,
          date: d.date,
          party: parties.get(d.partyId)?.nameEn ?? "",
          bin: parties.get(d.partyId)?.bin ?? "",
          ref: d.reason,
          netP: -d.netP,
          vatP: -d.vatP,
          totalP: -d.totalP,
          creditable: true,
          kind: "debit-note" as const,
        })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo))
    const sales: RegisterRow[] = [
      ...invoices
        .filter((i) => i.kind !== "opening")
        .map((i) => ({
          id: i.id,
          docType: "salesInvoices",
          docNo: i.invoiceNo,
          date: i.date,
          party: i.buyerNameEn || parties.get(i.partyId)?.nameEn || "",
          bin: i.buyerBin ?? "",
          ref: "",
          netP: i.subtotalP - i.discountP,
          vatP: i.vatP,
          totalP: i.totalP,
          creditable: true,
          kind: "invoice" as const,
        })),
      ...creditNotes
        .filter((c) => c.status === "posted")
        .map((c) => {
          const vat = c.lines.reduce((s, l) => s + l.vatP, 0)
          const net = c.lines.reduce((s, l) => s + l.netP, 0)
          return {
            id: c.id,
            docType: "creditNotes",
            docNo: c.creditNoteNo,
            date: c.date,
            party: parties.get(c.partyId)?.nameEn ?? "",
            bin: parties.get(c.partyId)?.bin ?? "",
            ref: c.reason,
            netP: -net,
            vatP: -vat,
            totalP: -c.totalP,
            creditable: true,
            kind: "credit-note" as const,
          }
        }),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo))
    return { figures, vatReturn, settlement, purchases, sales }
  }, [db, month])

  const f = data?.figures
  const ended = !!month && month < today.slice(0, 7)
  const run = async () => {
    const result = await submit.run({ month, idempotencyKey: freshKey() })
    setConfirming(false)
    if (result) toast.success(t("frs.vat.submitted", { month: monthLabel(month), ref: result.nbrRef }))
  }

  const summaryRows: { key: string; labelKey: TranslationKey; value: number; strong?: boolean }[] = f
    ? [
        { key: "output", labelKey: "frs.vat.output", value: f.outputVatP },
        { key: "input", labelKey: "frs.vat.input", value: f.inputVatP },
        { key: "vds", labelKey: "frs.vat.vdsCredit", value: f.vdsCreditP },
        { key: "carry", labelKey: "frs.vat.carryIn", value: data?.vatReturn?.carryInP ?? f.carryInP },
        { key: "credits", labelKey: "frs.vat.credits", value: f.creditsP, strong: true },
        { key: "setoff", labelKey: "frs.vat.setOff", value: f.setOffP },
        { key: "net", labelKey: "frs.vat.netPayable", value: data?.vatReturn?.netPayableP ?? f.netPayableP, strong: true },
        { key: "cf", labelKey: "frs.vat.carryForward", value: data?.vatReturn?.carryForwardP ?? f.carryForwardP },
      ]
    : []
  // Mushak prints carry Bangla first and English below, whatever the window's language.
  const bi = (key: TranslationKey) => <BiLabel key={key} bn={lookup(dictionaries.bn, key)} en={lookup(dictionaries.en, key)} />

  const registerColumns = (kindLabel: (r: RegisterRow) => string, partyHeader: string): ColumnDef<RegisterRow, unknown>[] => [
    { id: "date", header: t("frs.common.date"), accessorKey: "date", cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span> },
    {
      id: "doc",
      header: t("frs.vat.invoice"),
      accessorKey: "docNo",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <DocLink docType={row.original.docType} docId={row.original.id} docNo={row.original.docNo} showApp={false} />
          {row.original.kind === "debit-note" || row.original.kind === "credit-note" ? (
            <span className="text-[0.6875rem] text-muted-foreground">{kindLabel(row.original)}</span>
          ) : null}
        </span>
      ),
    },
    { id: "party", header: partyHeader, accessorKey: "party", cell: ({ row }) => <span className="line-clamp-1 max-w-64">{row.original.party}</span> },
    {
      id: "bin",
      header: t("frs.vat.bin"),
      accessorKey: "bin",
      meta: { hideBelow: "lg" },
      cell: ({ row }) => (
        <span lang="en" className="font-mono text-xs">
          {row.original.bin}
        </span>
      ),
    },
    {
      id: "net",
      header: t("frs.vat.net"),
      accessorKey: "netP",
      meta: { align: "right", className: "font-mono", hideBelow: "md" },
      cell: ({ row }) => <MoneyText poisha={row.original.netP} colorize />,
    },
    {
      id: "vat",
      header: t("frs.vat.vatAmount"),
      accessorKey: "vatP",
      meta: { align: "right", className: "font-mono" },
      cell: ({ row }) => (
        <span className={cn(!row.original.creditable && "text-muted-foreground line-through")} title={row.original.creditable ? undefined : t("frs.vat.notCreditable")}>
          <MoneyText poisha={row.original.vatP} colorize />
        </span>
      ),
    },
    {
      id: "total",
      header: t("frs.vat.total"),
      accessorKey: "totalP",
      meta: { align: "right", className: "font-mono", hideBelow: "sm" },
      cell: ({ row }) => <MoneyText poisha={row.original.totalP} colorize />,
    },
  ]
  const purchaseColumns = registerColumns(() => t("frs.vat.debitNote"), t("frs.vat.vendor"))
  const salesColumns = registerColumns(() => t("frs.vat.creditNote"), t("frs.vat.buyer"))
  const filterRows = (rows: RegisterRow[]) => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((r) => r.docNo.toLowerCase().includes(q) || r.party.toLowerCase().includes(q) || r.bin.includes(q)) : rows
  }
  const csvColumns = [
    { key: "date", label: t("frs.common.date") },
    { key: "docNo", label: t("frs.vat.invoice") },
    { key: "party", label: t("frs.vat.vendor") },
    { key: "bin", label: t("frs.vat.bin") },
    { key: "netP", label: t("frs.vat.net") },
    { key: "vatP", label: t("frs.vat.vatAmount") },
    { key: "totalP", label: t("frs.vat.total") },
  ]
  const sum = (rows: RegisterRow[], key: "netP" | "vatP" | "totalP", creditableOnly = false) =>
    rows.reduce((s, r) => s + (creditableOnly && !r.creditable ? 0 : r[key]), 0)

  return (
    <div className="flex flex-col gap-5" data-testid="frs-vat">
      <PageHeader
        title={t("frs.vat.title")}
        subtitle={t("frs.vat.subtitle")}
        actions={<PeriodSelect periods={periods} value={month} onChange={setMonth} testId="vat-month" filter={(p) => p.startsOn <= today} />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
          <TabsTrigger value="summary" data-testid="vat-tab-summary">
            {t("frs.vat.tabs.summary")}
          </TabsTrigger>
          <TabsTrigger value="purchases" data-testid="vat-tab-purchases">
            {t("frs.vat.tabs.purchases")}
          </TabsTrigger>
          <TabsTrigger value="sales" data-testid="vat-tab-sales">
            {t("frs.vat.tabs.sales")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <div className="grid grid-cols-1 gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SectionCard
              title={t("frs.vat.summaryTitle", { month: month ? monthLabel(month) : "" })}
              subtitle={t("frs.vat.registerNote")}
              icon={FileCheck2}
              action={<SimulatedBadge />}
            >
              <dl className="flex flex-col" data-testid="vat-summary" data-month={month} data-submitted={data?.vatReturn ? "true" : "false"}>
                {summaryRows.map((r) => (
                  <div key={r.key} className={cn("flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-b-0", r.strong && "font-semibold")} data-testid={`vat-${r.key}`}>
                    <dt className={cn(!r.strong && "text-muted-foreground")}>{t(r.labelKey)}</dt>
                    <dd className="font-mono">
                      <MoneyText poisha={r.value} />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                {data?.vatReturn ? (
                  <div className="flex flex-col gap-1 text-sm">
                    <StatusText tone="success" dot data-testid="vat-status">
                      {t("frs.vat.submittedRef", { ref: data.vatReturn.nbrRef })}
                    </StatusText>
                    <span className="text-xs text-muted-foreground">
                      {t("frs.common.submittedOn", { date: `${dmy(data.vatReturn.submittedAt)} ${time(data.vatReturn.submittedAt)}` })},{" "}
                      {t("frs.common.by", { name: userName(users.get(data.vatReturn.submittedBy), locale) })}
                    </span>
                    {data.settlement ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">{t("frs.vat.settlement")}</span>
                        <DocLink docType="journals" docId={data.settlement.id} docNo={data.settlement.journalNo} />
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <Button onClick={() => setConfirming(true)} disabled={!canSubmit || !ended || !f || submit.pending} data-testid="vat-submit">
                      <Send />
                      {t("frs.vat.submit")}
                    </Button>
                    <span className="text-xs text-muted-foreground" data-testid="vat-status">
                      {t("frs.vat.notSubmitted")} · {t("frs.common.dueOn", { date: month ? dmy(dueDateOf(month)) : "" })}
                    </span>
                  </>
                )}
                {f ? (
                  <span className="ml-auto">
                    <PrintPreview title={t("frs.vat.printTitle")} showBrand={false} docNo={`9.1/${month}`} testId="vat-print">
                      <TaxDocHeader form="9.1" docNo={data?.vatReturn?.nbrRef ?? `9.1/${month}`} issuedAt={t("frs.vat.printFor", { month })} />
                      <PaperTable
                        head={[bi("frs.vat.particulars"), bi("frs.vat.taka")]}
                        align={["l", "r"]}
                        rows={summaryRows.map((r) => [bi(r.labelKey), money(r.value)])}
                      />
                    </PrintPreview>
                  </span>
                ) : null}
              </div>
            </SectionCard>
            {month ? <DepositsCard month={month} monthLabel={monthLabel(month)} kinds={["vat", "vds", "ait"]} /> : null}
          </div>
        </TabsContent>

        {(["purchases", "sales"] as const).map((which) => {
          const rows = filterRows((which === "purchases" ? data?.purchases : data?.sales) ?? [])
          return (
            <TabsContent key={which} value={which} className="mt-4">
              <DataTable
                data={rows}
                columns={which === "purchases" ? purchaseColumns : salesColumns}
                rowId={(r) => r.id}
                density="compact"
                emptyIcon={<Receipt />}
                emptyTitle={t("frs.common.noRows")}
                toolbar={
                  <Toolbar className="w-full">
                    <TableSearch value={query} onChange={setQuery} />
                    <span className="text-xs text-muted-foreground" data-testid={`vat-${which}-count`}>
                      {t("frs.vat.rows", { count: num(rows.length) })}
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-3 text-xs">
                      <span>
                        {t("frs.vat.net")} <MoneyText poisha={sum(rows, "netP")} className="font-mono font-semibold" />
                      </span>
                      <span data-testid={`vat-${which}-vat`}>
                        {t("frs.vat.vatAmount")} <MoneyText poisha={sum(rows, "vatP", which === "purchases")} className="font-mono font-semibold" />
                      </span>
                      <CsvButton
                        exportKey="frs.export"
                        fileName={`mushak-${which === "purchases" ? "6.1" : "6.2"}-${month}`}
                        columns={csvColumns}
                        rows={() => rows.map((r) => ({ ...r, creditable: r.creditable ? "yes" : "no" }))}
                        testId={`vat-${which}-csv`}
                      />
                    </span>
                  </Toolbar>
                }
              />
            </TabsContent>
          )
        })}
      </Tabs>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent data-testid="vat-submit-dialog">
          <DialogHeader>
            <DialogTitle>{t("frs.vat.submitTitle", { month: month ? monthLabel(month) : "" })}</DialogTitle>
            <DialogDescription>{t("frs.vat.submitBody")}</DialogDescription>
          </DialogHeader>
          {f ? (
            <p className="flex items-baseline justify-between rounded-md bg-surface-raised px-3 py-2 text-sm">
              {t("frs.vat.netPayable")} <MoneyText poisha={f.netPayableP} className="font-mono font-semibold" />
            </p>
          ) : null}
          <DialogFooter className="items-center">
            <SimulatedBadge className="mr-auto" />
            <Button variant="neutral" onClick={() => setConfirming(false)}>
              {t("fa.common.cancel")}
            </Button>
            <Button onClick={run} disabled={submit.pending} data-testid="vat-submit-confirm">
              <Send />
              {t("frs.vat.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
