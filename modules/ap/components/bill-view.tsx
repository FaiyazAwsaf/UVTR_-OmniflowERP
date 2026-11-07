"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { FileX2, PauseCircle, Wallet } from "lucide-react"

import { ApprovalChip } from "@/components/shared/approval-chip"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { VoucherView } from "@/components/shared/voucher-view"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { billOpenP } from "@/modules/ar/lib"
import { Banner, LinkButton, Stat } from "@/modules/par/components/kit"

/** /ap/bills/[id]: the bill with its match result, hold and approval, lines and linked documents. */
export function BillView({ billId }: { billId: Id }) {
  const db = useDb()
  const { t, tk, locale, num, dmy } = useLocale()
  const { can } = usePermissions()
  const data = useLiveQuery(async () => {
    const bill = await db.vendorBills.get(billId)
    if (!bill) return null
    const [vendor, lines, po, grns, approval, debitNotes, payments] =
      await Promise.all([
        db.parties.get(bill.partyId),
        db.vendorBillLines.where("billId").equals(bill.id).toArray(),
        bill.poId ? db.purchaseOrders.get(bill.poId) : undefined,
        db.grns.bulkGet(bill.grnIds),
        bill.holdApprovalId ? db.approvals.get(bill.holdApprovalId) : undefined,
        db.debitNotes.where("billId").equals(bill.id).toArray(),
        db.vendorPayments.where("partyId").equals(bill.partyId).toArray(),
      ])
    const items = new Map(
      (
        await db.items.bulkGet([
          ...new Set(lines.flatMap((l) => (l.itemId ? [l.itemId] : []))),
        ])
      )
        .filter(Boolean)
        .map((i) => [i!.id, i!])
    )
    return {
      bill,
      vendor,
      lines: lines.sort((a, b) => a.lineNo - b.lineNo),
      po,
      grns: grns.filter(Boolean).map((g) => g!),
      approval,
      debitNotes,
      payments: payments.filter((p) =>
        p.allocations.some((a) => a.billId === bill.id)
      ),
      items,
    }
  }, [db, billId])

  if (data === undefined) return null
  if (data === null)
    return (
      <EmptyState
        icon={FileX2}
        title={t("ap.bill.notFound")}
        action={{ label: t("ap.pages.bills"), href: "/ap/bills" }}
      />
    )
  const { bill } = data
  const open = billOpenP(bill)
  const rejected = data.approval?.status === "rejected"

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="bill-view"
      data-bill-no={bill.billNo}
    >
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 lang="en" className="font-mono text-xl font-semibold">
                {bill.billNo}
              </h1>
              <span data-testid="bill-status" data-status={bill.status}>
                <DocStatus status={bill.status} />
              </span>
              {bill.matchStatus !== "n-a" ? (
                <DocStatus status={bill.matchStatus} />
              ) : null}
            </div>
            <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
              <Link
                href={`/par/${bill.partyId}`}
                className="text-link hover:underline"
              >
                {nameOf(data.vendor, locale)}
              </Link>
              <span>·</span>
              <span>
                {t("ap.bill.vendorRef")}{" "}
                <span lang="en" className="font-mono">
                  {bill.vendorRef}
                </span>
              </span>
              <span>·</span>
              <span>{tk(`reports.enum.billKind.${bill.kind}`)}</span>
              <span>·</span>
              <span>
                {t("ap.bill.mushak")}:{" "}
                {bill.hasMushak63 ? t("ap.bill.yes") : t("ap.bill.no")}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can("ap.payment.create") &&
            open > 0 &&
            bill.status !== "on-hold" ? (
              <LinkButton
                href={`/ap/payments/new?party=${bill.partyId}&bill=${bill.id}`}
                size="sm"
                testId="bill-pay"
              >
                <Wallet />
                {t("ap.bill.pay")}
              </LinkButton>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-surface-raised/50 p-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t("ap.bill.date")} value={dmy(bill.date)} />
          <Stat label={t("ap.bill.due")} value={dmy(bill.dueDate)} />
          <Stat
            label={t("ap.bill.total")}
            value={<MoneyText poisha={bill.totalP} />}
          />
          <Stat
            label={t("ap.bill.paid")}
            value={<MoneyText poisha={bill.paidP} />}
          />
          <Stat
            label={t("ap.bill.debited")}
            value={<MoneyText poisha={bill.debitedP} />}
          />
          <Stat
            label={t("ap.bill.open")}
            value={<MoneyText poisha={open} />}
            tone={open > 0 ? "warning" : "success"}
            testId="bill-open"
          />
        </div>
        {bill.status === "on-hold" ? (
          <Banner
            icon={<PauseCircle />}
            tone={rejected ? "destructive" : "warning"}
            testId="bill-hold-banner"
          >
            <p>
              {rejected
                ? t("ap.bill.rejectedBanner")
                : t("ap.bill.onHoldBanner")}
            </p>
          </Banner>
        ) : null}
        {bill.holdApprovalId ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("ap.bill.approval")}
            </span>
            <ApprovalChip approvalId={bill.holdApprovalId} />
          </div>
        ) : null}
      </section>

      {bill.kind === "goods" || bill.matchStatus !== "n-a" ? (
        <SectionCard title={t("ap.bill.match")} size="sm">
          {bill.matchDiffs.length ? (
            <ul className="flex flex-col gap-1.5" data-testid="bill-diffs">
              {bill.matchDiffs.map((d, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]"
                  data-testid="match-diff"
                  data-field={d.field}
                >
                  <StatusText tone="warning" dot>
                    {d.field === "qty"
                      ? t("ap.form.qtyDiff", {
                          actual: num(d.actual),
                          expected: num(d.expected),
                        })
                      : t("ap.form.priceDiff", {
                          pct: `${(d.diffPct ?? 0) > 0 ? "+" : ""}${num(d.diffPct ?? 0, { maximumFractionDigits: 2 })}`,
                        })}
                  </StatusText>
                  <span className="text-muted-foreground">
                    {nameOf(data.items.get(d.itemId ?? ""), locale)}
                  </span>
                  {d.field === "price" ? (
                    <span className="text-xs text-muted-foreground">
                      {t("ap.bill.expected")}{" "}
                      <MoneyText poisha={d.expected} className="font-mono" /> ·{" "}
                      {t("ap.bill.actual")}{" "}
                      <MoneyText poisha={d.actual} className="font-mono" />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <StatusText tone="success" dot>
              {t("ap.bill.noDiffs")}
            </StatusText>
          )}
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <SectionCard title={t("ap.bill.lines")} size="sm">
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="[&>th]:h-9 [&>th]:bg-surface-raised [&>th]:px-2 [&>th]:font-medium">
                  <th className="rounded-l-md text-left">
                    {t("ap.form.colDescription")}
                  </th>
                  <th className="text-right">{t("common.qty")}</th>
                  <th className="text-right">{t("common.unitPrice")}</th>
                  <th className="hidden text-right sm:table-cell">
                    {t("common.vat")}
                  </th>
                  <th className="rounded-r-md text-right">{t("common.net")}</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr
                    key={l.id}
                    className="[&>td]:border-b [&>td]:border-hairline [&>td]:px-2 [&>td]:py-2"
                  >
                    <td>
                      <div className="flex flex-col">
                        <span>
                          {l.itemId
                            ? nameOf(data.items.get(l.itemId), locale)
                            : l.description}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {l.expenseTag
                            ? tk(`ap.expenseTag.${l.expenseTag}`)
                            : data.items.get(l.itemId ?? "")?.sku}
                        </span>
                      </div>
                    </td>
                    <td className="nums text-right">
                      {num(l.qty, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="text-right">
                      <MoneyText poisha={l.unitPriceP} className="font-mono" />
                    </td>
                    <td className="hidden text-right sm:table-cell">
                      <MoneyText poisha={l.vatP} className="font-mono" />
                    </td>
                    <td className="text-right">
                      <MoneyText poisha={l.netP} className="font-mono" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold [&>td]:px-2 [&>td]:py-2">
                  <td colSpan={3}>{t("ap.form.total")}</td>
                  <td className="hidden text-right sm:table-cell">
                    <MoneyText poisha={bill.inputVatP} className="font-mono" />
                  </td>
                  <td className="text-right">
                    <MoneyText
                      poisha={data.lines.reduce((sum, l) => sum + l.netP, 0)}
                      className="font-mono"
                    />
                  </td>
                </tr>
                {/* The net column sums the lines; the bill's own total (with VAT) gets its own row. */}
                <tr className="font-semibold [&>td]:px-2 [&>td]:py-2">
                  <td colSpan={3}>{t("ap.bill.grossTotal")}</td>
                  <td className="hidden sm:table-cell" />
                  <td className="text-right">
                    <MoneyText poisha={bill.totalP} className="font-mono" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>
        <SectionCard title={t("ap.bill.linked")} size="sm">
          <dl
            className="flex flex-col gap-2 text-[0.8125rem]"
            data-testid="bill-linked"
          >
            {data.po ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t("ap.bill.po")}</dt>
                <dd>
                  <DocLink
                    docType="purchaseOrders"
                    docId={data.po.id}
                    docNo={data.po.poNo}
                  />
                </dd>
              </div>
            ) : null}
            {data.grns.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-2"
              >
                <dt className="text-muted-foreground">{t("ap.bill.grn")}</dt>
                <dd>
                  <DocLink docType="grns" docId={g.id} docNo={g.grnNo} />
                </dd>
              </div>
            ))}
            {data.payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2"
              >
                <dt className="text-muted-foreground">
                  {t("ap.bill.payments")}
                </dt>
                <dd className="flex items-center gap-2">
                  <DocLink
                    docType="vendorPayments"
                    docId={p.id}
                    docNo={p.paymentNo}
                  />
                  <DocStatus status={p.status} />
                </dd>
              </div>
            ))}
            {data.debitNotes.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2"
              >
                <dt className="text-muted-foreground">
                  {t("ap.bill.debited")}
                </dt>
                <dd>
                  <DocLink
                    docType="debitNotes"
                    docId={d.id}
                    docNo={d.debitNoteNo}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>
      {bill.journalId ? (
        <SectionCard title={t("ap.bill.journal")} size="sm">
          <VoucherView journalId={bill.journalId} />
        </SectionCard>
      ) : null}
    </div>
  )
}
