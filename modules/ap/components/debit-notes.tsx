"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { FileMinus, Printer } from "lucide-react"

import { DocLink } from "@/components/shared/doc-link"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PrintLayout } from "@/components/shared/print-layout"
import { BiLabel, TaxDocHeader } from "@/components/shared/tax-doc-header"
import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { DebitNoteRow, PartyRow, VendorBillRow } from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { formatMoney } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"

import { CsvButton, ListTable, type Column } from "@/modules/par/components/kit"
import { PrintDialog } from "@/modules/par/components/print-dialog"

type Row = { note: DebitNoteRow; vendor: PartyRow | undefined; bill: VendorBillRow | undefined }
const latin = (p: number) => formatMoney(p, "en")
const dmyLatin = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

/** /ap/debit-notes: debit notes from purchase returns, with the Mushak 6.8 print (plan §9). */
export function DebitNotes() {
  const db = useDb()
  const params = useSearchParams()
  const focus = params.get("id")
  const { t, locale, dmy } = useLocale()
  const [printing, setPrinting] = React.useState<Row | null>(null)
  const data = useLiveQuery(async () => {
    const notes = await db.debitNotes.toArray()
    const vendors = new Map((await db.parties.bulkGet([...new Set(notes.map((n) => n.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const bills = new Map((await db.vendorBills.bulkGet(notes.flatMap((n) => (n.billId ? [n.billId] : [])))).filter(Boolean).map((b) => [b!.id, b!]))
    return notes.sort((a, b) => (a.date < b.date ? 1 : -1)).map((note) => ({ note, vendor: vendors.get(note.partyId), bill: note.billId ? bills.get(note.billId) : undefined }))
  }, [db])

  const columns: Column<Row>[] = [
    { key: "date", header: t("ap.debitNotes.colDate"), sortValue: (r) => r.note.date, cell: (r) => <span className="nums">{dmy(r.note.date)}</span> },
    { key: "no", header: t("ap.debitNotes.colNo"), cell: (r) => <span lang="en" className="font-mono">{r.note.debitNoteNo}</span> },
    { key: "vendor", header: t("ap.debitNotes.colVendor"), hide: "sm", cell: (r) => nameOf(r.vendor, locale) },
    { key: "bill", header: t("ap.debitNotes.colBill"), hide: "md", cell: (r) => (r.bill ? <DocLink docType="vendorBills" docId={r.bill.id} docNo={r.bill.billNo} showApp={false} /> : "-") },
    { key: "reason", header: t("ap.debitNotes.colReason"), hide: "lg", cell: (r) => <span className="line-clamp-1 text-muted-foreground">{r.note.reason}</span> },
    { key: "total", header: t("ap.debitNotes.colTotal"), align: "right", sortValue: (r) => r.note.totalP, cell: (r) => <MoneyText poisha={r.note.totalP} className="font-mono" /> },
    {
      key: "print",
      header: "",
      cell: (r) => (
        <Button size="xs" variant="ghost" className="text-link" onClick={() => setPrinting(r)} data-testid="debit-note-print">
          <Printer />
          <span className="hidden @min-[40rem]/list:inline">{t("ap.debitNotes.print")}</span>
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="debit-notes">
      <PageHeader
        title={t("ap.pages.debitNotes")}
        subtitle={t("ap.debitNotes.subtitle")}
        actions={
          <CsvButton
            exportKey="ap.export"
            fileName="debit-notes"
            rows={(data ?? []).map((r) => ({ date: r.note.date, no: r.note.debitNoteNo, vendor: r.vendor?.nameEn ?? "", netP: r.note.netP, vatP: r.note.vatP, totalP: r.note.totalP, reason: r.note.reason }))}
            columns={[
              { key: "date", label: t("ap.debitNotes.colDate") },
              { key: "no", label: t("ap.debitNotes.colNo") },
              { key: "vendor", label: t("ap.debitNotes.colVendor") },
              { key: "netP", label: t("ap.debitNotes.colNet") },
              { key: "vatP", label: t("ap.debitNotes.colVat") },
              { key: "totalP", label: t("ap.debitNotes.colTotal") },
              { key: "reason", label: t("ap.debitNotes.colReason") },
            ]}
          />
        }
      />
      <section className="surface-card p-4 md:p-5">
        <ListTable
          rows={data}
          columns={columns}
          rowKey={(r) => r.note.id}
          rowTestId="debit-note-row"
          rowClassName={(r) => (r.note.id === focus ? "bg-primary-soft" : undefined)}
          empty={<EmptyState icon={FileMinus} title={t("ap.debitNotes.empty")} size="sm" />}
        />
      </section>
      {printing ? (
        <PrintDialog open onOpenChange={(o) => !o && setPrinting(null)} title={t("ap.debitNotes.print")} docNo={printing.note.debitNoteNo}>
          <PrintLayout showBrand={false}>
            <TaxDocHeader form="6.8" docNo={printing.note.debitNoteNo} issuedAt={dmyLatin(printing.note.date)} />
            <div className="flex flex-col gap-3 text-[0.75rem]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <BiLabel bn="সরবরাহকারী" en="Supplier" />
                  <div className="font-semibold">{printing.vendor?.nameEn}</div>
                  <div lang="en">BIN {printing.vendor?.bin ?? "-"}</div>
                </div>
                <div>
                  <BiLabel bn="মূল চালান" en="Original invoice" />
                  <div lang="en" className="font-mono">
                    {printing.bill ? `${printing.bill.vendorRef} (${printing.bill.billNo}), ${dmyLatin(printing.bill.date)}` : "-"}
                  </div>
                </div>
              </div>
              <div>
                <BiLabel bn="কারণ" en="Reason" />
                <div>{printing.note.reason}</div>
              </div>
              <table className="w-full border-collapse" lang="en">
                <tbody>
                  <tr className="border-y border-[#111]">
                    <td className="py-1">
                      <BiLabel bn="মূসক ব্যতীত মূল্য" en="Value excluding VAT" />
                    </td>
                    <td className="py-1 text-right font-mono">{latin(printing.note.netP)}</td>
                  </tr>
                  <tr className="border-b border-[#e0e0e0]">
                    <td className="py-1">
                      <BiLabel bn="মূসক" en="VAT" />
                    </td>
                    <td className="py-1 text-right font-mono">{latin(printing.note.vatP)}</td>
                  </tr>
                  <tr className="border-b-2 border-[#111] font-semibold">
                    <td className="py-1">
                      <BiLabel bn="মোট" en="Total" />
                    </td>
                    <td className="py-1 text-right font-mono">{latin(printing.note.totalP)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </PrintLayout>
        </PrintDialog>
      ) : null}
    </div>
  )
}
