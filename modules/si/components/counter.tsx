"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Banknote,
  CreditCard,
  Plus,
  ShoppingBag,
  Smartphone,
  Trash2,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { MoneyInput, QtyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { ItemPicker, PartyPicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { invoiceAvailable } from "@/core/ar/receipt"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { MFS_TIMEOUT_MIN } from "@/core/connectors/payments"
import { useDb } from "@/core/db/DbProvider"
import type { Id, ReceiptRow, SalesInvoiceRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { priceRequests } from "@/modules/pc/pricing"
import { useCatalogue } from "@/modules/pc/queries"
import {
  ClassTag,
  newKey,
  PrintDialog,
  StudioSelect,
  TotalsBlock,
  useStudio,
  VehicleCell,
} from "@/modules/stl/components/kit"

import { checkout, confirmMfs } from "../commands"
import { usePartyBalances } from "../queries"
import { CounterReceipt } from "./mushak"
import { PaymentSimDialog, type SimRequest } from "./payment-sim"

type Method = "cash" | "card" | "bkash" | "nagad"
type Tender = {
  key: string
  method: Method
  amountP: number | null
  tenderedP: number | null
}

const METHOD_ICON = {
  cash: Banknote,
  card: CreditCard,
  bkash: Smartphone,
  nagad: Wallet,
} as const
const WALK_IN = "pty_walk_in"
const CREDIT = new Set(["fleet", "dealer", "corporate"])

/**
 * /si/counter: counter checkout (J4). Delivered orders of the studio and
 * retail goods without an order; the customer's advance (the booking
 * deposit) applied first; tenders cash (with change), card (simulated
 * terminal), bKash and Nagad (pushed, pending until the customer approves).
 * One commit issues the Mushak 6.3 invoice (R6), the goods out (R5) and the
 * receipts (R7); then the 80 mm receipt prints.
 */
export function Counter() {
  const db = useDb()
  const params = useSearchParams()
  const { t, tk, locale, money, num } = useLocale()
  const studio = useStudio()
  const loc = studio.locationId
  const catalogue = useCatalogue()
  const canCheckout = useCan("si.counter.checkout", loc)
  const run = useCommand(checkout)
  const confirm = useCommand(confirmMfs)
  const nowMs = useNow(15_000)

  const [orderIds, setOrderIds] = React.useState<Id[]>(() =>
    params.get("order") ? [params.get("order")!] : []
  )
  const [collectId, setCollectId] = React.useState<Id | null>(null)
  const [walkPartyId, setWalkPartyId] = React.useState<Id | null>(null)
  const [items, setItems] = React.useState<{ itemId: Id; qty: number }[]>([])
  const [itemId, setItemId] = React.useState<Id | null>(null)
  const [itemQty, setItemQty] = React.useState<number | null>(1)
  const [tenders, setTenders] = React.useState<Tender[]>([])
  const [sim, setSim] = React.useState<SimRequest | null>(null)
  const [done, setDone] = React.useState<Id | null>(null)

  const data = useLiveQuery(async () => {
    if (!loc) return null
    const allDelivered = (
      await db.salesOrders
        .where("[locationId+status]")
        .equals([loc, "delivered"])
        .toArray()
    ).sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0))
    const open = (
      await db.salesInvoices.where("locationId").equals(loc).toArray()
    ).filter((i) => i.kind === "counter" && invoiceAvailable(i) > 0)
    const pending = (
      await db.receipts.where("status").equals("pending").toArray()
    ).filter(
      (r) =>
        r.locationId === loc && (r.method === "bkash" || r.method === "nagad")
    )
    const partyIds = [
      ...new Set([
        ...allDelivered.map((o) => o.partyId),
        ...open.map((i) => i.partyId),
        ...pending.map((r) => r.partyId),
      ]),
    ]
    const parties = new Map(
      (await db.parties.bulkGet(partyIds))
        .filter(Boolean)
        .map((p) => [p!.id, p!])
    )
    // Credit accounts (fleets, dealers, corporates) are invoiced on terms from SI, not paid at the counter.
    const delivered = allDelivered.filter((o) => {
      const p = parties.get(o.partyId)
      return !!p && !CREDIT.has(p.segment) && p.paymentTermsDays === 0
    })
    const lines = await db.salesOrderLines
      .where("orderId")
      .anyOf(delivered.map((o) => o.id))
      .toArray()
    const vehicles = new Map(
      (
        await db.vehicles.bulkGet([
          ...new Set(
            delivered.map((o) => o.vehicleId).filter((v): v is string => !!v)
          ),
        ])
      )
        .filter(Boolean)
        .map((v) => [v!.id, v!])
    )
    const pendingInvoices = new Map(
      (
        await db.salesInvoices.bulkGet(
          pending.map((r) => r.allocations[0]?.invoiceId ?? "")
        )
      )
        .filter(Boolean)
        .map((i) => [i!.id, i!])
    )
    return {
      delivered,
      lines,
      open,
      pending,
      parties,
      vehicles,
      pendingInvoices,
    }
  }, [db, loc])

  const cartOrders = (data?.delivered ?? []).filter((o) =>
    orderIds.includes(o.id)
  )
  const collect = data?.open.find((i) => i.id === collectId)
  const partyId =
    collect?.partyId ?? cartOrders[0]?.partyId ?? walkPartyId ?? WALK_IN
  const party = useLiveQuery(() => db.parties.get(partyId), [db, partyId])
  const balances = usePartyBalances(collect ? null : partyId)

  const orderLines = (data?.lines ?? []).filter(
    (l) => orderIds.includes(l.orderId) && l.status !== "cancelled"
  )
  const itemPricing = React.useMemo(
    () =>
      catalogue && items.length
        ? priceRequests(catalogue, {
            priceListId: party?.priceListId,
            date: dhakaDate(now()),
            requests: items.map((i) => ({ kind: "item" as const, ...i })),
            discountPct: 0,
          })
        : undefined,
    [catalogue, items, party?.priceListId]
  )
  const lineTotals = [
    ...orderLines.map((l) => ({
      gross: Math.round(l.qty * l.unitPriceP),
      discount: l.discountP,
      vat: l.vatP,
    })),
    ...(itemPricing?.lines ?? []).map((l) => ({
      gross: l.grossP,
      discount: l.discountP,
      vat: l.vatP,
    })),
  ]
  const subtotal = lineTotals.reduce((s, l) => s + l.gross, 0)
  const discount = lineTotals.reduce((s, l) => s + l.discount, 0)
  const vat = lineTotals.reduce((s, l) => s + l.vat, 0)
  const total = subtotal - discount + vat
  const advance = collect ? 0 : Math.min(total, balances?.advanceP ?? 0)
  const due = collect ? invoiceAvailable(collect) : total - advance
  const paying = tenders.reduce((s, x) => s + (x.amountP ?? 0), 0)
  const remaining = due - paying
  const hasCart = !!collect || orderIds.length > 0 || items.length > 0
  const cashOk = tenders.every(
    (x) =>
      x.method !== "cash" ||
      x.tenderedP === null ||
      (x.tenderedP ?? 0) >= (x.amountP ?? 0)
  )
  const ready =
    hasCart &&
    canCheckout &&
    remaining === 0 &&
    cashOk &&
    (due > 0 ? tenders.length > 0 : true)

  const reset = () => {
    setOrderIds([])
    setCollectId(null)
    setItems([])
    setTenders([])
    setWalkPartyId(null)
  }

  const toggleOrder = (id: Id, orderPartyId: Id) => {
    setCollectId(null)
    setOrderIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      const sameParty = (data?.delivered ?? [])
        .filter((o) => cur.includes(o.id))
        .every((o) => o.partyId === orderPartyId)
      return sameParty ? [...cur, id] : [id]
    })
    setTenders([])
  }

  const addTender = (method: Method) => {
    const amount = Math.max(0, remaining)
    setTenders((cur) => [
      ...cur,
      {
        key: newKey(),
        method,
        amountP: amount || null,
        tenderedP:
          method === "cash" && amount
            ? Math.ceil(amount / 100_00) * 100_00
            : null,
      },
    ])
  }

  const commit = async (cardRef?: string): Promise<boolean> => {
    const out = await run.run({
      locationId: loc ?? undefined,
      partyId: collect ? undefined : partyId,
      orderIds: collect ? [] : orderIds,
      items: collect ? [] : items,
      invoiceId: collect?.id,
      tenders: tenders.map((x) => ({
        method: x.method,
        amountP: x.amountP ?? 0,
        tenderedP:
          x.method === "cash" ? (x.tenderedP ?? x.amountP ?? 0) : undefined,
        ref: x.method === "card" ? cardRef : undefined,
      })),
      idempotencyKey: newKey(),
    })
    if (!out) return false
    toast.success(t("si.counter.done", { no: out.invoiceNo }))
    reset()
    const pendingReceipt = out.receipts.find((r) => r.status === "pending")
    if (!pendingReceipt) setDone(out.invoiceId)
    if (pendingReceipt) {
      const tender = tenders.find((x) => x.method === pendingReceipt.method)
      // After any card dialog has closed, the push dialog opens for the pending wallet payment.
      window.setTimeout(
        () =>
          setSim({
            method: pendingReceipt.method as "bkash" | "nagad",
            amountP: tender?.amountP ?? 0,
            phone: party?.phone,
            onApproved: async () => {
              const ok = !!(await confirm.run({
                receiptId: pendingReceipt.receiptId,
              }))
              if (ok) window.setTimeout(() => setDone(out.invoiceId), 60)
              return ok
            },
          }),
        60
      )
    }
    return true
  }

  const submit = async () => {
    const card = tenders
      .filter((x) => x.method === "card")
      .reduce((s, x) => s + (x.amountP ?? 0), 0)
    if (card > 0) {
      setSim({
        method: "card",
        amountP: card,
        onApproved: (ref) => commit(ref),
      })
      return
    }
    await commit()
  }

  return (
    <div className="flex flex-col gap-4" data-testid="counter">
      <PageHeader
        title={t("si.pages.counter")}
        subtitle={t("si.counter.subtitle")}
        actions={
          <StudioSelect
            value={loc}
            onChange={studio.setLocationId}
            studios={studio.studios}
          />
        }
      />
      <div className="@container/counter grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title={t("si.counter.readyToPay")}
            size="sm"
            subtitle={t("si.counter.readyHint")}
          >
            <ul className="flex flex-col gap-2">
              {(data?.delivered ?? []).map((o) => {
                const p = data?.parties.get(o.partyId)
                const v = o.vehicleId
                  ? data?.vehicles.get(o.vehicleId)
                  : undefined
                const picked = orderIds.includes(o.id)
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggleOrder(o.id, o.partyId)}
                      data-testid="counter-order"
                      data-order-no={o.orderNo}
                      aria-pressed={picked}
                      className={cn(
                        "flex w-full flex-wrap items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                        picked
                          ? "border-primary bg-primary-soft"
                          : "border-transparent bg-surface-raised/60 hover:bg-surface-raised"
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          {v ? <VehicleCell vehicle={v} /> : null}
                          <ClassTag cls={v?.vehicleClass} />
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          <span lang="en" className="font-mono">
                            {o.orderNo}
                          </span>{" "}
                          · {nameOf(p, locale)}
                          {o.advanceP
                            ? ` · ${t("si.counter.deposit", { amount: money(o.advanceP) })}`
                            : ""}
                        </span>
                      </span>
                      <span className="font-mono text-sm font-semibold">
                        <MoneyText poisha={o.totalP} />
                      </span>
                    </button>
                  </li>
                )
              })}
              {data && !data.delivered.length ? (
                <li className="py-3 text-center text-[0.8125rem] text-muted-foreground">
                  {t("si.counter.noneReady")}
                </li>
              ) : null}
            </ul>
          </SectionCard>

          <SectionCard
            title={t("si.counter.retail")}
            icon={ShoppingBag}
            size="sm"
          >
            <div className="flex flex-wrap gap-2">
              <ItemPicker
                value={itemId}
                onChange={(id) => setItemId(id)}
                kinds={["retail"]}
                className="min-w-56 flex-1"
                testId="counter-item"
              />
              <QtyInput
                value={itemQty}
                onChange={setItemQty}
                unit="pc"
                className="w-24"
                data-testid="counter-item-qty"
              />
              <Button
                variant="outline"
                disabled={!itemId || !itemQty || itemQty <= 0 || !!collect}
                onClick={() => {
                  if (!itemId || !itemQty) return
                  setItems((cur) => [...cur, { itemId, qty: itemQty }])
                  setItemId(null)
                  setItemQty(1)
                  setTenders([])
                }}
                data-testid="counter-item-add"
              >
                <Plus data-icon="inline-start" />
                {t("common.add")}
              </Button>
            </div>
            {!orderIds.length && items.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8125rem]">
                <span className="text-muted-foreground">
                  {t("si.counter.customer")}
                </span>
                <PartyPicker
                  value={walkPartyId ?? WALK_IN}
                  onChange={(id) => setWalkPartyId(id)}
                  className="max-w-80"
                  testId="counter-party"
                />
              </div>
            ) : null}
          </SectionCard>

          {data?.pending.length ? (
            <SectionCard
              title={t("si.counter.pending")}
              size="sm"
              action={<SimulatedBadge />}
            >
              <ul className="flex flex-col gap-2">
                {data.pending.map((r) => (
                  <PendingRow
                    key={r.id}
                    receipt={r}
                    invoice={data.pendingInvoices.get(
                      r.allocations[0]?.invoiceId ?? ""
                    )}
                    partyName={nameOf(data.parties.get(r.partyId), locale)}
                    nowMs={nowMs}
                    onConfirm={() => confirm.run({ receiptId: r.id })}
                  />
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {data?.open.length ? (
            <SectionCard title={t("si.counter.openBalances")} size="sm">
              <ul className="flex flex-col gap-2">
                {data.open.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2"
                  >
                    <Link
                      href={`/si/${inv.id}`}
                      lang="en"
                      className="font-mono text-[0.8125rem] text-link hover:underline"
                    >
                      {inv.invoiceNo}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {nameOf(data.parties.get(inv.partyId), locale)}
                    </span>
                    <MoneyText
                      poisha={invoiceAvailable(inv)}
                      className="font-mono text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOrderIds([])
                        setItems([])
                        setTenders([])
                        setCollectId(inv.id)
                      }}
                      data-testid="counter-collect"
                    >
                      {t("si.counter.collect")}
                    </Button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title={
              collect
                ? t("si.counter.collecting", { no: collect.invoiceNo })
                : t("si.counter.cart")
            }
            size="sm"
            action={
              hasCart ? (
                <Button variant="ghost" size="sm" onClick={reset}>
                  {t("common.clear")}
                </Button>
              ) : null
            }
          >
            <div className="flex flex-col gap-3">
              <div className="text-[0.8125rem]">
                <span className="text-muted-foreground">
                  {t("common.customer")}:{" "}
                </span>
                <span className="font-medium" data-testid="counter-customer">
                  {nameOf(party, locale)}
                </span>
              </div>
              {orderLines.length || itemPricing?.lines.length ? (
                <ul
                  className="flex flex-col gap-1 text-[0.8125rem]"
                  data-testid="counter-lines"
                >
                  {orderLines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {locale === "bn" ? l.descriptionBn : l.descriptionEn}
                      </span>
                      <MoneyText
                        poisha={l.netP + l.vatP}
                        className="font-mono"
                      />
                    </li>
                  ))}
                  {(itemPricing?.lines ?? []).map((l, i) => (
                    <li
                      key={`item-${i}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0 truncate">
                        {num(l.qty)} ×{" "}
                        {locale === "bn" ? l.descriptionBn : l.descriptionEn}
                      </span>
                      <span className="flex items-center gap-1">
                        <MoneyText poisha={l.totalP} className="font-mono" />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("common.remove")}
                          onClick={() => {
                            setItems((cur) => cur.filter((_, k) => k !== i))
                            setTenders([])
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : !collect ? (
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t("si.counter.empty")}
                </p>
              ) : null}
              <TotalsBlock
                rows={
                  collect
                    ? [
                        { label: t("common.total"), valueP: collect.totalP },
                        {
                          label: t("si.counter.alreadyPaid"),
                          valueP:
                            collect.paidP +
                            collect.advanceAppliedP +
                            collect.creditedP,
                          negative: true,
                        },
                        {
                          label: t("si.counter.due"),
                          valueP: due,
                          strong: true,
                          testId: "counter-due",
                        },
                      ]
                    : [
                        { label: t("common.subtotal"), valueP: subtotal },
                        {
                          label: t("common.discount"),
                          valueP: discount,
                          negative: true,
                        },
                        { label: t("common.vat"), valueP: vat },
                        { label: t("common.total"), valueP: total },
                        {
                          label: t("si.counter.advance"),
                          valueP: advance,
                          negative: true,
                          testId: "counter-advance",
                        },
                        {
                          label: t("si.counter.due"),
                          valueP: due,
                          strong: true,
                          testId: "counter-due",
                        },
                      ]
                }
              />
            </div>
          </SectionCard>

          <SectionCard
            title={t("si.counter.tenders")}
            size="sm"
            action={<SimulatedBadge />}
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 @min-[28rem]:grid-cols-4">
                {(["cash", "card", "bkash", "nagad"] as const).map((m) => {
                  const Icon = METHOD_ICON[m]
                  return (
                    <Button
                      key={m}
                      variant="outline"
                      size="sm"
                      onClick={() => addTender(m)}
                      disabled={!hasCart || remaining <= 0}
                      data-testid={`tender-${m}`}
                    >
                      <Icon data-icon="inline-start" />
                      {tk(`reports.enum.method.${m}`)}
                    </Button>
                  )
                })}
              </div>
              {tenders.map((x) => (
                <div
                  key={x.key}
                  className="flex flex-col gap-2 rounded-md bg-surface-raised/60 p-2.5"
                  data-testid="tender-row"
                  data-method={x.method}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[0.8125rem] font-medium">
                      {tk(`reports.enum.method.${x.method}`)}
                    </span>
                    <MoneyInput
                      valueP={x.amountP}
                      onChange={(v) =>
                        setTenders((cur) =>
                          cur.map((y) =>
                            y.key === x.key ? { ...y, amountP: v } : y
                          )
                        )
                      }
                      className="flex-1"
                      data-testid="tender-amount"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("common.remove")}
                      onClick={() =>
                        setTenders((cur) => cur.filter((y) => y.key !== x.key))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {x.method === "cash" ? (
                    <div className="flex items-center gap-2 text-[0.8125rem]">
                      <span className="w-16 shrink-0 text-muted-foreground">
                        {t("si.counter.received")}
                      </span>
                      <MoneyInput
                        valueP={x.tenderedP}
                        onChange={(v) =>
                          setTenders((cur) =>
                            cur.map((y) =>
                              y.key === x.key ? { ...y, tenderedP: v } : y
                            )
                          )
                        }
                        className="flex-1"
                        data-testid="tender-received"
                      />
                      <span
                        className="w-28 shrink-0 text-right text-xs text-muted-foreground"
                        data-testid="tender-change"
                      >
                        {t("si.counter.change")}{" "}
                        <MoneyText
                          poisha={Math.max(
                            0,
                            (x.tenderedP ?? 0) - (x.amountP ?? 0)
                          )}
                        />
                      </span>
                    </div>
                  ) : null}
                  {x.method === "bkash" || x.method === "nagad" ? (
                    <p className="text-xs text-muted-foreground">
                      {t("si.counter.mfsHint", { minutes: MFS_TIMEOUT_MIN })}
                    </p>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center justify-between text-[0.8125rem]">
                <span className="text-muted-foreground">
                  {t("si.counter.remaining")}
                </span>
                <MoneyText
                  poisha={remaining}
                  className={cn(
                    "font-mono font-semibold",
                    remaining !== 0 && "text-warning"
                  )}
                />
              </div>
              <Button
                size="lg"
                onClick={submit}
                disabled={!ready || run.pending}
                data-testid="checkout-submit"
              >
                {due > 0
                  ? t("si.counter.checkout", { amount: money(due) })
                  : t("si.counter.issueOnly")}
              </Button>
              {!canCheckout ? (
                <p className="text-xs text-muted-foreground">
                  {t("stl.noPermission")}
                </p>
              ) : null}
            </div>
          </SectionCard>
        </aside>
      </div>
      <PaymentSimDialog request={sim} onClose={() => setSim(null)} />
      <ReceiptDialog invoiceId={done} onClose={() => setDone(null)} />
    </div>
  )
}

function PendingRow({
  receipt,
  invoice,
  partyName,
  nowMs,
  onConfirm,
}: {
  receipt: ReceiptRow
  invoice?: SalesInvoiceRow
  partyName: string
  nowMs: number
  onConfirm: () => void
}) {
  const { t, tk, num } = useLocale()
  const left = Math.max(
    0,
    MFS_TIMEOUT_MIN - Math.floor(((nowMs || receipt.at) - receipt.at) / 60_000)
  )
  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2"
      data-testid="pending-mfs"
    >
      <span className="text-[0.8125rem] font-medium">
        {tk(`reports.enum.method.${receipt.method}`)}
      </span>
      <span lang="en" className="font-mono text-xs text-muted-foreground">
        {invoice?.invoiceNo ?? receipt.receiptNo}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {partyName} · <DateText value={receipt.at} variant="time" /> ·{" "}
        {t("si.counter.minutesLeft", { min: num(left) })}
      </span>
      <MoneyText poisha={receipt.amountP} className="font-mono text-sm" />
      <Button size="sm" onClick={onConfirm} data-testid="mfs-approve">
        {t("si.sim.customerApproved")}
      </Button>
    </li>
  )
}

/** After checkout: the 80 mm receipt preview and print. */
function ReceiptDialog({
  invoiceId,
  onClose,
}: {
  invoiceId: Id | null
  onClose: () => void
}) {
  const db = useDb()
  const { t, locale } = useLocale()
  const data = useLiveQuery(async () => {
    if (!invoiceId) return null
    const invoice = await db.salesInvoices.get(invoiceId)
    if (!invoice) return null
    const [lines, receipts, party] = await Promise.all([
      db.salesInvoiceLines
        .where("invoiceId")
        .equals(invoice.id)
        .sortBy("lineNo"),
      db.receipts.where("partyId").equals(invoice.partyId).toArray(),
      db.parties.get(invoice.partyId),
    ])
    return {
      invoice,
      lines,
      receipts: receipts.filter((r) =>
        r.allocations.some((a) => a.invoiceId === invoice.id)
      ),
      party,
    }
  }, [db, invoiceId])
  if (!data) return null
  return (
    <PrintDialog
      open={!!invoiceId}
      onOpenChange={(open) => !open && onClose()}
      title={t("si.receipt.title")}
      docNo={data.invoice.invoiceNo}
      wide={false}
      testId="receipt-preview"
    >
      <CounterReceipt
        invoice={data.invoice}
        lines={data.lines}
        receipts={data.receipts}
        partyName={nameOf(data.party, locale)}
      />
      <div className="mt-3 text-center">
        <Link
          href={`/si/${data.invoice.id}`}
          className="text-[0.8125rem] text-link hover:underline"
          data-testid="receipt-open-invoice"
        >
          {t("si.counter.openInvoice")}
        </Link>
      </div>
    </PrintDialog>
  )
}
