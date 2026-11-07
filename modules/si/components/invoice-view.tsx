"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { FileText, MessageSquareWarning, Printer, Receipt, Undo2 } from "lucide-react"

import { ApprovalChip } from "@/components/shared/approval-chip"
import { DateText } from "@/components/shared/date-text"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { RegPlate } from "@/components/shared/reg-plate"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { locationById } from "@/config/brand.config"
import { invoiceAvailable, invoiceOpen } from "@/core/ar/receipt"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { DocHeader, PrintDialog, TotalsBlock, useUserMap } from "@/modules/stl/components/kit"

import { CreditNoteDialog } from "./credit-note-dialog"
import { Mushak63 } from "./mushak"

/**
 * /si/[id]: the tax invoice with its lines (vehicles on consolidated
 * invoices), amounts (advance applied, paid, credited, due), linked orders,
 * receipts, credit notes and the voucher; Mushak 6.3 print and the credit
 * note action.
 */
export function InvoiceView({ id }: { id: Id }) {
  const db = useDb()
  const { t, tk, locale, money } = useLocale()
  const users = useUserMap()
  const [printing, setPrinting] = React.useState(false)
  const [crediting, setCrediting] = React.useState(false)
  const data = useLiveQuery(async () => {
    const invoice = await db.salesInvoices.get(id)
    if (!invoice) return null
    const [lines, party, orders, receipts, notes, journals] = await Promise.all([
      db.salesInvoiceLines.where("invoiceId").equals(invoice.id).sortBy("lineNo"),
      db.parties.get(invoice.partyId),
      db.salesOrders.bulkGet(invoice.orderIds),
      db.receipts.where("partyId").equals(invoice.partyId).toArray(),
      db.creditNotes.where("invoiceId").equals(invoice.id).toArray(),
      db.journals.where("source.docId").equals(invoice.id).toArray(),
    ])
    const vehicles = new Map((await db.vehicles.bulkGet([...new Set(lines.map((l) => l.vehicleId).filter((v): v is string => !!v))])).filter(Boolean).map((v) => [v!.id, v!]))
    return {
      invoice,
      lines,
      party,
      orders: orders.filter(Boolean).map((o) => o!),
      receipts: receipts.filter((r) => r.allocations.some((a) => a.invoiceId === invoice.id)),
      notes,
      journals,
      vehicles,
    }
  }, [db, id])
  const canCredit = useCan("si.creditnote.create", data?.invoice.locationId)
  const canCounter = useCan("si.counter.checkout", data?.invoice.locationId)

  if (data === undefined) return null
  if (data === null) return <EmptyState icon={FileText} title={t("si.invoice.notFound")} action={{ label: t("si.pages.home"), href: "/si" }} />
  const { invoice, lines, party, orders, receipts, notes, journals, vehicles } = data
  const due = invoiceOpen(invoice)
  const collectable = invoiceAvailable(invoice) > 0 && invoice.kind === "counter"

  return (
    <div className="flex flex-col gap-4" data-testid="invoice-view">
      <DocHeader
        title={`${t("si.invoice.title")} · ${tk(`reports.enum.invoiceKind.${invoice.kind}`)}`}
        docNo={invoice.invoiceNo}
        status={invoice.status}
        lines={[
          <>
            <span className="font-medium text-foreground">{nameOf(party, locale)}</span>
            {invoice.buyerBin ? <span lang="en" className="font-mono">BIN {invoice.buyerBin}</span> : null}
          </>,
          <>
            <DateText value={invoice.issuedAt} variant="dmyTime" />
            {invoice.dueDate !== invoice.date ? (
              <>
                · {t("si.invoice.dueOn")} <DateText value={invoice.dueDate} />
              </>
            ) : null}
            · {locationById(invoice.locationId)?.name[locale]}
          </>,
        ]}
        amounts={[
          { label: t("common.total"), valueP: invoice.totalP, strong: true, testId: "invoice-total" },
          { label: t("si.invoice.advanceApplied"), valueP: invoice.advanceAppliedP, tone: "muted", testId: "invoice-advance" },
          { label: t("common.paid"), valueP: invoice.paidP, tone: "success" },
          { label: t("si.invoice.credited"), valueP: invoice.creditedP, tone: "muted" },
          { label: t("common.due"), valueP: due, tone: due > 0 ? "destructive" : undefined, testId: "invoice-due" },
        ]}
        actions={
          <>
            <Button onClick={() => setPrinting(true)} data-testid="mushak-print">
              <Printer data-icon="inline-start" />
              {t("si.invoice.printMushak")}
            </Button>
            {canCredit && invoice.kind !== "opening" ? (
              <Button variant="outline" onClick={() => setCrediting(true)} data-testid="credit-note-new">
                <Undo2 data-icon="inline-start" />
                {t("si.invoice.creditNote")}
              </Button>
            ) : null}
            {collectable && canCounter ? (
              <Button variant="outline" nativeButton={false} render={<Link href="/si/counter" />}>
                <Receipt data-icon="inline-start" />
                {t("si.counter.collect")}
              </Button>
            ) : null}
          </>
        }
      />
      {orders
        .filter((o) => o.complaintNote)
        .slice(0, 3)
        .map((o) => (
          <div
            key={o.id}
            className="flex items-start gap-3 rounded-lg bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-4 py-3 text-[0.8125rem]"
            data-testid="invoice-complaint"
          >
            <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">{t("si.invoice.complaint", { no: o.orderNo })}</p>
              <p className="text-muted-foreground">{o.complaintNote}</p>
            </div>
          </div>
        ))}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard title={t("si.invoice.lines")} size="sm">
          <div className="@container/il overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="text-left">
                  <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("common.description")}</th>
                  <th className="bg-surface-raised px-3 py-2 text-right font-medium">{t("common.qty")}</th>
                  <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[34rem]/il:table-cell">{t("common.unitPrice")}</th>
                  <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[28rem]/il:table-cell">{t("common.discount")}</th>
                  <th className="hidden bg-surface-raised px-3 py-2 text-right font-medium @min-[40rem]/il:table-cell">{t("common.vat")}</th>
                  <th className="rounded-r-md bg-surface-raised px-3 py-2 text-right font-medium">{t("common.total")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const v = l.vehicleId ? vehicles.get(l.vehicleId) : undefined
                  return (
                    <tr key={l.id} data-testid="invoice-line">
                      <td className="border-b border-hairline px-3 py-2">
                        <div>{locale === "bn" ? l.descriptionBn : l.descriptionEn}</div>
                        {v && invoice.kind === "consolidated" ? <RegPlate regNo={v.regNo} className="mt-1" /> : null}
                      </td>
                      <td className="border-b border-hairline px-3 py-2 text-right font-mono">{l.qty}</td>
                      <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono @min-[34rem]/il:table-cell">
                        <MoneyText poisha={l.unitPriceP} />
                      </td>
                      <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono text-muted-foreground @min-[28rem]/il:table-cell">
                        {l.discountP ? <MoneyText poisha={-l.discountP} /> : "-"}
                      </td>
                      <td className="hidden border-b border-hairline px-3 py-2 text-right font-mono @min-[40rem]/il:table-cell">
                        <MoneyText poisha={l.vatP} />
                      </td>
                      <td className="border-b border-hairline px-3 py-2 text-right font-mono">
                        <MoneyText poisha={l.netP + l.vatP} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TotalsBlock
            className="mt-4"
            rows={[
              { label: t("common.subtotal"), valueP: invoice.subtotalP },
              { label: t("common.discount"), valueP: invoice.discountP, negative: true },
              { label: t("common.vat"), valueP: invoice.vatP },
              { label: t("common.total"), valueP: invoice.totalP, strong: true },
            ]}
          />
        </SectionCard>
        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("stl.linked")} size="sm">
            <ul className="flex flex-col gap-2 text-[0.8125rem]" data-testid="linked-docs">
              {orders.slice(0, 8).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("stl.pages.order")}</span>
                  <DocLink docType="salesOrders" docId={o.id} docNo={o.orderNo} />
                </li>
              ))}
              {orders.length > 8 ? <li className="text-xs text-muted-foreground">{t("si.invoice.moreOrders", { count: orders.length - 8 })}</li> : null}
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {tk(`reports.enum.method.${r.method}`)} · {money(r.allocations.find((a) => a.invoiceId === invoice.id)?.amountP ?? 0)}
                    <DocStatus status={r.status} />
                  </span>
                  <DocLink docType="receipts" docId={r.id} docNo={r.receiptNo} />
                </li>
              ))}
              {notes.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {t("si.pages.creditNotes")} · {money(n.totalP)} <DocStatus status={n.status} />
                  </span>
                  <DocLink docType="creditNotes" docId={n.id} docNo={n.creditNoteNo} />
                </li>
              ))}
              {journals.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("stl.order.voucher", { rule: j.rule })}</span>
                  <DocLink docType="journals" docId={j.id} docNo={j.journalNo} />
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title={t("stl.order.details")} size="sm">
            <KeyValueGrid
              items={[
                { label: t("si.invoice.issuedBy"), value: userName(users.get(invoice.issuedBy), locale) },
                { label: t("si.invoice.buyer"), value: invoice.buyerNameEn },
                { label: t("si.invoice.reserved"), value: <MoneyText poisha={invoice.reservedP} /> },
                { label: t("si.invoice.printed"), value: String(invoice.printCount) },
              ]}
            />
            {invoice.creditOverrideApprovalId ? <ApprovalChip approvalId={invoice.creditOverrideApprovalId} className="mt-3" /> : null}
          </SectionCard>
        </aside>
      </div>
      <PrintDialog open={printing} onOpenChange={setPrinting} title={t("si.invoice.printMushak")} docNo={invoice.invoiceNo}>
        <Mushak63 invoice={invoice} lines={lines} party={party} vehicles={vehicles} />
      </PrintDialog>
      <CreditNoteDialog invoice={invoice} lines={lines} open={crediting} onOpenChange={setCrediting} />
    </div>
  )
}
