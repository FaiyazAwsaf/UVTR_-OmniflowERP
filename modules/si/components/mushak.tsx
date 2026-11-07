"use client"

import { amountInWords } from "@/components/shared/amount-in-words"
import { PrintLayout } from "@/components/shared/print-layout"
import { QrCode } from "@/components/shared/qr-code"
import { BiLabel, TaxDocHeader } from "@/components/shared/tax-doc-header"
import { locationById, tenant } from "@/config/brand.config"
import { dhakaTime } from "@/core/clock/dates"
import type { CreditNoteRow, PartyRow, ReceiptRow, SalesInvoiceLineRow, SalesInvoiceRow, VehicleRow } from "@/core/db/schema"
import { formatMoney } from "@/lib/i18n/format"
import { isoToDmy } from "@/lib/i18n/dmy"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Printed tax documents (accounting_rules.md §4.4): Mushak 6.3 tax invoice
 * and 6.7 credit note with bilingual labels (Bangla first, English below)
 * and Latin numbers, the seller and buyer with BIN, amounts in words and a
 * QR code; the 80 mm counter receipt. Never themed: white paper.
 */

const latin = (p: number) => formatMoney(p, "en")
const th = "border border-[#111] px-1.5 py-1 text-left align-bottom font-medium"
const td = "border border-[#111] px-1.5 py-1 align-top"
const num = `${td} text-right font-mono`

function issuedAt(ms: number) {
  return `${isoToDmy(new Date(ms + 6 * 3600_000).toISOString().slice(0, 10))} ${dhakaTime(ms)}`
}

function Buyer({ party, invoice }: { party?: PartyRow; invoice: Pick<SalesInvoiceRow, "buyerNameEn" | "buyerBin"> }) {
  const address = party?.addresses[0]
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 text-[0.75rem]">
      <div>
        <BiLabel bn="ক্রেতার নাম" en="Buyer" />
        <div className="font-semibold">{invoice.buyerNameEn}</div>
        {party?.nameBn && party.nameBn !== invoice.buyerNameEn ? <div>{party.nameBn}</div> : null}
        {address ? (
          <div>
            {address.line}, {address.area}, {address.city}
          </div>
        ) : null}
      </div>
      <div className="text-right">
        <BiLabel bn="ক্রেতার বিআইএন" en="Buyer BIN" />
        <div lang="en" className="font-mono">{invoice.buyerBin ?? "-"}</div>
        {party?.phone ? (
          <div lang="en" className="font-mono">
            {party.phone}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Mushak 6.3: the tax invoice. */
export function Mushak63({
  invoice,
  lines,
  party,
  vehicles,
}: {
  invoice: SalesInvoiceRow
  lines: SalesInvoiceLineRow[]
  party?: PartyRow
  vehicles: Map<string, VehicleRow>
}) {
  const loc = locationById(invoice.locationId)?.code
  const due = invoice.totalP - invoice.advanceAppliedP
  return (
    <PrintLayout showBrand={false} demoFooter={false} footer={<span>{tenant.helpline}</span>}>
      <div data-testid="mushak-63">
        <TaxDocHeader form="6.3" docNo={invoice.invoiceNo} issuedAt={issuedAt(invoice.issuedAt)} location={loc} />
        <Buyer party={party} invoice={invoice} />
        <table className="w-full border-collapse text-[0.6875rem]">
          <thead>
            <tr>
              <th className={th}><BiLabel bn="ক্রমিক" en="No." /></th>
              <th className={th}><BiLabel bn="পণ্য বা সেবার বর্ণনা" en="Description of goods or services" /></th>
              <th className={`${th} text-right`}><BiLabel bn="পরিমাণ" en="Qty" /></th>
              <th className={`${th} text-right`}><BiLabel bn="একক মূল্য" en="Unit price" /></th>
              <th className={`${th} text-right`}><BiLabel bn="মোট মূল্য" en="Value" /></th>
              <th className={`${th} text-right`}><BiLabel bn="ছাড়" en="Discount" /></th>
              <th className={`${th} text-right`}><BiLabel bn="করযোগ্য মূল্য" en="Taxable value" /></th>
              <th className={`${th} text-right`}><BiLabel bn="মূসক হার" en="VAT rate" /></th>
              <th className={`${th} text-right`}><BiLabel bn="মূসক" en="VAT" /></th>
              <th className={`${th} text-right`}><BiLabel bn="সর্বমোট" en="Total" /></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const v = l.vehicleId ? vehicles.get(l.vehicleId) : undefined
              return (
                <tr key={l.id}>
                  <td className={num}>{i + 1}</td>
                  <td className={td}>
                    <div>{l.descriptionBn}</div>
                    <div className="text-[#555]">{l.descriptionEn}</div>
                    {v ? <div lang="en" className="font-mono text-[0.625rem]">{v.regNo}</div> : null}
                  </td>
                  <td className={num}>{l.qty}</td>
                  <td className={num}>{latin(l.unitPriceP)}</td>
                  <td className={num}>{latin(Math.round(l.qty * l.unitPriceP))}</td>
                  <td className={num}>{l.discountP ? latin(l.discountP) : "-"}</td>
                  <td className={num}>{latin(l.netP)}</td>
                  <td className={num}>{l.vatRatePct}%</td>
                  <td className={num}>{latin(l.vatP)}</td>
                  <td className={num}>{latin(l.netP + l.vatP)}</td>
                </tr>
              )
            })}
            <tr className="font-semibold">
              <td className={td} colSpan={4}>
                <BiLabel bn="মোট" en="Total" />
              </td>
              <td className={num}>{latin(invoice.subtotalP)}</td>
              <td className={num}>{latin(invoice.discountP)}</td>
              <td className={num}>{latin(invoice.subtotalP - invoice.discountP)}</td>
              <td className={td} />
              <td className={num}>{latin(invoice.vatP)}</td>
              <td className={num}>{latin(invoice.totalP)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-4 text-[0.75rem]">
          <div className="flex flex-col gap-1.5">
            <div>
              <BiLabel bn="কথায়" en="In words" />
              <div>{amountInWords(invoice.totalP, "bn")}</div>
              <div className="text-[#555]">{amountInWords(invoice.totalP, "en")}</div>
            </div>
            {invoice.advanceAppliedP ? (
              <div className="flex justify-between gap-4">
                <BiLabel bn="অগ্রিম সমন্বয়" en="Advance applied" />
                <span className="font-mono">{latin(invoice.advanceAppliedP)}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 font-semibold">
              <BiLabel bn="প্রদেয়" en="Amount payable" />
              <span className="font-mono">{latin(due)}</span>
            </div>
            {invoice.dueDate !== invoice.date ? (
              <div className="flex justify-between gap-4">
                <BiLabel bn="পরিশোধের শেষ তারিখ" en="Due date" />
                <span className="font-mono">{isoToDmy(invoice.dueDate)}</span>
              </div>
            ) : null}
          </div>
          <QrCode value={`${invoice.invoiceNo}|${tenant.bin}|${invoice.date}|${(invoice.totalP / 100).toFixed(2)}|${(invoice.vatP / 100).toFixed(2)}`} size={88} />
        </div>
        <div className="mt-10 grid grid-cols-2 gap-10 text-[0.6875rem]">
          <div className="border-t border-[#111] pt-1">
            <BiLabel bn="প্রতিষ্ঠানের দায়িত্বপ্রাপ্ত ব্যক্তির স্বাক্ষর" en="Authorised signature" />
          </div>
          <div className="border-t border-[#111] pt-1">
            <BiLabel bn="ক্রেতার স্বাক্ষর" en="Buyer's signature" />
          </div>
        </div>
      </div>
    </PrintLayout>
  )
}

/** Mushak 6.7: the credit note against an invoice. */
export function Mushak67({
  note,
  invoice,
  lines,
  party,
}: {
  note: CreditNoteRow
  invoice?: SalesInvoiceRow
  lines: SalesInvoiceLineRow[]
  party?: PartyRow
}) {
  const vat = note.lines.reduce((s, l) => s + l.vatP, 0)
  const net = note.lines.reduce((s, l) => s + l.netP, 0)
  return (
    <PrintLayout showBrand={false} demoFooter={false}>
      <div data-testid="mushak-67">
        <TaxDocHeader form="6.7" docNo={note.creditNoteNo} issuedAt={issuedAt(note.createdAt)} location={locationById(note.locationId)?.code} />
        {invoice ? <Buyer party={party} invoice={invoice} /> : null}
        <div className="mb-2 grid grid-cols-2 gap-3 text-[0.75rem]">
          <div>
            <BiLabel bn="মূল কর চালানপত্র" en="Original tax invoice" />
            <div lang="en" className="font-mono">
              {invoice?.invoiceNo} · {invoice ? isoToDmy(invoice.date) : ""}
            </div>
          </div>
          <div className="text-right">
            <BiLabel bn="কারণ" en="Reason" />
            <div>{note.reason}</div>
          </div>
        </div>
        <table className="w-full border-collapse text-[0.6875rem]">
          <thead>
            <tr>
              <th className={th}><BiLabel bn="বর্ণনা" en="Description" /></th>
              <th className={`${th} text-right`}><BiLabel bn="পরিমাণ" en="Qty" /></th>
              <th className={`${th} text-right`}><BiLabel bn="মূল্য" en="Value" /></th>
              <th className={`${th} text-right`}><BiLabel bn="ছাড়" en="Discount" /></th>
              <th className={`${th} text-right`}><BiLabel bn="করযোগ্য মূল্য" en="Taxable value" /></th>
              <th className={`${th} text-right`}><BiLabel bn="মূসক" en="VAT" /></th>
              <th className={`${th} text-right`}><BiLabel bn="মোট" en="Total" /></th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((l) => {
              const line = lines.find((x) => x.id === l.invoiceLineId)
              return (
                <tr key={l.invoiceLineId}>
                  <td className={td}>
                    <div>{line?.descriptionBn}</div>
                    <div className="text-[#555]">{line?.descriptionEn}</div>
                  </td>
                  <td className={num}>{l.qty ?? line?.qty}</td>
                  <td className={num}>{latin(l.grossP)}</td>
                  <td className={num}>{l.discountP ? latin(l.discountP) : "-"}</td>
                  <td className={num}>{latin(l.netP)}</td>
                  <td className={num}>{latin(l.vatP)}</td>
                  <td className={num}>{latin(l.netP + l.vatP)}</td>
                </tr>
              )
            })}
            <tr className="font-semibold">
              <td className={td} colSpan={4}>
                <BiLabel bn="মোট" en="Total" />
              </td>
              <td className={num}>{latin(net)}</td>
              <td className={num}>{latin(vat)}</td>
              <td className={num}>{latin(note.totalP)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 text-[0.75rem]">
          <BiLabel bn="কথায়" en="In words" />
          <div>{amountInWords(note.totalP, "bn")}</div>
          <div className="text-[#555]">{amountInWords(note.totalP, "en")}</div>
        </div>
        <div className="mt-10 border-t border-[#111] pt-1 text-[0.6875rem]">
          <BiLabel bn="প্রতিষ্ঠানের দায়িত্বপ্রাপ্ত ব্যক্তির স্বাক্ষর" en="Authorised signature" />
        </div>
      </div>
    </PrintLayout>
  )
}

/** The 80 mm counter receipt: the invoice, its tenders, change. */
export function CounterReceipt({
  invoice,
  lines,
  receipts,
  partyName,
}: {
  invoice: SalesInvoiceRow
  lines: SalesInvoiceLineRow[]
  receipts: ReceiptRow[]
  partyName: string
}) {
  const { t, tk } = useLocale()
  const loc = locationById(invoice.locationId)?.code
  return (
    <PrintLayout size="receipt" title={t("si.receipt.title")} docNo={invoice.invoiceNo} location={loc} meta={issuedAt(invoice.issuedAt)}>
      <div className="flex flex-col gap-1.5 text-[0.6875rem]" data-testid="counter-receipt">
        <div>{partyName}</div>
        {lines.map((l) => (
          <div key={l.id} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {l.qty !== 1 ? `${l.qty} × ` : ""}
              {l.descriptionEn}
            </span>
            <span className="shrink-0 font-mono">{latin(l.netP + l.vatP)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-dashed border-[#111] pt-1 font-semibold">
          <span>{t("common.total")}</span>
          <span className="font-mono">{latin(invoice.totalP)}</span>
        </div>
        {invoice.advanceAppliedP ? (
          <div className="flex justify-between">
            <span>{t("si.invoice.advanceApplied")}</span>
            <span className="font-mono">-{latin(invoice.advanceAppliedP)}</span>
          </div>
        ) : null}
        {receipts.map((r) => (
          <div key={r.id} className="flex justify-between">
            <span>
              {tk(`reports.enum.method.${r.method}`)} <span lang="en" className="font-mono">{r.receiptNo}</span>
              {r.status === "pending" ? ` (${t("si.counter.pendingShort")})` : ""}
            </span>
            <span className="font-mono">{latin(r.tenderedP ?? r.amountP)}</span>
          </div>
        ))}
        {receipts.some((r) => r.changeP) ? (
          <div className="flex justify-between font-semibold">
            <span>{t("si.counter.change")}</span>
            <span className="font-mono">{latin(receipts.reduce((s, r) => s + (r.changeP ?? 0), 0))}</span>
          </div>
        ) : null}
        <div className="mt-1 text-center text-[0.625rem]">{t("si.receipt.thanks")}</div>
      </div>
    </PrintLayout>
  )
}
