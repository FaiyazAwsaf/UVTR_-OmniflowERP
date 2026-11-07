"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus } from "lucide-react"

import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow, VendorPaymentRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { CsvButton, LinkButton, ListTable, NativeSelect, SearchBox, type Column } from "@/modules/par/components/kit"

type Row = { payment: VendorPaymentRow; vendor: PartyRow | undefined }

/** /ap/payments: vendor payments with the withholding and approval state (plan §9). */
export function PaymentList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, dmy } = useLocale()
  const { can } = usePermissions()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("")
  const data = useLiveQuery(async () => {
    const payments = await db.vendorPayments.toArray()
    const vendors = new Map((await db.parties.bulkGet([...new Set(payments.map((p) => p.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return payments.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.paymentNo.localeCompare(a.paymentNo))).map((payment) => ({ payment, vendor: vendors.get(payment.partyId) }))
  }, [db])
  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(({ payment, vendor }) => (!status || payment.status === status) && (!q || payment.paymentNo.toLowerCase().includes(q) || (vendor?.nameEn.toLowerCase().includes(q) ?? false)))
  }, [data, query, status])

  const columns: Column<Row>[] = [
    { key: "date", header: t("ap.payments.colDate"), sortValue: (r) => r.payment.date, cell: (r) => <span className="nums">{dmy(r.payment.date)}</span> },
    { key: "no", header: t("ap.payments.colNo"), cell: (r) => <span lang="en" className="font-mono text-link">{r.payment.paymentNo}</span> },
    { key: "vendor", header: t("ap.payments.colVendor"), hide: "sm", sortValue: (r) => r.vendor?.nameEn ?? "", cell: (r) => <span className="truncate">{nameOf(r.vendor, locale)}</span> },
    { key: "method", header: t("ap.payments.colMethod"), hide: "lg", cell: (r) => <span className="text-muted-foreground">{tk(`ap.method.${r.payment.method}`)}</span> },
    { key: "gross", header: t("ap.payments.colGross"), align: "right", hide: "md", sortValue: (r) => r.payment.grossP, cell: (r) => <MoneyText poisha={r.payment.grossP} className="font-mono" /> },
    { key: "ait", header: t("ap.payments.colAit"), align: "right", hide: "lg", cell: (r) => <MoneyText poisha={r.payment.aitP} className="font-mono" /> },
    { key: "vds", header: t("ap.payments.colVds"), align: "right", hide: "lg", cell: (r) => <MoneyText poisha={r.payment.vdsP} className="font-mono" /> },
    { key: "net", header: t("ap.payments.colNet"), align: "right", sortValue: (r) => r.payment.netPaidP, cell: (r) => <MoneyText poisha={r.payment.netPaidP} className="font-mono" /> },
    { key: "status", header: t("ap.payments.colStatus"), cell: (r) => <DocStatus status={r.payment.status} /> },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="payment-list">
      <PageHeader
        title={t("ap.pages.payments")}
        subtitle={t("ap.payments.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="ap.export"
              fileName="vendor-payments"
              rows={rows.map(({ payment: p, vendor }) => ({ date: p.date, paymentNo: p.paymentNo, vendor: vendor?.nameEn ?? "", method: p.method, grossP: p.grossP, aitP: p.aitP, vdsP: p.vdsP, netP: p.netPaidP, status: p.status }))}
              columns={[
                { key: "date", label: t("ap.payments.colDate") },
                { key: "paymentNo", label: t("ap.payments.colNo") },
                { key: "vendor", label: t("ap.payments.colVendor") },
                { key: "method", label: t("ap.payments.colMethod") },
                { key: "grossP", label: t("ap.payments.colGross") },
                { key: "aitP", label: t("ap.payments.colAit") },
                { key: "vdsP", label: t("ap.payments.colVds") },
                { key: "netP", label: t("ap.payments.colNet") },
                { key: "status", label: t("ap.payments.colStatus") },
              ]}
            />
            {can("ap.payment.create") ? (
              <LinkButton href="/ap/payments/new" testId="payment-new">
                <Plus />
                {t("ap.payments.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder={t("ap.payments.searchPlaceholder")} />
          <NativeSelect value={status} onChange={setStatus} placeholder={t("ap.payments.statusAll")} className="w-44" ariaLabel={t("ap.payments.colStatus")} options={["pending-approval", "posted", "rejected"].map((s) => ({ value: s, label: tk(`shared.status.${s}`) }))} />
        </div>
        <ListTable rows={data ? rows : undefined} columns={columns} rowKey={(r) => r.payment.id} rowTestId="payment-row" rowAttrs={(r) => ({ "payment-no": r.payment.paymentNo, status: r.payment.status })} onRowClick={(r) => router.push(`/ap/payments/${r.payment.id}`)} dense />
      </section>
    </div>
  )
}
