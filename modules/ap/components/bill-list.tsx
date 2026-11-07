"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus } from "lucide-react"

import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow, VendorBillRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { billOpenP } from "@/modules/ar/lib"
import { CsvButton, LinkButton, ListTable, NativeSelect, SearchBox, useToday, type Column } from "@/modules/par/components/kit"

type Row = { bill: VendorBillRow; vendor: PartyRow | undefined }

/** /ap/bills: every vendor bill with its match and payment status (plan §9). */
export function BillList() {
  const db = useDb()
  const router = useRouter()
  const today = useToday()
  const { t, tk, locale, dmy } = useLocale()
  const { can } = usePermissions()
  const [query, setQuery] = React.useState("")
  const [kind, setKind] = React.useState("")
  const [status, setStatus] = React.useState("")

  const data = useLiveQuery(async () => {
    const bills = await db.vendorBills.toArray()
    const vendors = new Map((await db.parties.bulkGet([...new Set(bills.map((b) => b.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return bills.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.billNo.localeCompare(a.billNo))).map((bill) => ({ bill, vendor: vendors.get(bill.partyId) }))
  }, [db])

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(({ bill, vendor }) => {
      if (kind && bill.kind !== kind) return false
      if (status && bill.status !== status) return false
      if (!q) return true
      return bill.billNo.toLowerCase().includes(q) || bill.vendorRef.toLowerCase().includes(q) || (vendor?.nameEn.toLowerCase().includes(q) ?? false)
    })
  }, [data, query, kind, status])

  const columns: Column<Row>[] = [
    { key: "date", header: t("ap.bills.colDate"), sortValue: (r) => r.bill.date, cell: (r) => <span className="nums">{dmy(r.bill.date)}</span> },
    { key: "no", header: t("ap.bills.colNo"), sortValue: (r) => r.bill.billNo, cell: (r) => <span lang="en" className="font-mono text-link">{r.bill.billNo}</span> },
    {
      key: "vendor",
      header: t("ap.bills.colVendor"),
      hide: "sm",
      sortValue: (r) => r.vendor?.nameEn ?? "",
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{nameOf(r.vendor, locale)}</span>
          <span lang="en" className="font-mono text-xs text-muted-foreground">
            {r.bill.vendorRef}
          </span>
        </span>
      ),
    },
    { key: "kind", header: t("ap.bills.colKind"), hide: "lg", cell: (r) => <span className="text-muted-foreground">{tk(`reports.enum.billKind.${r.bill.kind}`)}</span> },
    {
      key: "match",
      header: t("ap.bills.colMatch"),
      hide: "md",
      cell: (r) => (r.bill.matchStatus === "n-a" ? <span className="text-muted-foreground">-</span> : <DocStatus status={r.bill.matchStatus} />),
    },
    {
      key: "due",
      header: t("ap.bills.colDue"),
      hide: "lg",
      sortValue: (r) => r.bill.dueDate,
      cell: (r) => <span className={cn("nums", today && r.bill.dueDate < today && billOpenP(r.bill) > 0 && r.bill.status !== "on-hold" && "text-destructive")}>{dmy(r.bill.dueDate)}</span>,
    },
    { key: "total", header: t("ap.bills.colTotal"), align: "right", sortValue: (r) => r.bill.totalP, cell: (r) => <MoneyText poisha={r.bill.totalP} className="font-mono" /> },
    { key: "open", header: t("ap.bills.colOpen"), align: "right", hide: "md", sortValue: (r) => billOpenP(r.bill), cell: (r) => <MoneyText poisha={billOpenP(r.bill)} className="font-mono" /> },
    { key: "status", header: t("ap.bills.colStatus"), cell: (r) => <DocStatus status={r.bill.status} /> },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="bill-list">
      <PageHeader
        title={t("ap.pages.bills")}
        subtitle={t("ap.bills.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="ap.export"
              fileName="bills"
              rows={rows.map(({ bill: b, vendor }) => ({ date: b.date, billNo: b.billNo, vendor: vendor?.nameEn ?? "", vendorRef: b.vendorRef, kind: b.kind, totalP: b.totalP, openP: billOpenP(b), status: b.status }))}
              columns={[
                { key: "date", label: t("ap.bills.colDate") },
                { key: "billNo", label: t("ap.bills.colNo") },
                { key: "vendor", label: t("ap.bills.colVendor") },
                { key: "vendorRef", label: t("ap.bills.colRef") },
                { key: "kind", label: t("ap.bills.colKind") },
                { key: "totalP", label: t("ap.bills.colTotal") },
                { key: "openP", label: t("ap.bills.colOpen") },
                { key: "status", label: t("ap.bills.colStatus") },
              ]}
            />
            {can("ap.bill.create") ? (
              <LinkButton href="/ap/bills/new" testId="bill-new">
                <Plus />
                {t("ap.bills.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder={t("ap.bills.searchPlaceholder")} testId="bill-search" />
          <NativeSelect value={kind} onChange={setKind} placeholder={t("ap.bills.kindAll")} className="w-40" ariaLabel={t("ap.bills.colKind")} options={["goods", "expense", "summary", "opening"].map((k) => ({ value: k, label: tk(`reports.enum.billKind.${k}`) }))} />
          <NativeSelect
            value={status}
            onChange={setStatus}
            placeholder={t("ap.bills.statusAll")}
            className="w-40"
            ariaLabel={t("ap.bills.colStatus")}
            options={["on-hold", "posted", "partially-paid", "paid"].map((s) => ({ value: s, label: tk(`shared.status.${s}`) }))}
          />
        </div>
        <ListTable
          rows={data ? rows : undefined}
          columns={columns}
          rowKey={(r) => r.bill.id}
          rowTestId="bill-row"
          rowAttrs={(r) => ({ "bill-no": r.bill.billNo, status: r.bill.status })}
          onRowClick={(r) => router.push(`/ap/bills/${r.bill.id}`)}
          dense
        />
      </section>
    </div>
  )
}
