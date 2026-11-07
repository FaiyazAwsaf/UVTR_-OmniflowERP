"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangle, Banknote, ChevronRight, Clock, Plus, ShieldOff, Wallet } from "lucide-react"

import { PartyAvatar } from "@/components/shared/avatars"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { useSyncFlash } from "@/components/shell/use-sync-flash"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { LinkButton, useToday } from "@/modules/par/components/kit"

import { arOpenItems } from "../queries"

/** /ar: receivables home (plan §9): outstanding, overdue, collections today, holds. */
export function ArHome() {
  const db = useDb()
  const today = useToday()
  const { t, tk, locale, num, money, dmy } = useLocale()
  const { can } = usePermissions()

  const data = useLiveQuery(async () => {
    if (!today) return undefined
    const [items, receiptsToday, held, cheques] = await Promise.all([
      arOpenItems(db, today),
      db.receipts.where("date").equals(today).toArray(),
      db.parties.where("status").anyOf("on-hold", "blocked").toArray(),
      db.cheques.where("status").equals("in-hand").toArray(),
    ])
    const parties = new Map((await db.parties.bulkGet([...new Set([...receiptsToday.map((r) => r.partyId), ...cheques.map((c) => c.partyId)])])).filter(Boolean).map((p) => [p!.id, p!]))
    return { items, receiptsToday: receiptsToday.filter((r) => r.status === "posted"), held: held.filter((p) => p.isCustomer), cheques: cheques.filter((c) => c.direction === "received"), parties }
  }, [db, today])

  const k = React.useMemo(() => {
    if (!data) return null
    let outstanding = 0
    let overdue = 0
    let overdueCount = 0
    const byParty = new Map<string, { party: PartyRow | undefined; overdueP: number; oldest: number }>()
    for (const i of data.items) {
      outstanding += i.openP
      if (i.dpd > 0) {
        overdue += i.openP
        overdueCount += 1
        const e = byParty.get(i.invoice.partyId) ?? { party: i.party, overdueP: 0, oldest: 0 }
        e.overdueP += i.openP
        e.oldest = Math.max(e.oldest, i.dpd)
        byParty.set(i.invoice.partyId, e)
      }
    }
    const collected = data.receiptsToday.reduce((s, r) => s + r.amountP, 0)
    const top = [...byParty.entries()].sort((a, b) => b[1].overdueP - a[1].overdueP).slice(0, 6)
    return { outstanding, overdue, overdueCount, collected, top }
  }, [data])
  const flash = useSyncFlash(k ? `${k.outstanding}|${k.collected}` : undefined)

  return (
    <div className="flex flex-col gap-5" data-testid="ar-home">
      <PageHeader
        title={t("ar.pages.home")}
        subtitle={t("ar.home.subtitle")}
        actions={
          <>
            <LinkButton href="/ar/aging" variant="neutral" size="sm">
              {t("ar.pages.aging")}
            </LinkButton>
            {can("ar.receipt.create") ? (
              <LinkButton href="/ar/receipts/new" testId="receipt-new">
                <Plus />
                {t("ar.receipts.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <KpiGrid className={flash}>
        <KpiCard variant="cyan" icon={Wallet} title={t("ar.home.outstanding")} value={k ? money(k.outstanding) : "…"} caption={data ? t("ar.home.invoicesOpen", { count: num(data.items.length) }) : undefined} href="/ar/aging" />
        <KpiCard variant="pink" icon={AlertTriangle} title={t("ar.home.overdue")} value={k ? money(k.overdue) : "…"} caption={k ? t("ar.home.pastDue", { count: num(k.overdueCount) }) : undefined} href="/ar/aging" />
        <KpiCard variant="yellow" icon={Banknote} title={t("ar.home.collectionsToday")} value={k ? money(k.collected) : "…"} caption={data ? t("ar.home.receiptsToday", { count: num(data.receiptsToday.length) }) : undefined} href="/ar/receipts" />
        <KpiCard variant="purple" icon={ShieldOff} title={t("ar.home.onHold")} value={data ? num(data.held.length) : "…"} caption={t("ar.home.partiesHeld", { count: num(data?.held.length ?? 0) })} href="/ar/credit-control" />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <SectionCard title={t("ar.home.topOverdue")} seeAllHref="/ar/aging" size="sm">
          {k?.top.length ? (
            <ul className="flex flex-col">
              {k.top.map(([partyId, e]) => (
                <li key={partyId}>
                  <Link href={`/par/${partyId}`} className="flex items-center gap-3 rounded-md px-1 py-2 hover:bg-primary-soft">
                    {e.party ? <PartyAvatar party={e.party} size={32} /> : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{nameOf(e.party, locale)}</span>
                      <span className="text-xs text-muted-foreground">{t("ar.home.oldest", { days: num(e.oldest) })}</span>
                    </span>
                    <MoneyText poisha={e.overdueP} className="font-mono text-sm font-semibold text-destructive" />
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Clock} title={t("ar.home.noOverdue")} size="sm" />
          )}
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard title={t("ar.home.todayReceipts")} seeAllHref="/ar/receipts" size="sm">
            {data?.receiptsToday.length ? (
              <ul className="flex max-h-64 flex-col overflow-y-auto">
                {data.receiptsToday
                  .slice()
                  .sort((a, b) => b.at - a.at)
                  .slice(0, 8)
                  .map((r) => (
                    <li key={r.id} className="flex items-center gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0">
                      <DocLink docType="receipts" docId={r.id} docNo={r.receiptNo} showApp={false} />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{nameOf(data.parties.get(r.partyId), locale)}</span>
                      <span className="text-xs text-muted-foreground">{tk(`ar.method.${r.method}`)}</span>
                      <MoneyText poisha={r.amountP} className="font-mono" />
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState icon={Banknote} title={t("ar.home.noReceipts")} size="sm" />
            )}
          </SectionCard>
          <SectionCard title={t("ar.home.chequesInHand")} seeAllHref="/cab/cheques" size="sm">
            {data?.cheques.length ? (
              <ul className="flex flex-col">
                {data.cheques.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0">
                    <span lang="en" className="font-mono">
                      {c.chequeNo}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{nameOf(data.parties.get(c.partyId), locale)}</span>
                    <span className="text-xs text-muted-foreground">{t("ar.home.due", { date: dmy(c.chequeDate) })}</span>
                    <MoneyText poisha={c.amountP} className="font-mono" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Banknote} title={t("ar.home.noCheques")} size="sm" />
            )}
          </SectionCard>
          <SectionCard title={t("ar.home.holds")} seeAllHref="/ar/credit-control" size="sm">
            {data?.held.length ? (
              <ul className="flex flex-col">
                {data.held.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5 text-[0.8125rem]">
                    <Link href={`/par/${p.id}`} className="min-w-0 flex-1 truncate font-medium text-link hover:underline">
                      {nameOf(p, locale)}
                    </Link>
                    <DocStatus status={p.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={ShieldOff} title={t("ar.home.noHolds")} size="sm" />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
