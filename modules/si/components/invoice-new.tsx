"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { FileStack, FileText, ShieldAlert, ShieldCheck } from "lucide-react"

import { useInlineApproval } from "@/components/shared/approval-dialog"
import { DateField } from "@/components/shared/date-field"
import { DateText } from "@/components/shared/date-text"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PartyPicker } from "@/components/shared/pickers"
import { RegPlate } from "@/components/shared/reg-plate"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { InlineApproval } from "@/core/approvals/approvals"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id, SalesOrderRow, VehicleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field, StudioSelect, TotalsBlock, newKey, useStudio, useUserMap } from "@/modules/stl/components/kit"

import { issueConsolidatedInvoice, issueInvoice } from "../commands"
import { creditCheck } from "../invoice"
import { usePartyBalances } from "../queries"

const CREDIT = new Set(["fleet", "dealer", "corporate"])

/**
 * /si/new: a Mushak 6.3 invoice from delivered orders, or the consolidated
 * monthly invoice for a fleet or dealer at one studio for a period (E2).
 * The credit check shows the limit, what is open and what this invoice
 * adds; on hold or over the limit needs an inline credit override by a
 * holder of ar.credit.override (PIN and reason).
 */
export function InvoiceNew() {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const { t, locale } = useLocale()
  const studio = useStudio()
  const loc = studio.locationId
  const users = useUserMap()
  const canIssue = useCan("si.invoice.issue", loc)
  const issue = useCommand(issueInvoice)
  const consolidated = useCommand(issueConsolidatedInvoice)
  const { requestApproval, dialog } = useInlineApproval()
  const today = dhakaDate(now())
  const [mode, setMode] = React.useState<"orders" | "consolidated">(params.get("mode") === "consolidated" ? "consolidated" : "orders")
  const [partyId, setPartyId] = React.useState<Id | null>(params.get("party"))
  const [picked, setPicked] = React.useState<Id[]>([])
  const [from, setFrom] = React.useState(addDaysISO(today, -30))
  const [to, setTo] = React.useState(today)
  const [override, setOverride] = React.useState<InlineApproval | null>(null)

  const data = useLiveQuery(async () => {
    if (!loc) return null
    const delivered = await db.salesOrders.where("[locationId+status]").equals([loc, "delivered"]).toArray()
    const parties = new Map((await db.parties.bulkGet([...new Set(delivered.map((o) => o.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    const vehicles = new Map((await db.vehicles.bulkGet([...new Set(delivered.map((o) => o.vehicleId).filter((v): v is string => !!v))])).filter(Boolean).map((v) => [v!.id, v!]))
    return { delivered, parties, vehicles }
  }, [db, loc])
  const party = useLiveQuery(() => (partyId ? db.parties.get(partyId) : undefined), [db, partyId])
  const balances = usePartyBalances(partyId)

  const ofParty = (data?.delivered ?? []).filter((o) => o.partyId === partyId).sort((a, b) => (a.deliveredAt ?? 0) - (b.deliveredAt ?? 0))
  const inPeriod = ofParty.filter((o) => {
    const day = o.deliveredAt ? dhakaDate(o.deliveredAt) : ""
    return day >= from && day <= to
  })
  const chosen = mode === "orders" ? ofParty.filter((o) => picked.includes(o.id)) : inPeriod
  const subtotal = chosen.reduce((s, o) => s + o.subtotalP, 0)
  const discount = chosen.reduce((s, o) => s + o.discountP, 0)
  const vat = chosen.reduce((s, o) => s + o.vatP, 0)
  const total = chosen.reduce((s, o) => s + o.totalP, 0)
  const advance = Math.min(total, balances?.advanceP ?? 0)
  const isCredit = !!party && (party.paymentTermsDays > 0 || CREDIT.has(party.segment))
  const check = party ? creditCheck(party, balances?.exposureP ?? 0, total - advance) : undefined
  const needsOverride = isCredit && !!check?.needsOverride
  const approver = override ? users.get(override.approverId) : undefined
  const customers = [...new Map((data?.delivered ?? []).map((o) => [o.partyId, data?.parties.get(o.partyId)])).values()].filter(Boolean)

  const askOverride = async () => {
    if (!party) return null
    const inline = await requestApproval({
      kind: "credit-override",
      docType: "salesInvoices",
      locationId: loc,
      amountP: total,
      description: t("si.new.overrideAsk", { party: nameOf(party, locale) }),
    })
    if (inline) setOverride(inline)
    return inline
  }

  const submit = async () => {
    if (!party || !chosen.length) return
    let inline = override
    if (needsOverride && !inline) {
      inline = await askOverride()
      if (!inline) return
    }
    const out =
      mode === "orders"
        ? await issue.run({ orderIds: chosen.map((o) => o.id), inline: needsOverride ? (inline ?? undefined) : undefined, idempotencyKey: newKey() })
        : await consolidated.run({ partyId: party.id, locationId: loc!, from, to, inline: needsOverride ? (inline ?? undefined) : undefined, idempotencyKey: newKey() })
    if (out) router.push(`/si/${out.invoiceId}`)
  }

  return (
    <div className="flex flex-col gap-4" data-testid="invoice-new-page">
      <PageHeader title={t("si.pages.invoiceNew")} subtitle={t("si.new.subtitle")} actions={<StudioSelect value={loc} onChange={studio.setLocationId} studios={studio.studios} />} />
      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as typeof mode)
          setPicked([])
          setOverride(null)
        }}
      >
        <TabsList>
          <TabsTrigger value="orders" data-testid="invoice-mode-orders">
            <FileText className="size-4" />
            {t("si.new.fromOrders")}
          </TabsTrigger>
          <TabsTrigger value="consolidated" data-testid="consolidated-new">
            <FileStack className="size-4" />
            {t("si.new.consolidated")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("common.customer")} size="sm">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <PartyPicker
                value={partyId}
                onChange={(id) => {
                  setPartyId(id)
                  setPicked([])
                  setOverride(null)
                }}
                testId="invoice-party"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {customers
                .filter((p) => mode === "orders" || CREDIT.has(p!.segment))
                .slice(0, 12)
                .map((p) => (
                  <button
                    key={p!.id}
                    type="button"
                    onClick={() => {
                      setPartyId(p!.id)
                      setPicked([])
                      setOverride(null)
                    }}
                    data-testid="invoice-party-chip"
                    className={cn("rounded-full px-3 py-1 text-xs", p!.id === partyId ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground hover:text-foreground")}
                  >
                    {nameOf(p, locale)}
                  </button>
                ))}
            </div>
            {mode === "consolidated" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={t("common.from")}>
                  <DateField value={from} onChange={setFrom} data-testid="consolidated-from" />
                </Field>
                <Field label={t("common.to")}>
                  <DateField value={to} onChange={setTo} max={today} data-testid="consolidated-to" />
                </Field>
              </div>
            ) : null}
          </SectionCard>
          <SectionCard title={mode === "orders" ? t("si.new.deliveredOrders") : t("si.new.ordersInPeriod", { count: inPeriod.length })} size="sm">
            {(mode === "orders" ? ofParty : inPeriod).length ? (
              <ul className="flex flex-col gap-1.5" data-testid="invoice-orders">
                {(mode === "orders" ? ofParty : inPeriod).map((o) => (
                  <OrderLine
                    key={o.id}
                    order={o}
                    vehicle={o.vehicleId ? data?.vehicles.get(o.vehicleId) : undefined}
                    selectable={mode === "orders"}
                    checked={mode === "orders" ? picked.includes(o.id) : true}
                    onToggle={() => setPicked((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]))}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{partyId ? t("si.new.noOrders") : t("si.new.pickCustomer")}</p>
            )}
          </SectionCard>
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard title={t("si.new.summary")} size="sm">
            <TotalsBlock
              rows={[
                { label: t("common.subtotal"), valueP: subtotal },
                { label: t("common.discount"), valueP: discount, negative: true },
                { label: t("common.vat"), valueP: vat },
                { label: t("common.total"), valueP: total, strong: true, testId: "invoice-total" },
                { label: t("si.counter.advance"), valueP: advance, negative: true },
              ]}
            />
          </SectionCard>
          {party && isCredit ? (
            <SectionCard title={t("si.new.creditCheck")} icon={needsOverride ? ShieldAlert : ShieldCheck} size="sm">
              <dl className="flex flex-col gap-1.5 text-[0.8125rem]" data-testid="credit-panel" data-needs-override={needsOverride || undefined}>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t("si.new.limit")}</dt>
                  <dd className="font-mono">
                    <MoneyText poisha={party.creditLimitP} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t("si.new.outstanding")}</dt>
                  <dd className="font-mono">
                    <MoneyText poisha={balances?.exposureP ?? 0} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t("si.new.thisInvoice")}</dt>
                  <dd className="font-mono">
                    <MoneyText poisha={total - advance} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-hairline pt-1.5 font-semibold">
                  <dt>{t("si.new.after")}</dt>
                  <dd className={cn("font-mono", check?.over && "text-destructive")}>
                    <MoneyText poisha={check?.afterP ?? 0} />
                  </dd>
                </div>
              </dl>
              {needsOverride ? (
                <div className="mt-3 flex flex-col gap-2 rounded-md bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] p-3 text-[0.8125rem]">
                  <p className="font-medium">{check?.onHold ? t("si.new.onHold") : t("si.new.overLimit")}</p>
                  {override ? (
                    <p className="text-success" data-testid="credit-override-granted">
                      {t("si.new.overrideBy", { name: userName(approver, locale) })}
                    </p>
                  ) : (
                    <Button variant="outline" size="sm" onClick={askOverride} disabled={!chosen.length} data-testid="credit-override">
                      <ShieldCheck data-icon="inline-start" />
                      {t("si.new.requestOverride")}
                    </Button>
                  )}
                </div>
              ) : null}
            </SectionCard>
          ) : null}
          <Button size="lg" disabled={!canIssue || !chosen.length || issue.pending || consolidated.pending} onClick={submit} data-testid={mode === "orders" ? "invoice-issue" : "consolidated-issue"}>
            {mode === "orders" ? t("si.new.issue") : t("si.new.issueConsolidated", { count: chosen.length })}
          </Button>
          {!canIssue ? <p className="text-xs text-muted-foreground">{t("stl.noPermission")}</p> : null}
        </aside>
      </div>
      {dialog}
    </div>
  )
}

function OrderLine({ order, vehicle, selectable, checked, onToggle }: { order: SalesOrderRow; vehicle?: VehicleRow; selectable: boolean; checked: boolean; onToggle: () => void }) {
  const content = (
    <>
      {selectable ? <Checkbox checked={checked} onCheckedChange={onToggle} /> : null}
      <span lang="en" className="font-mono text-xs">{order.orderNo}</span>
      {vehicle ? <RegPlate regNo={vehicle.regNo} /> : null}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{order.deliveredAt ? <DateText value={order.deliveredAt} /> : null}</span>
      <MoneyText poisha={order.totalP} className="font-mono text-[0.8125rem]" />
    </>
  )
  return (
    <li data-testid="invoice-order" data-order-no={order.orderNo}>
      {selectable ? (
        <label className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2", checked ? "bg-primary-soft" : "bg-surface-raised/60")}>{content}</label>
      ) : (
        <div className="flex items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2">{content}</div>
      )}
    </li>
  )
}
