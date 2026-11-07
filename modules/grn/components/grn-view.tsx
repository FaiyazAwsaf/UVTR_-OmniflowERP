"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Printer, Undo2 } from "lucide-react"

import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { locationById } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { isoToDmy } from "@/lib/i18n/dmy"
import { formatMoney, formatNumber } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { JournalLink } from "@/modules/ic/components/count-detail"
import { DocHeader, HIDE, ItemCell, LinesTable, NotFound, PrintPreview, useScmLookups } from "@/modules/ic/components/scm-ui"

/** /grn/[id]: the GRN with its lots, QC results, the R12 voucher, and the GRN print. */
export function GrnView({ id }: { id: string }) {
  const db = useDb()
  const { t, tk, locale, num, dmy, time, money } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const [printing, setPrinting] = React.useState(false)
  const data = useLiveQuery(async () => {
    const grn = await db.grns.get(id)
    if (!grn) return { grn: undefined }
    const [po, lines, returns] = await Promise.all([
      db.purchaseOrders.get(grn.poId),
      db.grnLines.where("grnId").equals(id).toArray(),
      db.purchaseReturns.where("grnId").equals(id).toArray(),
    ])
    const acceptJournals = (await db.journals.where("source.docId").equals(id).toArray()).filter((j) => j.id !== grn.journalId)
    return { grn, po, lines, returns, acceptJournals }
  }, [db, id])

  if (data === undefined || !lookups) return null
  if (!data.grn) return <NotFound title={t("grn.view.notFound")} backHref="/grn" backLabel={t("grn.view.back")} />
  const { grn, po, lines, returns, acceptJournals } = data
  const vendor = lookups.vendors.get(grn.vendorId)
  const totalP = lines.reduce((s, l) => s + Math.round(l.qtyAccepted * l.unitCostP), 0)
  const returnable = lines.some((l) => l.qtyAccepted - l.qtyReturned > 0)

  return (
    <div className="flex flex-col gap-5" data-testid="grn-view">
      <DocHeader
        kind={t("grn.view.kind")}
        docNo={grn.grnNo}
        lines={[
          nameOf(vendor, locale),
          t("grn.view.receivedBy", { name: userName(lookups.users.get(grn.receivedBy), locale), time: `${dmy(grn.receivedAt)} ${time(grn.receivedAt)}` }),
          grn.vendorChallanNo ? t("grn.view.challan", { no: grn.vendorChallanNo }) : undefined,
        ]}
        amounts={[{ label: t("grn.view.total"), value: money(totalP) }]}
        actions={
          <>
            <Button variant="neutral" onClick={() => setPrinting(true)} data-testid="grn-print">
              <Printer />
              {t("grn.view.print")}
            </Button>
            {returnable && can("ptl.return.create", grn.locationId) ? (
              <Link href={`/ptl/returns?grn=${grn.id}`} className={buttonVariants({ variant: "outline" })} data-testid="grn-return">
                <Undo2 />
                {t("grn.view.returnGoods")}
              </Link>
            ) : null}
          </>
        }
        links={
          <>
            {po ? <DocLink docType="purchaseOrders" docId={po.id} docNo={po.poNo} /> : null}
            {grn.journalId ? <JournalLink journalId={grn.journalId} /> : null}
            {acceptJournals.map((j) => (
              <DocLink key={j.id} docType="journals" docId={j.id} docNo={j.journalNo} />
            ))}
            {returns.map((r) => (
              <DocLink key={r.id} docType="purchaseReturns" docId={r.id} docNo={r.returnNo} />
            ))}
          </>
        }
      />
      <SectionCard title={t("grn.pages.grn")}>
        <LinesTable
          head={[
            { label: t("grn.view.item") },
            { label: t("grn.view.batch"), hide: "md" },
            { label: t("grn.view.accepted"), align: "right" },
            { label: t("grn.view.rejected"), align: "right" },
            { label: t("grn.view.quarantine"), hide: "sm" },
            { label: t("grn.view.unitCost"), align: "right", hide: "lg" },
            { label: t("grn.view.value"), align: "right", hide: "sm" },
          ]}
        >
          {lines.map((l) => {
            const item = lookups.items.get(l.itemId)
            return (
              <tr key={l.id} data-testid="grn-view-line" data-sku={item?.sku}>
                <td>
                  <ItemCell item={item} />
                  {l.qtyReturned ? (
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {t("grn.view.returned")} {num(l.qtyReturned)}
                    </span>
                  ) : null}
                </td>
                <td className={HIDE.md}>
                  <span lang="en" className="font-mono text-xs">
                    {l.batchNo ?? "-"}
                  </span>
                  {l.expiry ? <span className="block text-[0.6875rem] text-muted-foreground">{dmy(l.expiry)}</span> : null}
                </td>
                <td className="text-right nums">
                  {num(l.qtyAccepted)} <span className="text-xs text-muted-foreground">{item?.purchaseUom}</span>
                </td>
                <td className={cn("text-right nums", l.qtyRejected ? "text-warning" : "text-muted-foreground")}>
                  {num(l.qtyRejected)}
                  {l.rejectReason ? <span className="block text-[0.6875rem]">{tk(`grn.reason.${l.rejectReason}`)}</span> : null}
                </td>
                <td className={HIDE.sm}>{l.quarantineStatus ? <DocStatus status={l.quarantineStatus} /> : "-"}</td>
                <td className={cn("text-right", HIDE.lg)}>
                  <MoneyText poisha={l.unitCostP} />
                </td>
                <td className={cn("text-right", HIDE.sm)}>
                  <MoneyText poisha={Math.round(l.qtyAccepted * l.unitCostP)} />
                </td>
              </tr>
            )
          })}
        </LinesTable>
      </SectionCard>
      <PrintPreview open={printing} onOpenChange={setPrinting} title={t("grn.view.print")} docNo={grn.grnNo}>
        <PrintLayout
          title={t("grn.view.printTitle")}
          docNo={grn.grnNo}
          location={locationById(grn.locationId)?.code}
          meta={
            <>
              <div>{isoToDmy(grn.date)}</div>
              <div>{vendor?.nameEn}</div>
              <div lang="en">{po?.poNo}</div>
            </>
          }
        >
          <table className="w-full border-collapse text-[0.75rem]" data-testid="grn-print-sheet">
            <thead>
              <tr className="border-y border-[#111] text-left">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">{t("grn.view.item")}</th>
                <th className="py-1 pr-2">{t("grn.view.batch")}</th>
                <th className="py-1 pr-2">{t("grn.view.expiry")}</th>
                <th className="py-1 pr-2 text-right">{t("grn.view.accepted")}</th>
                <th className="py-1 pr-2 text-right">{t("grn.view.rejected")}</th>
                <th className="py-1 pr-2 text-right">{t("grn.view.unitCost")}</th>
                <th className="py-1 text-right">{t("grn.view.value")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = lookups.items.get(l.itemId)
                return (
                  <tr key={l.id} className="border-b border-[#ddd]">
                    <td className="py-1 pr-2 font-mono">{i + 1}</td>
                    <td className="py-1 pr-2">
                      {nameOf(item, locale)} <span className="font-mono text-[0.6875rem]">{item?.sku}</span>
                    </td>
                    <td className="py-1 pr-2 font-mono">{l.batchNo ?? "-"}</td>
                    <td className="py-1 pr-2 font-mono">{l.expiry ? isoToDmy(l.expiry) : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {formatNumber(l.qtyAccepted, "en")} {item?.purchaseUom}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {formatNumber(l.qtyRejected, "en")}
                      {l.rejectReason ? ` (${tk(`grn.reason.${l.rejectReason}`)})` : ""}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{formatMoney(l.unitCostP, "en")}</td>
                    <td className="py-1 text-right font-mono">{formatMoney(Math.round(l.qtyAccepted * l.unitCostP), "en")}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#111] font-semibold">
                <td colSpan={7} className="py-1">
                  {t("grn.view.total")}
                </td>
                <td className="py-1 text-right font-mono">{formatMoney(totalP, "en")}</td>
              </tr>
            </tfoot>
          </table>
          <div className="mt-12 w-56 border-t border-[#111] pt-1 text-[0.75rem]">
            {t("grn.view.signature")}: {lookups.users.get(grn.receivedBy)?.nameEn}
          </div>
        </PrintLayout>
      </PrintPreview>
    </div>
  )
}
