"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangle, CalendarClock, Hourglass, PauseCircle, Plus, ReceiptText, Wallet } from "lucide-react"

import { ApprovalChip } from "@/components/shared/approval-chip"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { useSyncFlash } from "@/components/shell/use-sync-flash"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { apOpenItems } from "@/modules/ar/queries"
import { LinkButton, useToday } from "@/modules/par/components/kit"

/** /ap: payables home (plan §9): due this week, overdue, on hold, payments waiting. */
export function ApHome() {
  const db = useDb()
  const today = useToday()
  const { t, locale, num, money, dmy } = useLocale()
  const { can } = usePermissions()

  const data = useLiveQuery(async () => {
    if (!today) return undefined
    const [items, held, pendingPay, recent] = await Promise.all([
      apOpenItems(db, today),
      db.vendorBills.where("status").equals("on-hold").toArray(),
      db.vendorPayments.where("status").equals("pending-approval").toArray(),
      db.vendorPayments.where("status").equals("posted").toArray(),
    ])
    const ids = new Set([...held.map((b) => b.partyId), ...pendingPay.map((p) => p.partyId), ...recent.map((p) => p.partyId)])
    const parties = new Map((await db.parties.bulkGet([...ids])).filter(Boolean).map((p) => [p!.id, p!]))
    const approvals = new Map((await db.approvals.bulkGet(held.flatMap((b) => (b.holdApprovalId ? [b.holdApprovalId] : []))).then((r) => r.filter(Boolean).map((a) => [a!.id, a!]))))
    return {
      items,
      held: held.filter((b) => !b.holdApprovalId || approvals.get(b.holdApprovalId)?.status === "pending"),
      pendingPay,
      recent: recent.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.paymentNo.localeCompare(a.paymentNo))).slice(0, 6),
      parties,
    }
  }, [db, today])

  const k = React.useMemo(() => {
    if (!data || !today) return null
    const week = addDaysISO(today, 7)
    let outstanding = 0
    let overdue = 0
    let dueWeek = 0
    const dueList = []
    for (const i of data.items) {
      outstanding += i.openP
      if (i.dpd > 0) overdue += i.openP
      else if (i.bill.dueDate <= week) {
        dueWeek += i.openP
        dueList.push(i)
      }
    }
    dueList.sort((a, b) => (a.bill.dueDate < b.bill.dueDate ? -1 : 1))
    return { outstanding, overdue, dueWeek, dueList }
  }, [data, today])
  const flash = useSyncFlash(k ? `${k.outstanding}|${data?.held.length}|${data?.pendingPay.length}` : undefined)

  return (
    <div className="flex flex-col gap-5" data-testid="ap-home">
      <PageHeader
        title={t("ap.pages.home")}
        subtitle={t("ap.home.subtitle")}
        actions={
          <>
            {can("ap.bill.create") ? (
              <LinkButton href="/ap/bills/new" variant="outline" testId="bill-new">
                <Plus />
                {t("ap.bills.new")}
              </LinkButton>
            ) : null}
            {can("ap.payment.create") ? (
              <LinkButton href="/ap/payments/new" testId="payment-new">
                <Plus />
                {t("ap.payments.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <KpiGrid className={flash}>
        <KpiCard variant="cyan" icon={Wallet} title={t("ap.home.outstanding")} value={k ? money(k.outstanding) : "…"} caption={data ? t("ap.home.billsOpen", { count: num(data.items.length) }) : undefined} href="/ap/aging" />
        <KpiCard variant="yellow" icon={CalendarClock} title={t("ap.home.dueWeek")} value={k ? money(k.dueWeek) : "…"} caption={k ? t("ap.home.billsCount", { count: num(k.dueList.length) }) : undefined} href="/ap/bills" />
        <KpiCard variant="pink" icon={AlertTriangle} title={t("ap.home.overdue")} value={k ? money(k.overdue) : "…"} href="/ap/aging" />
        <KpiCard variant="purple" icon={PauseCircle} title={t("ap.home.onHold")} value={data ? num(data.held.length) : "…"} caption={t("ap.home.billsCount", { count: num(data?.held.length ?? 0) })} href="/ap/bills" />
      </KpiGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t("ap.home.dueList")} size="sm" seeAllHref="/ap/aging" icon={CalendarClock}>
          {k?.dueList.length ? (
            <ul className="flex flex-col">
              {k.dueList.slice(0, 8).map((i) => (
                <li key={i.bill.id} className="flex items-center gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0">
                  <DocLink docType="vendorBills" docId={i.bill.id} docNo={i.bill.billNo} showApp={false} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{nameOf(i.vendor, locale)}</span>
                  <span className="text-xs text-muted-foreground">{t("ap.home.due", { date: dmy(i.bill.dueDate) })}</span>
                  <MoneyText poisha={i.openP} className="font-mono" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={CalendarClock} title={t("ap.home.noDue")} size="sm" />
          )}
        </SectionCard>
        <SectionCard title={t("ap.home.holdList")} size="sm" seeAllHref="/ap/bills" icon={PauseCircle}>
          {data?.held.length ? (
            <ul className="flex flex-col">
              {data.held.map((b) => (
                <li key={b.id} className="flex flex-col gap-1 border-b border-hairline py-2 text-[0.8125rem] last:border-0">
                  <div className="flex items-center gap-2">
                    <DocLink docType="vendorBills" docId={b.id} docNo={b.billNo} showApp={false} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{nameOf(data.parties.get(b.partyId), locale)}</span>
                    <MoneyText poisha={b.totalP} className="font-mono" />
                  </div>
                  {b.holdApprovalId ? <ApprovalChip approvalId={b.holdApprovalId} className="self-start" /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={PauseCircle} title={t("ap.home.noHolds")} size="sm" />
          )}
        </SectionCard>
        <SectionCard title={t("ap.home.pendingPayments")} size="sm" seeAllHref="/ap/payments" icon={Hourglass}>
          {data?.pendingPay.length ? (
            <ul className="flex flex-col">
              {data.pendingPay.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 border-b border-hairline py-2 text-[0.8125rem] last:border-0">
                  <div className="flex items-center gap-2">
                    <DocLink docType="vendorPayments" docId={p.id} docNo={p.paymentNo} showApp={false} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{nameOf(data.parties.get(p.partyId), locale)}</span>
                    <MoneyText poisha={p.grossP} className="font-mono" />
                  </div>
                  {p.approvalId ? <ApprovalChip approvalId={p.approvalId} className="self-start" /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Hourglass} title={t("ap.home.noPending")} size="sm" />
          )}
        </SectionCard>
        <SectionCard title={t("ap.home.recentPayments")} size="sm" seeAllHref="/ap/payments" icon={ReceiptText}>
          {data?.recent.length ? (
            <ul className="flex flex-col">
              {data.recent.map((p) => (
                <li key={p.id} className="flex items-center gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0">
                  <DocLink docType="vendorPayments" docId={p.id} docNo={p.paymentNo} showApp={false} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{nameOf(data.parties.get(p.partyId), locale)}</span>
                  <DocStatus status={p.status} className="hidden sm:inline-flex" />
                  <MoneyText poisha={p.netPaidP} className="font-mono" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ReceiptText} title={t("ap.home.noPayments")} size="sm" />
          )}
        </SectionCard>
      </div>
    </div>
  )
}
