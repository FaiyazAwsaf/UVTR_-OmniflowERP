"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { AlarmClock, ChevronRight, ClipboardCheck, FilePlus2, ShoppingCart, Truck } from "lucide-react"

import { DocStatus } from "@/components/shared/doc-status"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { buttonVariants } from "@/components/ui/button"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { PurchaseOrderRow, PurchaseRequisitionRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { useScmLookups } from "@/modules/ic/components/scm-ui"

/** /ptl: requisitions to approve, approved ones ready for a PO, POs overdue and recent POs. */
export function PtlHome() {
  const db = useDb()
  const { t, locale, money, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const today = dhakaDate(useNow(60_000))
  const data = useLiveQuery(async () => {
    const [prs, pos] = await Promise.all([db.purchaseRequisitions.toArray(), db.purchaseOrders.toArray()])
    const open = pos.filter((p) => p.status === "issued" || p.status === "partial")
    return {
      toApprove: prs.filter((p) => p.status === "pending-approval").sort((a, b) => b.createdAt - a.createdAt),
      approved: prs.filter((p) => p.status === "approved").sort((a, b) => b.createdAt - a.createdAt),
      open,
      pendingPos: pos.filter((p) => p.status === "pending-approval"),
      recent: [...pos].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8),
    }
  }, [db])
  const overdue = (data?.open ?? []).filter((p) => p.expectedDate < today)
  const onOrderP = (data?.open ?? []).reduce((s, p) => s + p.totalP, 0)

  const prItem = (pr: PurchaseRequisitionRow) => (
    <li key={pr.id}>
      <Link href={`/ptl/requisitions/${pr.id}`} className="flex items-center gap-3 py-2.5 hover:text-link" data-testid="home-pr">
        <span className="min-w-0 flex-1">
          <span lang="en" className="block font-mono text-[0.8125rem] font-semibold">
            {pr.prNo}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {userName(lookups?.users.get(pr.requestedBy), locale)} · {nameOf(lookups?.locations.get(pr.locationId), locale)} · {dmy(pr.date)}
          </span>
        </span>
        <MoneyText poisha={pr.totalP} />
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </li>
  )
  const poItem = (po: PurchaseOrderRow) => (
    <li key={po.id}>
      <Link href={`/ptl/po/${po.id}`} className="flex items-center gap-3 py-2.5 hover:text-link">
        <span className="min-w-0 flex-1">
          <span lang="en" className="block font-mono text-[0.8125rem] font-semibold">
            {po.poNo}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {nameOf(lookups?.vendors.get(po.vendorId), locale)} · {dmy(po.expectedDate)}
          </span>
        </span>
        <DocStatus status={po.status} />
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </li>
  )
  const list = (rows: React.ReactNode[]) =>
    rows.length ? <ul className="flex flex-col divide-y divide-hairline">{rows}</ul> : <p className="text-[0.8125rem] text-muted-foreground">{t("ptl.home.nothing")}</p>

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("ptl.home.title")}
        subtitle={t("ptl.home.subtitle")}
        actions={
          <>
            {can("ptl.pr.create") ? (
              <Link href="/ptl/requisitions/new" className={buttonVariants({ variant: "outline" })} data-testid="pr-new">
                <FilePlus2 />
                {t("ptl.home.newPr")}
              </Link>
            ) : null}
            {can("ptl.po.create") ? (
              <Link href="/ptl/po/new" className={buttonVariants()} data-testid="po-new">
                <ShoppingCart />
                {t("ptl.home.newPo")}
              </Link>
            ) : null}
          </>
        }
      />
      <KpiGrid>
        <KpiCard variant="cyan" icon={ClipboardCheck} title={t("ptl.home.kpiToApprove")} value={num(data?.toApprove.length ?? 0)} href="/approvals" />
        <KpiCard
          variant="yellow"
          icon={Truck}
          title={t("ptl.home.kpiOpen")}
          value={num(data?.open.length ?? 0)}
          caption={t("ptl.home.kpiOpenCaption", { count: num(data?.pendingPos.length ?? 0) })}
          href="/ptl/po"
        />
        <KpiCard variant="pink" icon={AlarmClock} title={t("ptl.home.kpiOverdue")} value={num(overdue.length)} href="/grn" />
        <KpiCard variant="purple" icon={ShoppingCart} title={t("ptl.home.kpiOnOrder")} value={money(onOrderP)} href="/ptl/po" />
      </KpiGrid>
      <div className="@container/home">
        <div className="grid gap-5 @min-[56rem]/home:grid-cols-2">
          <SectionCard title={t("ptl.home.toApprove")} seeAllHref="/ptl/requisitions" size="sm">
            {list((data?.toApprove ?? []).slice(0, 6).map(prItem))}
            {data?.toApprove.length && can("ptl.pr.approve") ? (
              <Link href="/approvals" className="mt-2 inline-block text-[0.8125rem] text-link hover:underline">
                {t("ptl.home.inbox")}
              </Link>
            ) : null}
          </SectionCard>
          <SectionCard title={t("ptl.home.approvedReady")} seeAllHref="/ptl/requisitions" size="sm">
            {list((data?.approved ?? []).slice(0, 6).map(prItem))}
          </SectionCard>
          <SectionCard title={t("ptl.home.overdue")} seeAllHref="/grn" size="sm">
            {list(overdue.slice(0, 6).map(poItem))}
          </SectionCard>
          <SectionCard title={t("ptl.home.recent")} seeAllHref="/ptl/po" size="sm">
            {list((data?.recent ?? []).map(poItem))}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
