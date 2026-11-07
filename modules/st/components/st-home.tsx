"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeftRight, ChevronRight, ClipboardMinus, Clock, PackageCheck, Truck } from "lucide-react"

import { DocStatus } from "@/components/shared/doc-status"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { TransferRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { useScmLookups } from "@/modules/ic/components/scm-ui"

import { RequestTransferDialog } from "./transfers"

/** /st: what waits in stock transactions for this user (to dispatch, to receive, adjustments for approval). */
export function StHome() {
  const db = useDb()
  const router = useRouter()
  const { t, locale, money, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const today = dhakaDate(useNow(60_000))
  const [requesting, setRequesting] = React.useState(false)

  const data = useLiveQuery(async () => {
    const [requested, dispatched, pending, moves] = await Promise.all([
      db.transfers.where("status").equals("requested").toArray(),
      db.transfers.where("status").equals("dispatched").toArray(),
      db.stockAdjustments.where("status").equals("pending-approval").toArray(),
      db.stockMoves.where("date").equals(today).count(),
    ])
    let transitP = 0
    for (const tr of dispatched) for (const l of await db.transferLines.where("transferId").equals(tr.id).toArray()) transitP += l.valueP
    return { requested, dispatched, pending, moves, transitP }
  }, [db, today])

  const toDispatch = (data?.requested ?? []).filter((tr) => can("st.transfer.dispatch", tr.fromLocationId))
  const toReceive = (data?.dispatched ?? []).filter((tr) => can("st.transfer.receive", tr.toLocationId))
  const loc = (id: string) => nameOf(lookups?.locations.get(id), locale)
  const canRequest = (lookups?.stockLocations ?? []).some((l) => can("st.transfer.request", l.id))

  const renderTransfers = (rows: TransferRow[], testId: string) =>
    rows.length ? (
      <ul className="flex flex-col divide-y divide-hairline" data-testid={testId}>
        {rows.slice(0, 8).map((tr) => (
          <li key={tr.id}>
            <Link href={`/st/transfers/${tr.id}`} className="flex items-center gap-3 py-2.5 hover:text-link">
              <span className="icon-well flex size-9 shrink-0 items-center justify-center text-link">
                <ArrowLeftRight className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span lang="en" className="block font-mono text-[0.8125rem] font-semibold">
                  {tr.transferNo}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {loc(tr.fromLocationId)} → {loc(tr.toLocationId)} · {dmy(tr.dispatchedAt ?? tr.requestedAt)}
                </span>
              </span>
              <DocStatus status={tr.status === "dispatched" ? "in-transit" : tr.status} />
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-[0.8125rem] text-muted-foreground">{t("st.home.nothing")}</p>
    )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("st.home.title")}
        subtitle={t("st.home.subtitle")}
        actions={
          <>
            {canRequest ? (
              <Button onClick={() => setRequesting(true)} data-testid="transfer-new">
                <ArrowLeftRight />
                {t("st.home.newTransfer")}
              </Button>
            ) : null}
            <Link href="/st/adjustments" className={buttonVariants({ variant: "outline" })}>
              <ClipboardMinus />
              {t("st.home.newAdjustment")}
            </Link>
          </>
        }
      />
      <KpiGrid>
        <KpiCard variant="cyan" icon={Truck} title={t("st.home.kpiRequested")} value={num(toDispatch.length)} href="/st/transfers" />
        <KpiCard
          variant="yellow"
          icon={PackageCheck}
          title={t("st.home.kpiTransit")}
          value={num(data?.dispatched.length ?? 0)}
          caption={t("st.home.kpiTransitCaption", { value: money(data?.transitP ?? 0) })}
          href="/st/transfers"
        />
        <KpiCard variant="pink" icon={Clock} title={t("st.home.kpiPending")} value={num(data?.pending.length ?? 0)} href="/st/adjustments" />
        <KpiCard variant="purple" icon={ClipboardMinus} title={t("st.home.kpiIssued")} value={num(data?.moves ?? 0)} href="/ic" />
      </KpiGrid>
      <div className="@container/home">
        <div className="grid gap-5 @min-[60rem]/home:grid-cols-3">
          <SectionCard title={t("st.home.toDispatch")} seeAllHref="/st/transfers" size="sm">
            {renderTransfers(toDispatch, "st-to-dispatch")}
          </SectionCard>
          <SectionCard title={t("st.home.toReceive")} seeAllHref="/st/transfers" size="sm">
            {renderTransfers(toReceive, "st-to-receive")}
          </SectionCard>
          <SectionCard title={t("st.home.pending")} seeAllHref="/st/adjustments" size="sm">
            {data?.pending.length ? (
              <ul className="flex flex-col divide-y divide-hairline">
                {data.pending.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span lang="en" className="block font-mono text-[0.8125rem] font-semibold">
                        {a.adjustmentNo}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{loc(a.locationId)}</span>
                    </span>
                    <MoneyText poisha={a.lines.reduce((s, l) => s + l.valueP, 0)} colorize />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{t("st.home.nothing")}</p>
            )}
          </SectionCard>
        </div>
      </div>
      <RequestTransferDialog open={requesting} onOpenChange={setRequesting} onDone={(id) => router.push(`/st/transfers/${id}`)} />
    </div>
  )
}
