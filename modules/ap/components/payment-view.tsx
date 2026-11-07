"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { FileX2, Hourglass, Printer, XCircle } from "lucide-react"

import { amountInWords } from "@/components/shared/amount-in-words"
import { ApprovalChip } from "@/components/shared/approval-chip"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { BiLabel, TaxDocHeader } from "@/components/shared/tax-doc-header"
import { VoucherView } from "@/components/shared/voucher-view"
import { Button } from "@/components/ui/button"
import { tenant } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { splitAllocation } from "@/core/tax/withholding"
import { nameOf, useUserMap, userName } from "@/core/security/users"
import { formatMoney } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"

import { Banner, Stat } from "@/modules/par/components/kit"
import { PrintDialog } from "@/modules/par/components/print-dialog"

const latin = (p: number) => formatMoney(p, "en")
const dmyLatin = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

/** /ap/payments/[id]: the payment, its approval, withholding, certificates and prints. */
export function PaymentView({ paymentId }: { paymentId: Id }) {
  const db = useDb()
  const { t, tk, locale, dmy } = useLocale()
  const users = useUserMap()
  const [print, setPrint] = React.useState<null | "vds" | "tds" | "voucher">(null)
  const data = useLiveQuery(async () => {
    const payment = await db.vendorPayments.get(paymentId)
    if (!payment) return null
    const [vendor, account, bills, cheque] = await Promise.all([
      db.parties.get(payment.partyId),
      db.cashBankAccounts.get(payment.cashBankAccountId),
      db.vendorBills.bulkGet(payment.allocations.map((a) => a.billId)),
      payment.chequeId ? db.cheques.get(payment.chequeId) : undefined,
    ])
    return { payment, vendor, account, bills: new Map(bills.filter(Boolean).map((b) => [b!.id, b!])), cheque }
  }, [db, paymentId])

  if (data === undefined) return null
  if (data === null) return <EmptyState icon={FileX2} title={t("ap.payment.notFound")} action={{ label: t("ap.pages.payments"), href: "/ap/payments" }} />
  const { payment: p, vendor } = data
  const shares = p.allocations.map((a) => {
    const bill = data.bills.get(a.billId)
    const split = bill ? splitAllocation({ allocatedP: a.amountP, billNetP: bill.subtotalP, billVatP: bill.inputVatP, billTotalP: bill.totalP }) : { exclusiveP: a.amountP, vatP: 0 }
    return { a, bill, ...split }
  })

  return (
    <div className="flex flex-col gap-4" data-testid="payment-view" data-payment-no={p.paymentNo}>
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 lang="en" className="font-mono text-xl font-semibold">
                {p.paymentNo}
              </h1>
              <span data-testid="payment-status" data-status={p.status}>
                <DocStatus status={p.status} />
              </span>
            </div>
            <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
              <Link href={`/par/${p.partyId}`} className="text-link hover:underline">
                {nameOf(vendor, locale)}
              </Link>
              <span>·</span>
              <span>{dmy(p.date)}</span>
              <span>·</span>
              <span>{tk(`ap.method.${p.method}`)}</span>
              <span>·</span>
              <span>{nameOf(data.account, locale)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.status === "posted" && p.vdsCertificateNo ? (
              <Button size="sm" onClick={() => setPrint("vds")} data-testid="certificate-print">
                <Printer />
                {t("ap.payment.printCertificate")}
              </Button>
            ) : null}
            {p.status === "posted" && p.aitCertificateNo ? (
              <Button size="sm" variant="outline" onClick={() => setPrint("tds")} data-testid="tds-print">
                <Printer />
                {t("ap.payment.printTds")}
              </Button>
            ) : null}
            <Button size="sm" variant="neutral" onClick={() => setPrint("voucher")} data-testid="voucher-print">
              <Printer />
              {t("ap.payment.printVoucher")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-surface-raised/50 p-3 sm:grid-cols-4">
          <Stat label={t("ap.payment.gross")} value={<MoneyText poisha={p.grossP} />} />
          <Stat label={t("ap.payment.ait")} value={<MoneyText poisha={p.aitP} />} testId="payment-ait" />
          <Stat label={t("ap.payment.vds")} value={<MoneyText poisha={p.vdsP} />} testId="payment-vds" />
          <Stat label={t("ap.payment.net")} value={<MoneyText poisha={p.netPaidP} />} tone="info" testId="payment-net-paid" />
        </div>
        {p.status === "pending-approval" ? (
          <Banner icon={<Hourglass />} testId="payment-pending-banner">
            {t("ap.payment.pendingBanner")}
          </Banner>
        ) : p.status === "rejected" ? (
          <Banner icon={<XCircle />} tone="destructive">
            {t("ap.payment.rejectedBanner")}
          </Banner>
        ) : null}
        {p.approvalId ? <ApprovalChip approvalId={p.approvalId} className="self-start" /> : null}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t("ap.payment.bills")} size="sm">
          <ul className="flex flex-col">
            {shares.map(({ a, bill }) => (
              <li key={a.billId} className="flex items-center justify-between gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0">
                {bill ? <DocLink docType="vendorBills" docId={bill.id} docNo={bill.billNo} /> : a.billId}
                <MoneyText poisha={a.amountP} className="font-mono" />
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title={t("ap.payment.certificates")} size="sm">
          <dl className="flex flex-col gap-2 text-[0.8125rem]">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("ap.payment.vdsCert")}</dt>
              <dd lang="en" className="font-mono" data-testid="vds-certificate-no">
                {p.vdsCertificateNo ?? "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("ap.payment.tdsCert")}</dt>
              <dd lang="en" className="font-mono">
                {p.aitCertificateNo ?? "-"}
              </dd>
            </div>
            {data.cheque ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ap.payment.cheque")}</dt>
                <dd className="flex items-center gap-2">
                  <DocLink docType="cheques" docId={data.cheque.id} docNo={data.cheque.chequeNo} />
                  <DocStatus status={data.cheque.status} />
                </dd>
              </div>
            ) : p.chequeNo ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("ap.payment.cheque")}</dt>
                <dd lang="en" className="font-mono">
                  {p.chequeNo}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("ap.payment.preparedBy")}</dt>
              <dd>{userName(users.get(p.preparedBy), locale)}</dd>
            </div>
          </dl>
        </SectionCard>
      </div>
      {p.journalId ? (
        <SectionCard title={t("ap.payment.journal")} size="sm">
          <VoucherView journalId={p.journalId} />
        </SectionCard>
      ) : null}

      <PrintDialog open={print === "vds"} onOpenChange={(o) => !o && setPrint(null)} title={t("ap.payment.printCertificate")} docNo={p.vdsCertificateNo ?? p.paymentNo} testId="certificate-dialog">
        <PrintLayout showBrand={false}>
          <TaxDocHeader form="6.6" docNo={p.vdsCertificateNo ?? ""} issuedAt={dmyLatin(p.date)} />
          <div className="flex flex-col gap-3 text-[0.75rem]" data-testid="certificate-sheet">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <BiLabel bn="সরবরাহকারী" en="Supplier" />
                <div className="font-semibold">{vendor?.nameEn}</div>
                <div lang="en">BIN {vendor?.bin ?? "-"}</div>
              </div>
              <div>
                <BiLabel bn="কর্তনকারী" en="Deducted by" />
                <div className="font-semibold">{tenant.legalName.en}</div>
                <div lang="en">BIN {tenant.bin}</div>
              </div>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-[#111]">
                  <th className="py-1 text-left">
                    <BiLabel bn="সরবরাহকারীর চালান" en="Supplier invoice" />
                  </th>
                  <th className="py-1 text-right">
                    <BiLabel bn="মূসক ব্যতীত মূল্য" en="Value excluding VAT" />
                  </th>
                  <th className="py-1 text-right">
                    <BiLabel bn="মূসক" en="VAT" />
                  </th>
                  <th className="py-1 text-right">
                    <BiLabel bn="কর্তিত মূসক" en="VAT deducted" />
                  </th>
                </tr>
              </thead>
              <tbody lang="en">
                {shares.map(({ a, bill, exclusiveP, vatP }) => (
                  <tr key={a.billId} className="border-b border-[#e0e0e0]">
                    <td className="py-1 font-mono">
                      {bill?.vendorRef} ({bill?.billNo}), {bill ? dmyLatin(bill.date) : ""}
                    </td>
                    <td className="py-1 text-right font-mono">{latin(exclusiveP)}</td>
                    <td className="py-1 text-right font-mono">{latin(vatP)}</td>
                    <td className="py-1 text-right font-mono">{latin(vatP)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot lang="en">
                <tr className="border-t-2 border-[#111] font-semibold">
                  <td className="py-1">
                    <BiLabel bn="মোট" en="Total" />
                  </td>
                  <td className="py-1 text-right font-mono">{latin(shares.reduce((s, x) => s + x.exclusiveP, 0))}</td>
                  <td className="py-1 text-right font-mono">{latin(shares.reduce((s, x) => s + x.vatP, 0))}</td>
                  <td className="py-1 text-right font-mono">{latin(p.vdsP)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="italic">{amountInWords(p.vdsP, "en")}</div>
            <div className="text-[#555]">{t("ap.payment.depositNote")}</div>
            <div className="mt-10 flex justify-end">
              <div className="w-56 border-t border-[#111] pt-1 text-center">
                <BiLabel bn="দায়িত্বপ্রাপ্ত কর্মকর্তার স্বাক্ষর" en="Signature of the responsible officer" />
              </div>
            </div>
          </div>
        </PrintLayout>
      </PrintDialog>

      <PrintDialog open={print === "tds"} onOpenChange={(o) => !o && setPrint(null)} title={t("ap.payment.printTds")} docNo={p.aitCertificateNo ?? p.paymentNo}>
        <PrintLayout title={t("ap.payment.tdsTitle")} docNo={p.aitCertificateNo} meta={dmy(p.date)}>
          <div className="flex flex-col gap-3 text-[0.8125rem]">
            <div>
              {t("ap.payment.supplier")}: <span className="font-semibold">{vendor?.nameEn}</span>{" "}
              <span lang="en" className="font-mono text-xs">
                TIN {vendor?.tin ?? "-"}
              </span>
            </div>
            <div>
              {t("ap.payment.valueExVat")}: <MoneyText poisha={shares.reduce((s, x) => s + x.exclusiveP, 0)} className="font-mono" />
            </div>
            <div className="font-semibold">
              {t("ap.payment.tdsDeducted")}: <MoneyText poisha={p.aitP} className="font-mono" />
            </div>
            <div className="text-xs italic">{amountInWords(p.aitP, locale)}</div>
            <div className="text-xs text-[#555]">{t("ap.payment.depositNote")}</div>
          </div>
        </PrintLayout>
      </PrintDialog>

      <PrintDialog open={print === "voucher"} onOpenChange={(o) => !o && setPrint(null)} title={t("ap.payment.voucherTitle")} docNo={p.paymentNo}>
        <PrintLayout title={t("ap.payment.voucherTitle")} docNo={p.paymentNo} meta={dmy(p.date)}>
          <div className="flex flex-col gap-3 text-[0.8125rem]">
            <div>
              {t("ap.payment.payee")}: <span className="font-semibold">{nameOf(vendor, locale)}</span>{" "}
              <span lang="en" className="font-mono text-xs">
                ({vendor?.code})
              </span>
            </div>
            <table className="w-full border-collapse text-xs">
              <tbody>
                {shares.map(({ a, bill }) => (
                  <tr key={a.billId} className="border-b border-[#e0e0e0]">
                    <td lang="en" className="py-1 font-mono">
                      {bill?.billNo} ({bill?.vendorRef})
                    </td>
                    <td className="py-1 text-right">
                      <MoneyText poisha={a.amountP} className="font-mono" />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1">{t("ap.payment.ait")}</td>
                  <td className="py-1 text-right">
                    − <MoneyText poisha={p.aitP} className="font-mono" />
                  </td>
                </tr>
                <tr>
                  <td className="py-1">{t("ap.payment.vds")}</td>
                  <td className="py-1 text-right">
                    − <MoneyText poisha={p.vdsP} className="font-mono" />
                  </td>
                </tr>
                <tr className="border-t-2 border-[#111] font-semibold">
                  <td className="py-1">{t("ap.payment.net")}</td>
                  <td className="py-1 text-right">
                    <MoneyText poisha={p.netPaidP} className="font-mono" />
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="text-xs italic">{amountInWords(p.netPaidP, locale)}</div>
            <div className="text-xs">
              {tk(`ap.method.${p.method}`)} · {nameOf(data.account, locale)}
              {p.chequeNo ? (
                <span lang="en" className="font-mono">
                  {" "}
                  · {p.chequeNo}
                </span>
              ) : null}
            </div>
            <div className="mt-10 grid grid-cols-3 gap-4 text-center text-xs">
              {[t("ap.payment.preparedSign"), t("ap.payment.approvedSign"), t("ap.payment.receivedSign")].map((s) => (
                <div key={s} className="border-t border-[#111] pt-1">
                  {s}
                </div>
              ))}
            </div>
          </div>
        </PrintLayout>
      </PrintDialog>
    </div>
  )
}
