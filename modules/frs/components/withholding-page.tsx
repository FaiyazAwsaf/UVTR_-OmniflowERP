"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Receipt } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { useLocale } from "@/lib/i18n/provider"
import { CsvButton, PeriodSelect, Toolbar } from "@/modules/fa/components/common"
import { useMonthLabel, usePeriods, useToday } from "@/modules/fa/queries"

import { monthEnd } from "../queries"
import { DepositsCard } from "./deposits"

type Row = {
  id: string
  docType: string
  docNo: string
  date: string
  party: string
  tin: string
  grossP: number
  aitP: number
  vdsP: number
  netP: number
  certificate: string
}

/**
 * Withholding tax (plan §9 `/frs/withholding`, accounting_rules.md §4.2 and
 * §4.3): AIT (TDS) and VDS deducted from vendor payments with their
 * certificates (Mushak 6.6 for VDS), the deductions corporate customers made
 * on their receipts, and the month's VDS and AIT deposits.
 */
export function WithholdingPage() {
  const db = useDb()
  const params = useSearchParams()
  const { t, date, dmy, num } = useLocale()
  const monthLabel = useMonthLabel(date)
  const today = useToday()
  const periods = usePeriods()
  const lastMonth = today > "2000" ? addDaysISO(`${today.slice(0, 7)}-01`, -1).slice(0, 7) : ""
  const [picked, setMonth] = React.useState(params.get("month") ?? "")
  const month = picked || lastMonth

  const data = useLiveQuery(async () => {
    if (!month) return null
    const from = `${month}-01`
    const to = monthEnd(month)
    const [payments, receipts] = await Promise.all([
      db.vendorPayments.where("date").between(from, to, true, true).toArray(),
      db.receipts.where("date").between(from, to, true, true).toArray(),
    ])
    const ids = new Set([...payments.map((p) => p.partyId), ...receipts.map((r) => r.partyId)])
    const parties = new Map((await db.parties.bulkGet([...ids])).filter(Boolean).map((p) => [p!.id, p!]))
    const vendorRows: Row[] = payments
      .filter((p) => p.status === "posted")
      .map((p) => ({
        id: p.id,
        docType: "vendorPayments",
        docNo: p.paymentNo,
        date: p.date,
        party: parties.get(p.partyId)?.nameEn ?? "",
        tin: parties.get(p.partyId)?.tin ?? "",
        grossP: p.grossP,
        aitP: p.aitP,
        vdsP: p.vdsP,
        netP: p.netPaidP,
        certificate: [p.aitCertificateNo, p.vdsCertificateNo].filter(Boolean).join(" · "),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const customerRows: Row[] = receipts
      .filter((r) => r.status === "posted" && (r.vdsDeductedP > 0 || r.aitDeductedP > 0))
      .map((r) => ({
        id: r.id,
        docType: "receipts",
        docNo: r.receiptNo,
        date: r.date,
        party: parties.get(r.partyId)?.nameEn ?? "",
        tin: parties.get(r.partyId)?.tin ?? "",
        grossP: r.amountP + r.vdsDeductedP + r.aitDeductedP,
        aitP: r.aitDeductedP,
        vdsP: r.vdsDeductedP,
        netP: r.amountP,
        certificate: r.certificateNo ?? "",
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { vendorRows, customerRows }
  }, [db, month])

  const columns = (kind: "ait" | "vds" | "customers"): ColumnDef<Row, unknown>[] => [
    { id: "date", header: t("frs.common.date"), accessorKey: "date", cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span> },
    {
      id: "doc",
      header: kind === "customers" ? t("frs.wht.receipt") : t("frs.wht.payment"),
      accessorKey: "docNo",
      cell: ({ row }) => <DocLink docType={row.original.docType} docId={row.original.id} docNo={row.original.docNo} showApp={false} />,
    },
    {
      id: "party",
      header: kind === "customers" ? t("frs.wht.customer") : t("frs.wht.vendor"),
      accessorKey: "party",
      cell: ({ row }) => <span className="line-clamp-1 max-w-64">{row.original.party}</span>,
    },
    {
      id: "tin",
      header: t("frs.wht.tin"),
      accessorKey: "tin",
      meta: { hideBelow: "lg" },
      cell: ({ row }) => (
        <span lang="en" className="font-mono text-xs">
          {row.original.tin}
        </span>
      ),
    },
    {
      id: "gross",
      header: kind === "customers" ? t("frs.wht.received") : t("frs.wht.gross"),
      accessorKey: "grossP",
      meta: { align: "right", className: "font-mono", hideBelow: "md" },
      cell: ({ row }) => <MoneyText poisha={kind === "customers" ? row.original.netP : row.original.grossP} />,
    },
    ...(kind !== "vds"
      ? [
          {
            id: "ait",
            header: kind === "customers" ? t("frs.wht.aitDeducted") : t("frs.wht.ait"),
            accessorKey: "aitP",
            meta: { align: "right", className: "font-mono" },
            cell: ({ row }) => <MoneyText poisha={row.original.aitP} />,
          } satisfies ColumnDef<Row, unknown>,
        ]
      : []),
    ...(kind !== "ait"
      ? [
          {
            id: "vds",
            header: kind === "customers" ? t("frs.wht.vdsDeducted") : t("frs.wht.vds"),
            accessorKey: "vdsP",
            meta: { align: "right", className: "font-mono" },
            cell: ({ row }) => <MoneyText poisha={row.original.vdsP} />,
          } satisfies ColumnDef<Row, unknown>,
        ]
      : []),
    {
      id: "certificate",
      header: t("frs.wht.certificate"),
      accessorKey: "certificate",
      meta: { hideBelow: "sm" },
      cell: ({ row }) => (
        <span lang="en" className="font-mono text-xs">
          {row.original.certificate}
        </span>
      ),
    },
  ]

  const tabs = [
    { key: "ait" as const, rows: (data?.vendorRows ?? []).filter((r) => r.aitP > 0) },
    { key: "vds" as const, rows: (data?.vendorRows ?? []).filter((r) => r.vdsP > 0) },
    { key: "customers" as const, rows: data?.customerRows ?? [] },
  ]

  return (
    <div className="flex flex-col gap-5" data-testid="frs-wht">
      <PageHeader
        title={t("frs.wht.title")}
        subtitle={t("frs.wht.subtitle")}
        actions={<PeriodSelect periods={periods} value={month} onChange={setMonth} testId="wht-month" filter={(p) => p.startsOn <= today} />}
      />
      {month ? <DepositsCard month={month} monthLabel={monthLabel(month)} kinds={["vds", "ait"]} /> : null}
      <Tabs defaultValue="ait">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} data-testid={`wht-tab-${tab.key}`}>
              {t(`frs.wht.tabs.${tab.key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-4">
            <DataTable
              data={tab.rows}
              columns={columns(tab.key)}
              rowId={(r) => r.id}
              density="compact"
              emptyIcon={<Receipt />}
              emptyTitle={t("frs.common.noRows")}
              toolbar={
                <Toolbar className="w-full">
                  <span className="text-xs text-muted-foreground" data-testid={`wht-${tab.key}-count`}>
                    {t("frs.wht.rows", { count: num(tab.rows.length) })}
                  </span>
                  <span className="ml-auto flex flex-wrap items-center gap-3 text-xs">
                    {tab.key !== "vds" ? (
                      <span>
                        {t("frs.wht.ait")} <MoneyText poisha={tab.rows.reduce((s, r) => s + r.aitP, 0)} className="font-mono font-semibold" />
                      </span>
                    ) : null}
                    {tab.key !== "ait" ? (
                      <span>
                        {t("frs.wht.vds")} <MoneyText poisha={tab.rows.reduce((s, r) => s + r.vdsP, 0)} className="font-mono font-semibold" />
                      </span>
                    ) : null}
                    <CsvButton
                      exportKey="frs.export"
                      fileName={`withholding-${tab.key}-${month}`}
                      testId={`wht-${tab.key}-csv`}
                      columns={[
                        { key: "date", label: t("frs.common.date") },
                        { key: "docNo", label: t("frs.wht.payment") },
                        { key: "party", label: t("frs.wht.vendor") },
                        { key: "tin", label: t("frs.wht.tin") },
                        { key: "grossP", label: t("frs.wht.gross") },
                        { key: "aitP", label: t("frs.wht.ait") },
                        { key: "vdsP", label: t("frs.wht.vds") },
                        { key: "netP", label: t("frs.wht.netPaid") },
                        { key: "certificate", label: t("frs.wht.certificate") },
                      ]}
                      rows={() => tab.rows.map((r) => ({ ...r }))}
                    />
                  </span>
                </Toolbar>
              }
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
