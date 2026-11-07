"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarCheck, FileText, Mail, MessageSquare, Pencil, Percent, Printer } from "lucide-react"
import { toast } from "sonner"

import { AmountInWords } from "@/components/shared/amount-in-words"
import { useInlineApproval } from "@/components/shared/approval-dialog"
import { ApprovalChip } from "@/components/shared/approval-chip"
import { DocLink } from "@/components/shared/doc-link"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { locationById } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id, QuotationLineRow, QuotationRow, VehicleClass } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan, useLimit } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { priceRequests } from "@/modules/pc/pricing"
import { useCatalogue } from "@/modules/pc/queries"

import { acceptQuotation, saveQuotation, sendQuotation } from "../commands"
import { requestsFromLines } from "../quote-requests"
import { DepositFields, NO_DEPOSIT, useDepositFlow, type DepositState } from "./deposit"
import { ClassTag, DocHeader, Field, newKey, PrintDialog, TotalsBlock, useUserMap, VehicleCell } from "./kit"

/** Display status of a quotation: draft or sent past its validity reads as expired. */
export function quoteStatus(q: Pick<QuotationRow, "status" | "validUntil">, today: string): QuotationRow["status"] {
  return (q.status === "draft" || q.status === "sent") && q.validUntil < today ? "expired" : q.status
}

/** /stl/quotations/[id]: the quotation with send, print, revise and accept (J1). */
export function QuoteView({ id }: { id: Id }) {
  const db = useDb()
  const router = useRouter()
  const { t, locale, dmy, num } = useLocale()
  const users = useUserMap()
  const send = useCommand(sendQuotation)
  const accept = useCommand(acceptQuotation)
  const deposit = useDepositFlow()
  const [printing, setPrinting] = React.useState(false)
  const [accepting, setAccepting] = React.useState(false)
  const [discounting, setDiscounting] = React.useState(false)
  const [dep, setDep] = React.useState<DepositState>(NO_DEPOSIT)

  const data = useLiveQuery(async () => {
    const q = await db.quotations.get(id)
    if (!q) return null
    const [lines, party, vehicle, order] = await Promise.all([
      db.quotationLines.where("quotationId").equals(q.id).sortBy("lineNo"),
      db.parties.get(q.partyId),
      q.vehicleId ? db.vehicles.get(q.vehicleId) : undefined,
      q.orderId ? db.salesOrders.get(q.orderId) : undefined,
    ])
    return { q, lines, party, vehicle, order }
  }, [db, id])
  const canQuote = useCan("stl.quote.create", data?.q.locationId)
  const canOrder = useCan("stl.order.create", data?.q.locationId)

  if (data === undefined) return null
  if (data === null) return <EmptyState icon={FileText} title={t("stl.quote.notFound")} action={{ label: t("stl.pages.quotations"), href: "/stl/quotations" }} />
  const { q, lines, party, vehicle, order } = data
  const today = dhakaDate(now())
  const status = quoteStatus(q, today)
  const open = status === "draft" || status === "sent"
  const advisor = users.get(q.advisorId)

  const doSend = async (channel: "sms" | "email") => {
    const out = await send.run({ quotationId: q.id, channel, expectedVersion: q.version })
    if (out) toast.success(t(channel === "sms" ? "stl.quote.sentSms" : "stl.quote.sentEmail", { no: q.quoteNo }))
  }

  const doAccept = async () => {
    const idempotencyKey = newKey()
    await deposit.run(dep, party?.phone, async (d) => {
      const out = await accept.run({ quotationId: q.id, expectedVersion: q.version, deposit: d, idempotencyKey })
      if (out) {
        setAccepting(false)
        toast.success(t("stl.quote.accepted", { no: out.orderNo }))
        router.push(`/stl/orders/${out.orderId}`)
      }
      return !!out
    })
  }

  return (
    <div className="flex flex-col gap-4" data-testid="quote-view">
      <DocHeader
        title={t("stl.pages.quotation")}
        docNo={q.quoteNo}
        status={status}
        lines={[
          <>
            <span className="font-medium text-foreground">{nameOf(party, locale)}</span>
            <span lang="en" className="font-mono">{party?.phone}</span>
          </>,
          vehicle ? (
            <>
              <VehicleCell vehicle={vehicle} /> <ClassTag cls={vehicle.vehicleClass} />
            </>
          ) : null,
          <>
            {t("stl.quote.validUntil", { date: dmy(q.validUntil) })} · {userName(advisor, locale)}
          </>,
        ].filter(Boolean)}
        amounts={[
          { label: t("common.subtotal"), valueP: q.subtotalP },
          { label: t("common.discount"), valueP: -q.discountP, tone: "muted" },
          { label: t("common.vat"), valueP: q.vatP },
          { label: t("common.total"), valueP: q.totalP, strong: true },
        ]}
        actions={
          <>
            {open && canOrder ? (
              <Button onClick={() => setAccepting(true)} data-testid="quote-accept">
                <CalendarCheck data-icon="inline-start" />
                {t("stl.quote.accept")}
              </Button>
            ) : null}
            {open && canQuote ? (
              <>
                <Button variant="outline" onClick={() => setDiscounting(true)} data-testid="quote-discount-open">
                  <Percent data-icon="inline-start" />
                  {t("common.discount")}
                </Button>
                <Button variant="outline" onClick={() => doSend("sms")} disabled={send.pending} data-testid="quote-send-sms">
                  <MessageSquare data-icon="inline-start" />
                  {t("stl.quote.sendSms")}
                </Button>
                <Button variant="outline" onClick={() => doSend("email")} disabled={send.pending || !party?.email}>
                  <Mail data-icon="inline-start" />
                  {t("stl.quote.sendEmail")}
                </Button>
                <Button variant="ghost" nativeButton={false} render={<Link href={`/stl/quotations/new?id=${q.id}`} />}>
                  <Pencil data-icon="inline-start" />
                  {t("stl.quote.reviseShort")}
                </Button>
              </>
            ) : null}
            <Button variant="ghost" onClick={() => setPrinting(true)} data-testid="quote-print">
              <Printer data-icon="inline-start" />
              {t("common.print")}
            </Button>
            {open && canQuote ? <SimulatedBadge className="ml-auto" /> : null}
          </>
        }
      />

      <div className="grid gap-4 @container/q xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard title={t("stl.quote.services")} size="sm">
          <QuoteLines lines={lines} />
          <TotalsBlock
            className="mt-4"
            rows={[
              { label: t("common.subtotal"), valueP: q.subtotalP },
              { label: t("common.discount"), valueP: q.discountP, negative: true },
              { label: t("common.vat"), valueP: q.vatP },
              { label: t("common.total"), valueP: q.totalP, strong: true },
            ]}
          />
        </SectionCard>
        <div className="flex flex-col gap-4">
          <SectionCard title={t("stl.quote.details")} size="sm">
            <KeyValueGrid
              columns={2}
              items={[
                { label: t("stl.quote.discountPct"), value: <span data-testid="quote-discount-pct">{num(q.discountPct)}%</span> },
                { label: t("common.location"), value: locationById(q.locationId)?.name[locale] },
                { label: t("stl.quote.inspection"), value: q.inspectionNotes || "-", wide: true },
              ]}
            />
            {q.discountApprovalId ? <ApprovalChip approvalId={q.discountApprovalId} className="mt-3" /> : null}
          </SectionCard>
          {order ? (
            <SectionCard title={t("stl.linked")} size="sm">
              <DocLink docType="salesOrders" docId={order.id} docNo={order.orderNo} />
            </SectionCard>
          ) : null}
        </div>
      </div>

      {open && canQuote && discounting ? (
        <DiscountDialog
          key={`${q.id}:${q.version}`}
          quotation={q}
          lines={lines}
          priceListId={party?.priceListId}
          vehicleClass={vehicle?.vehicleClass}
          open={discounting}
          onOpenChange={setDiscounting}
        />
      ) : null}
      <Dialog open={accepting} onOpenChange={setAccepting}>
        <DialogContent className="sm:max-w-md" data-testid="accept-dialog">
          <DialogHeader>
            <DialogTitle>{t("stl.quote.acceptTitle", { no: q.quoteNo })}</DialogTitle>
            <DialogDescription>{t("stl.quote.acceptBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-md bg-surface-raised px-4 py-3 text-sm">
            <span className="text-muted-foreground">{t("common.total")}</span>
            <span className="font-mono font-semibold">
              <MoneyText poisha={q.totalP} />
            </span>
          </div>
          <DepositFields value={dep} onChange={setDep} maxP={q.totalP} />
          <DialogFooter>
            <Button variant="neutral" onClick={() => setAccepting(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={doAccept} disabled={accept.pending || (dep.enabled && !dep.amountP)} data-testid="accept-confirm">
              {t("stl.quote.bookOrder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {deposit.dialog}

      <PrintDialog open={printing} onOpenChange={setPrinting} title={t("stl.quote.printTitle")} docNo={q.quoteNo}>
        <PrintLayout title={t("stl.quote.printTitle")} docNo={q.quoteNo} location={locationById(q.locationId)?.code} meta={dmy(q.createdAt)}>
          <div className="mb-4 grid grid-cols-2 gap-4 text-[0.75rem]">
            <div>
              <div className="font-semibold">{nameOf(party, locale)}</div>
              <div lang="en">{party?.phone}</div>
            </div>
            <div className="text-right">
              {vehicle ? (
                <>
                  <div lang="en" className="font-mono">{vehicle.regNo}</div>
                  <div>
                    {vehicle.make} {vehicle.model} ({vehicle.vehicleClass})
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <QuoteLines lines={lines} paper />
          <TotalsBlock
            className="mt-3"
            rows={[
              { label: t("common.subtotal"), valueP: q.subtotalP },
              { label: t("common.discount"), valueP: q.discountP, negative: true },
              { label: t("common.vat"), valueP: q.vatP },
              { label: t("common.total"), valueP: q.totalP, strong: true },
            ]}
          />
          <p className="mt-3 text-[0.75rem]">
            <AmountInWords poisha={q.totalP} />
          </p>
          <p className="mt-2 text-[0.75rem]">{t("stl.quote.validUntil", { date: dmy(q.validUntil) })}</p>
        </PrintLayout>
      </PrintDialog>
    </div>
  )
}

/**
 * Change the discount on an open quotation (E1): the lines are re-priced
 * with the new percent (previewed live); above the user's live
 * `discount-pct` limit an approver confirms on this device with a PIN
 * (inline approval), then the quotation saves.
 */
function DiscountDialog({
  quotation,
  lines,
  priceListId,
  vehicleClass,
  open,
  onOpenChange,
}: {
  quotation: QuotationRow
  lines: QuotationLineRow[]
  priceListId?: Id
  vehicleClass?: VehicleClass
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, num } = useLocale()
  const limit = useLimit("discount-pct")
  const catalogue = useCatalogue()
  const save = useCommand(saveQuotation)
  const { requestApproval, dialog } = useInlineApproval()
  const [pct, setPct] = React.useState<number>(quotation.discountPct)
  const overLimit = pct > limit
  const changed = pct !== quotation.discountPct
  const requests = React.useMemo(() => requestsFromLines(lines), [lines])
  const preview = catalogue
    ? priceRequests(catalogue, { priceListId, date: dhakaDate(now()), vehicleClass, requests, discountPct: pct, promotionId: quotation.promotionId })
    : undefined

  const apply = async () => {
    let inline
    if (overLimit) {
      inline = await requestApproval({
        kind: "discount-pct",
        docType: "quotations",
        locationId: quotation.locationId,
        pct,
        description: t("stl.quote.discountAsk", { pct: num(pct), limit: num(limit) }),
      })
      if (!inline) return
    }
    const out = await save.run({
      quotationId: quotation.id,
      expectedVersion: quotation.version,
      partyId: quotation.partyId,
      vehicleId: quotation.vehicleId,
      requests,
      discountPct: pct,
      promotionId: quotation.promotionId,
      inspectionNotes: quotation.inspectionNotes,
      inline,
    })
    if (out) {
      onOpenChange(false)
      toast.success(t("stl.quote.discountApplied", { pct: num(pct), no: quotation.quoteNo }))
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm" data-testid="quote-discount-dialog">
          <DialogHeader>
            <DialogTitle>{t("stl.quote.discountTitle", { no: quotation.quoteNo })}</DialogTitle>
            <DialogDescription>{t("stl.quote.discountBody")}</DialogDescription>
          </DialogHeader>
          <Field
            label={t("stl.quote.discountPct")}
            hint={overLimit ? <span className="text-warning">{t("stl.quote.needsApproval", { limit: num(limit) })}</span> : t("stl.quote.yourLimit", { limit: num(limit) })}
          >
            <div className="relative w-28">
              <Input
                type="text"
                inputMode="decimal"
                autoFocus
                data-testid="quote-discount-edit"
                value={pct ? String(pct) : ""}
                placeholder={num(0)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d.]/g, ""))
                  setPct(Number.isFinite(n) ? Math.min(100, n) : 0)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && changed && !save.pending) void apply()
                }}
                className={cn("pr-8 text-right font-mono", overLimit && "border-warning")}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">%</span>
            </div>
          </Field>
          <TotalsBlock
            rows={[
              { label: t("common.subtotal"), valueP: preview?.subtotalP ?? quotation.subtotalP },
              { label: t("common.discount"), valueP: preview?.discountP ?? quotation.discountP, negative: true, testId: "quote-discount-preview" },
              { label: t("common.vat"), valueP: preview?.vatP ?? quotation.vatP },
              { label: t("common.total"), valueP: preview?.totalP ?? quotation.totalP, strong: true },
            ]}
          />
          <DialogFooter>
            <Button variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={apply} disabled={!changed || save.pending} data-testid="quote-discount-apply">
              {t("stl.quote.discountApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  )
}

/** Quotation or order lines as a compact table (screen or paper). */
export function QuoteLines({ lines, paper = false }: { lines: Pick<QuotationLineRow, "descriptionEn" | "descriptionBn" | "qty" | "unitPriceP" | "discountP" | "vatP" | "netP" | "kind">[]; paper?: boolean }) {
  const { t, locale } = useLocale()
  const head = paper ? "border-b border-[#111] px-2 py-1" : "bg-surface-raised px-3 py-2"
  const cell = paper ? "border-b border-[#ddd] px-2 py-1" : "border-b border-hairline px-3 py-2"
  return (
    <div className="@container/ql overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr className="text-left">
            <th className={`${head} font-medium ${paper ? "" : "rounded-l-md"}`}>{t("common.description")}</th>
            <th className={`${head} text-right font-medium`}>{t("common.qty")}</th>
            <th className={`${head} hidden text-right font-medium @min-[32rem]/ql:table-cell`}>{t("common.unitPrice")}</th>
            <th className={`${head} hidden text-right font-medium @min-[26rem]/ql:table-cell`}>{t("common.discount")}</th>
            <th className={`${head} hidden text-right font-medium @min-[38rem]/ql:table-cell`}>{t("common.vat")}</th>
            <th className={`${head} text-right font-medium ${paper ? "" : "rounded-r-md"}`}>{t("common.total")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} data-testid={paper ? undefined : "doc-line"}>
              <td className={cell}>{locale === "bn" ? l.descriptionBn : l.descriptionEn}</td>
              <td className={`${cell} text-right font-mono`}>{l.qty}</td>
              <td className={`${cell} hidden text-right font-mono @min-[32rem]/ql:table-cell`}>
                <MoneyText poisha={l.unitPriceP} />
              </td>
              <td className={`${cell} hidden text-right font-mono @min-[26rem]/ql:table-cell`}>{l.discountP ? <MoneyText poisha={-l.discountP} /> : "-"}</td>
              <td className={`${cell} hidden text-right font-mono @min-[38rem]/ql:table-cell`}>
                <MoneyText poisha={l.vatP} />
              </td>
              <td className={`${cell} text-right font-mono`}>
                <MoneyText poisha={l.netP + l.vatP} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
