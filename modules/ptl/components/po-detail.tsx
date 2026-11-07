"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Mail, PackageCheck, Printer, ShoppingCart, XCircle } from "lucide-react"
import { toast } from "sonner"

import { AmountInWords } from "@/components/shared/amount-in-words"
import { ApprovalChip } from "@/components/shared/approval-chip"
import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PartyPicker } from "@/components/shared/pickers"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { locationById } from "@/config/brand.config"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { readSetting } from "@/core/db/settings"
import { useDb } from "@/core/db/DbProvider"
import type { Id, PoLineRow, PurchaseOrderRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan, usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { nameOf, userName } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { percentOf, vatRateOf } from "@/core/tax/vat"
import { isoToDmy } from "@/lib/i18n/dmy"
import { formatMoney, formatNumber } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { ItemLinesEditor, newLine, type DraftLine } from "@/modules/ic/components/lines-editor"
import { DocHeader, Field, HIDE, ItemCell, LinesTable, LocationSelect, NotFound, PrintPreview, QtyText, freshKey, useScmLookups } from "@/modules/ic/components/scm-ui"

import { cancelPo, issuePo, sendPo } from "../commands"

/** /ptl/po/[id] ("new" creates): the purchase order with print, simulated email, status, receipts, bills and returns. */
export function PoDetail({ id }: { id: string }) {
  if (id === "new") return <NewPo />
  return <PoView id={id} />
}

/** A direct PO: vendor, deliver-to, expected date and lines; above the buyer's limit it waits for approval. */
function NewPo() {
  const router = useRouter()
  const db = useDb()
  const { t, money } = useLocale()
  const { can } = usePermissions()
  const session = useSession()
  const lookups = useScmLookups()
  const issue = useCommand(issuePo)
  const today = dhakaDate(useNow(60_000))
  const tax = useLiveQuery(() => readSetting(db, "tax"), [db])
  const allowed = (lookups?.stockLocations ?? []).filter((l) => can("ptl.po.create", l.id))
  const [vendorId, setVendorId] = React.useState<Id | null>(null)
  const [location, setLocation] = React.useState<Id | null>(null)
  const loc = location ?? (allowed.find((l) => l.id === session.locationId) ?? allowed.find((l) => l.kind === "store") ?? allowed[0])?.id ?? ""
  const [expected, setExpected] = React.useState("")
  const [send, setSend] = React.useState(true)
  const [lines, setLines] = React.useState<DraftLine[]>([newLine()])
  const priced = lines.map((l) => {
    const item = l.itemId ? lookups?.items.get(l.itemId) : undefined
    const cost = l.costP ?? item?.standardCostP ?? 0
    const net = Math.round((l.qty ?? 0) * cost)
    const vat = item && tax ? percentOf(net, vatRateOf(item.vatCategory, tax)) : 0
    return { net, vat }
  })
  const subtotal = priced.reduce((s, p) => s + p.net, 0)
  const vat = priced.reduce((s, p) => s + p.vat, 0)
  const valid = vendorId && loc && lines.every((l) => l.itemId && l.qty && l.qty > 0)

  return (
    <div className="flex flex-col gap-5" data-testid="po-editor">
      <PageHeader title={t("ptl.po.newTitle")} subtitle={t("ptl.po.subtitle")} />
      <section className="surface-card grid gap-4 p-5 sm:grid-cols-3">
        <Field label={t("ptl.po.vendorPick")}>
          <PartyPicker value={vendorId} onChange={(id) => setVendorId(id)} kind="vendor" testId="po-vendor" />
        </Field>
        <Field label={t("ptl.po.deliverTo")}>
          <LocationSelect value={loc} onChange={setLocation} locations={allowed} includeAll={false} testId="po-location" className="w-full" />
        </Field>
        <Field label={t("ptl.po.expected")}>
          <DateField value={expected || addDaysISO(today, 3)} min={today} onChange={setExpected} data-testid="po-expected" />
        </Field>
      </section>
      <SectionCard title={t("ic.ui.items")}>
        <ItemLinesEditor
          lines={lines}
          onChange={setLines}
          items={lookups?.items}
          unit={(item) => item.purchaseUom}
          qtyLabel={t("ptl.po.qty")}
          lineTestId="po-line"
          qtyTestId="po-qty"
          extra={(line, item, set) => (
            <div className="flex w-40 flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("ptl.po.unitCost")}</span>
              <MoneyInput valueP={line.costP ?? item?.standardCostP ?? null} onChange={(v) => set({ costP: v })} data-testid="po-cost" />
            </div>
          )}
          hint={(line, item) => (item && line.qty ? `${t("ptl.po.net")}: ${money(Math.round(line.qty * (line.costP ?? item.standardCostP)))}` : null)}
        />
      </SectionCard>
      <section className="surface-card flex flex-wrap items-center justify-between gap-4 p-5">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[0.8125rem]">
          <div>
            <dt className="text-xs text-muted-foreground">{t("ptl.po.subtotal")}</dt>
            <dd>
              <MoneyText poisha={subtotal} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("ptl.po.vat")}</dt>
            <dd>
              <MoneyText poisha={vat} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("ptl.po.total")}</dt>
            <dd className="text-base font-semibold">
              <MoneyText poisha={subtotal + vat} />
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[0.8125rem]">
            <Checkbox checked={send} onCheckedChange={(v) => setSend(!!v)} />
            {t("ptl.pr.sendEmail")}
            <SimulatedBadge />
          </label>
          <Button
            disabled={!valid || issue.pending}
            data-testid="po-issue"
            onClick={async () => {
              const out = await issue.run({
                locationId: loc,
                orders: [
                  {
                    vendorId: vendorId!,
                    expectedDate: expected || addDaysISO(today, 3),
                    lines: lines.map((l) => ({ itemId: l.itemId!, qty: l.qty!, unitCostP: l.costP ?? lookups?.items.get(l.itemId!)?.standardCostP ?? 0 })),
                  },
                ],
                send,
                idempotencyKey: freshKey(),
              })
              if (out) {
                const po = out.pos[0]
                toast.success(po.status === "issued" ? t("ptl.po.issuedNow", { no: po.poNo }) : t("ptl.po.pendingNow", { no: po.poNo }))
                router.replace(`/ptl/po/${po.id}`)
              }
            }}
          >
            <ShoppingCart />
            {t("ptl.po.issue")}
          </Button>
        </div>
      </section>
    </div>
  )
}

function PoView({ id }: { id: string }) {
  const db = useDb()
  const { t, locale, money, num, dmy, time } = useLocale()
  const lookups = useScmLookups()
  const [dialog, setDialog] = React.useState<"print" | "cancel" | null>(null)
  const send = useCommand(sendPo)
  const data = useLiveQuery(async () => {
    const po = await db.purchaseOrders.get(id)
    if (!po) return { po: undefined }
    const [lines, grns, bills, pr] = await Promise.all([
      db.poLines.where("poId").equals(id).toArray(),
      db.grns.where("poId").equals(id).toArray(),
      db.vendorBills.where("poId").equals(id).toArray(),
      po.prId ? db.purchaseRequisitions.get(po.prId) : undefined,
    ])
    const returns = grns.length ? (await db.purchaseReturns.where("grnId").anyOf(grns.map((g) => g.id)).toArray()) : []
    const emails = (await db.emails.toArray()).filter((e) => e.refs.poId === id)
    return { po, lines: lines.sort((a, b) => a.lineNo - b.lineNo), grns, bills, pr, returns, emails }
  }, [db, id])
  const canSend = useCan("ptl.po.create", data?.po?.locationId)
  const canCancel = useCan("ptl.po.cancel", data?.po?.locationId)
  const canReceive = useCan("grn.receive.create", data?.po?.locationId)

  if (data === undefined || !lookups) return null
  if (!data.po) return <NotFound title={t("ptl.po.notFound")} backHref="/ptl/po" backLabel={t("ptl.po.back")} />
  const { po, lines, grns, bills, pr, returns, emails } = data
  const vendor = lookups.vendors.get(po.vendorId)
  const open = po.status === "issued" || po.status === "partial"

  return (
    <div className="flex flex-col gap-5" data-testid="po-view">
      <DocHeader
        kind={t("ptl.po.kind")}
        docNo={po.poNo}
        status={po.status}
        lines={[
          nameOf(vendor, locale),
          `${t("ptl.po.deliverTo")}: ${nameOf(lookups.locations.get(po.locationId), locale)} · ${t("ptl.po.orderedOn", { date: dmy(po.orderDate), expected: dmy(po.expectedDate) })}`,
          t("ptl.po.buyer", { name: userName(lookups.users.get(po.buyerId), locale) }),
          po.cancelReason,
        ]}
        amounts={[
          { label: t("ptl.po.subtotal"), value: money(po.subtotalP) },
          { label: t("ptl.po.vat"), value: money(po.vatP) },
          { label: t("ptl.po.total"), value: money(po.totalP) },
        ]}
        actions={
          <>
            {open && canReceive ? (
              <Link href={`/grn/receive/${po.id}`} className={buttonVariants()} data-testid="po-receive">
                <PackageCheck />
                {t("ptl.po.receive")}
              </Link>
            ) : null}
            {open && canSend ? (
              <Button
                variant="outline"
                disabled={send.pending}
                data-testid="po-send"
                onClick={async () => {
                  if (await send.run({ poId: po.id, idempotencyKey: freshKey() })) toast.success(t("ptl.po.sentToast", { no: po.poNo }))
                }}
              >
                <Mail />
                {t("ptl.po.send")}
              </Button>
            ) : null}
            <Button variant="neutral" onClick={() => setDialog("print")} data-testid="po-print">
              <Printer />
              {t("ptl.po.print")}
            </Button>
            {canCancel && ["pending-approval", "issued", "partial"].includes(po.status) ? (
              <Button variant="ghost" onClick={() => setDialog("cancel")} data-testid="po-cancel">
                <XCircle />
                {po.status === "partial" ? t("ptl.po.close") : t("ptl.po.cancel")}
              </Button>
            ) : null}
            {po.sentAt ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="po-sent">
                {t("ptl.po.sentOn", { time: `${dmy(po.sentAt)} ${time(po.sentAt)}` })}
                <SimulatedBadge />
              </span>
            ) : null}
          </>
        }
        links={
          <>
            {pr ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                {t("ptl.po.fromPr")} <DocLink docType="purchaseRequisitions" docId={pr.id} docNo={pr.prNo} />
              </span>
            ) : null}
            {po.approvalId ? <ApprovalChip approvalId={po.approvalId} /> : null}
          </>
        }
      />
      <SectionCard title={t("ic.ui.items")}>
        <LinesTable
          testId="po-lines"
          head={[
            { label: t("ptl.po.item") },
            { label: t("ptl.po.ordered"), align: "right" },
            { label: t("ptl.po.accepted"), align: "right" },
            { label: t("ptl.po.pending"), align: "right", hide: "sm" },
            { label: t("ptl.po.rejected"), align: "right", hide: "md" },
            { label: t("ptl.po.billed"), align: "right", hide: "lg" },
            { label: t("ptl.po.unitCost"), align: "right", hide: "md" },
            { label: t("ptl.po.net"), align: "right" },
          ]}
        >
          {lines.map((l: PoLineRow) => {
            const item = lookups.items.get(l.itemId)
            const accepted = roundQty(l.qtyReceived - l.qtyRejected)
            const pending = Math.max(0, roundQty(l.qty - accepted))
            return (
              <tr key={l.id} data-testid="po-line-row" data-sku={item?.sku}>
                <td>
                  <ItemCell item={item} />
                  {l.qtyReturned ? (
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {t("ptl.po.returned")} {num(l.qtyReturned)}
                    </span>
                  ) : null}
                </td>
                <td className="text-right">
                  <QtyText value={l.qty} uom={item?.purchaseUom} />
                </td>
                <td className="text-right nums">{num(accepted)}</td>
                <td className={cn("text-right nums", HIDE.sm, pending > 0 ? "text-info" : "text-muted-foreground")}>{num(pending)}</td>
                <td className={cn("text-right nums", HIDE.md, l.qtyRejected ? "text-warning" : "text-muted-foreground")}>{num(l.qtyRejected)}</td>
                <td className={cn("text-right nums", HIDE.lg)}>{num(l.qtyBilled)}</td>
                <td className={cn("text-right", HIDE.md)}>
                  <MoneyText poisha={l.unitCostP} />
                </td>
                <td className="text-right">
                  <MoneyText poisha={Math.round(l.qty * l.unitCostP)} />
                </td>
              </tr>
            )
          })}
        </LinesTable>
      </SectionCard>
      <div className="@container/po">
        <div className="grid gap-5 @min-[56rem]/po:grid-cols-3">
          <SectionCard title={t("ptl.po.receipts")} size="sm">
            {grns.length ? (
              <ul className="flex flex-col gap-1.5 text-[0.8125rem]">
                {grns.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <DocLink docType="grns" docId={g.id} docNo={g.grnNo} />
                    <span className="nums text-xs text-muted-foreground">{dmy(g.date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{t("ptl.po.noReceipts")}</p>
            )}
          </SectionCard>
          <SectionCard title={t("ptl.po.bills")} size="sm">
            {bills.length ? (
              <ul className="flex flex-col gap-1.5 text-[0.8125rem]">
                {bills.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <DocLink docType="vendorBills" docId={b.id} docNo={b.billNo} />
                    <MoneyText poisha={b.totalP} className="text-xs" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{t("ptl.po.noBills")}</p>
            )}
          </SectionCard>
          <SectionCard title={t("ptl.po.email")} size="sm" action={<SimulatedBadge />}>
            {emails.length || returns.length ? (
              <ul className="flex flex-col gap-1.5 text-[0.8125rem]">
                {emails.map((e) => (
                  <li key={e.id} className="text-muted-foreground">
                    <span className="nums">
                      {dmy(e.at)} {time(e.at)}
                    </span>{" "}
                    · {t("ptl.po.emailTo", { to: e.to.join(", "), attachment: e.attachments.join(", ") })}
                  </li>
                ))}
                {returns.map((r) => (
                  <li key={r.id}>
                    <DocLink docType="purchaseReturns" docId={r.id} docNo={r.returnNo} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{po.sentAt ? t("ptl.po.sentOn", { time: `${dmy(po.sentAt)} ${time(po.sentAt)}` }) : t("ptl.po.notSent")}</p>
            )}
          </SectionCard>
        </div>
      </div>
      <PrintPreview open={dialog === "print"} onOpenChange={(o) => !o && setDialog(null)} title={t("ptl.po.print")} docNo={po.poNo}>
        <PoPrint po={po} lines={lines} />
      </PrintPreview>
      <Dialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>{dialog === "cancel" ? <CancelForm po={po} onClose={() => setDialog(null)} /> : null}</DialogContent>
      </Dialog>
    </div>
  )
}

function CancelForm({ po, onClose }: { po: PurchaseOrderRow; onClose: () => void }) {
  const { t, tk } = useLocale()
  const cancel = useCommand(cancelPo)
  const [reason, setReason] = React.useState("")
  const partial = po.status === "partial"
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await cancel.run({ poId: po.id, expectedVersion: po.version, reason })
        if (out) {
          toast.success(t("ptl.po.cancelled", { no: po.poNo, status: tk(`shared.status.${out.status}`) }))
          onClose()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{partial ? t("ptl.po.closeTitle", { no: po.poNo }) : t("ptl.po.cancelTitle", { no: po.poNo })}</DialogTitle>
        <DialogDescription>{partial ? t("ptl.po.closeHint") : t("ptl.po.cancelHint")}</DialogDescription>
      </DialogHeader>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ic.ui.reason")} data-testid="po-cancel-reason" />
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.close")}
        </Button>
        <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || cancel.pending} data-testid="po-cancel-confirm">
          {partial ? t("ptl.po.close") : t("ptl.po.cancel")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The PO on white paper: vendor, deliver-to, lines with VAT, totals in figures and words. */
function PoPrint({ po, lines }: { po: PurchaseOrderRow; lines: PoLineRow[] }) {
  const { t, locale } = useLocale()
  const lookups = useScmLookups()
  const vendor = lookups?.vendors.get(po.vendorId)
  const deliver = locationById(po.locationId)
  return (
    <PrintLayout
      title={t("ptl.po.printTitle")}
      docNo={po.poNo}
      meta={
        <>
          <div>{isoToDmy(po.orderDate)}</div>
          <div>
            {t("ptl.po.expected")} {isoToDmy(po.expectedDate)}
          </div>
        </>
      }
      footer={t("ptl.po.printTerms")}
    >
      <div className="mb-4 grid grid-cols-2 gap-4 text-[0.75rem]">
        <div>
          <div className="text-[0.6875rem] text-[#555] uppercase">{t("ptl.po.printVendor")}</div>
          <div className="font-semibold">{vendor?.nameEn}</div>
          <div>{vendor?.addresses[0] ? `${vendor.addresses[0].line}, ${vendor.addresses[0].area}, ${vendor.addresses[0].city}` : ""}</div>
          <div lang="en" className="font-mono">
            {vendor?.code}
            {vendor?.bin ? ` · BIN ${vendor.bin}` : ""}
          </div>
        </div>
        <div>
          <div className="text-[0.6875rem] text-[#555] uppercase">{t("ptl.po.printDeliver")}</div>
          <div className="font-semibold">{deliver?.name[locale]}</div>
          <div>{deliver?.address[locale]}</div>
          <div lang="en">{deliver?.phone}</div>
        </div>
      </div>
      <table className="w-full border-collapse text-[0.75rem]" data-testid="po-print-sheet">
        <thead>
          <tr className="border-y border-[#111] text-left">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">{t("ptl.po.item")}</th>
            <th className="py-1 pr-2 text-right">{t("ptl.po.qty")}</th>
            <th className="py-1 pr-2 text-right">{t("ptl.po.unitCost")}</th>
            <th className="py-1 pr-2 text-right">{t("ptl.po.vat")}</th>
            <th className="py-1 text-right">{t("ptl.po.net")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const item = lookups?.items.get(l.itemId)
            return (
              <tr key={l.id} className="border-b border-[#ddd]">
                <td className="py-1 pr-2 font-mono">{i + 1}</td>
                <td className="py-1 pr-2">
                  {item?.nameEn} <span className="font-mono text-[0.6875rem]">{item?.sku}</span>
                </td>
                <td className="py-1 pr-2 text-right font-mono">
                  {formatNumber(l.qty, "en")} {item?.purchaseUom}
                </td>
                <td className="py-1 pr-2 text-right font-mono">{formatMoney(l.unitCostP, "en")}</td>
                <td className="py-1 pr-2 text-right font-mono">{formatNumber(l.vatRatePct, "en")}%</td>
                <td className="py-1 text-right font-mono">{formatMoney(Math.round(l.qty * l.unitCostP), "en")}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="font-mono">
          <tr>
            <td colSpan={5} className="pt-2 text-right font-sans">
              {t("ptl.po.subtotal")}
            </td>
            <td className="pt-2 text-right">{formatMoney(po.subtotalP, "en")}</td>
          </tr>
          <tr>
            <td colSpan={5} className="text-right font-sans">
              {t("ptl.po.vat")}
            </td>
            <td className="text-right">{formatMoney(po.vatP, "en")}</td>
          </tr>
          <tr className="font-semibold">
            <td colSpan={5} className="border-t border-[#111] text-right font-sans">
              {t("ptl.po.total")}
            </td>
            <td className="border-t border-[#111] text-right">{formatMoney(po.totalP, "en")}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-3 text-[0.75rem] italic">
        <AmountInWords poisha={po.totalP} />
      </div>
      <div className="mt-12 w-56 border-t border-[#111] pt-1 text-[0.75rem]">{lookups?.users.get(po.buyerId)?.nameEn}</div>
    </PrintLayout>
  )
}
