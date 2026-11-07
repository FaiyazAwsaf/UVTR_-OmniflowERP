"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeftRight, Banknote, CalendarClock, CreditCard, Landmark, Wallet } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { useSyncFlash } from "@/components/shell/use-sync-flash"
import { locations } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { LinkButton, useToday } from "@/modules/par/components/kit"

import { canSeeAccount } from "../lib"
import { cashPosition, KIND_ORDER, type PositionRow } from "../queries"

/** /cab: cash position across tills, petty cash, banks, wallets and card clearing (plan §9). */
export function CashPosition() {
  const db = useDb()
  const today = useToday()
  const { t, tk, locale, money, dmy } = useLocale()
  const { can } = usePermissions()
  const data = useLiveQuery(async () => {
    if (!today) return undefined
    const [all, cheques] = await Promise.all([cashPosition(db, today), db.cheques.where("status").equals("in-hand").toArray()])
    // Own-location roles see their location's till and petty cash only (banks, wallets and cheques are Head Office's).
    const rows = all.filter((r) => canSeeAccount(can, r.account))
    const accounts = new Map(all.map((r) => [r.account.id, r.account]))
    const soon = cheques
      .filter((c) => c.direction === "received" && c.chequeDate <= addDaysISO(today, 7) && canSeeAccount(can, accounts.get(c.cashBankAccountId)))
      .sort((a, b) => (a.chequeDate < b.chequeDate ? -1 : 1))
    const parties = new Map((await db.parties.bulkGet([...new Set(soon.map((c) => c.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return { rows, soon, parties }
  }, [db, today, can])

  const shows = (kinds: string[]) => (data?.rows ?? []).some((r) => kinds.includes(r.account.kind))
  const sums = React.useMemo(() => {
    const by = (kinds: string[]) => (data?.rows ?? []).filter((r) => kinds.includes(r.account.kind)).reduce((s, r) => s + r.balanceP, 0)
    return { tills: by(["cash-till"]), banks: by(["bank"]), wallets: by(["mfs", "card-clearing"]), petty: by(["petty-cash"]) }
  }, [data])
  const flash = useSyncFlash(data ? JSON.stringify(sums) : undefined)
  const groups = KIND_ORDER.map((kind) => ({ kind, rows: (data?.rows ?? []).filter((r) => r.account.kind === kind) })).filter((g) => g.rows.length)
  const total = (data?.rows ?? []).reduce(
    (s, r) => ({ opening: s.opening + r.openingP, in: s.in + r.inP, out: s.out + r.outP, balance: s.balance + r.balanceP }),
    { opening: 0, in: 0, out: 0, balance: 0 }
  )

  const row = (r: PositionRow) => {
    const loc = locations.find((l) => l.id === r.account.locationId)
    return (
      <tr key={r.account.id} className="transition-colors hover:bg-primary-soft [&>td]:border-b [&>td]:border-hairline [&>td]:px-3 [&>td]:py-2" data-testid="position-row" data-account={r.account.code}>
        <td>
          <Link href={`/cab/accounts/${r.account.id}`} className="flex flex-col">
            <span className="font-medium text-link hover:underline">{nameOf(r.account, locale)}</span>
            <span lang="en" className="font-mono text-xs text-muted-foreground">
              {r.account.code}
              {r.account.accountNoMasked ? ` · ${r.account.accountNoMasked}` : ""}
              {r.account.floatP ? ` · ${t("cab.home.floatNote", { amount: money(r.account.floatP) })}` : ""}
              {r.account.imprestP ? ` · ${t("cab.home.imprestNote", { amount: money(r.account.imprestP) })}` : ""}
            </span>
          </Link>
        </td>
        <td className="hidden text-muted-foreground @min-[44rem]/pos:table-cell">{loc ? loc.name[locale] : "-"}</td>
        <td className="hidden text-right @min-[36rem]/pos:table-cell">
          <MoneyText poisha={r.openingP} className="font-mono" />
        </td>
        <td className="hidden text-right @min-[30rem]/pos:table-cell">
          <MoneyText poisha={r.inP} className="font-mono text-success" />
        </td>
        <td className="hidden text-right @min-[30rem]/pos:table-cell">
          <MoneyText poisha={r.outP} className="font-mono" />
        </td>
        <td className="text-right">
          <MoneyText poisha={r.balanceP} className={cn("font-mono font-semibold", r.balanceP < 0 && "text-destructive")} />
        </td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col gap-5" data-testid="cab-home">
      <PageHeader
        title={t("cab.pages.home")}
        subtitle={t("cab.home.subtitle")}
        actions={
          can("cab.transfer.create") ? (
            <LinkButton href="/cab/transfers?new=1" testId="transfer-new">
              <ArrowLeftRight />
              {t("cab.home.transfer")}
            </LinkButton>
          ) : null
        }
      />
      <KpiGrid className={flash}>
        {!data || shows(["cash-till"]) ? <KpiCard variant="cyan" icon={Banknote} title={t("cab.home.tills")} value={data ? money(sums.tills) : "…"} /> : null}
        {!data || shows(["bank"]) ? <KpiCard variant="yellow" icon={Landmark} title={t("cab.home.banks")} value={data ? money(sums.banks) : "…"} /> : null}
        {!data || shows(["mfs", "card-clearing"]) ? <KpiCard variant="pink" icon={CreditCard} title={t("cab.home.wallets")} value={data ? money(sums.wallets) : "…"} href="/cab/settlements" /> : null}
        {!data || shows(["petty-cash"]) ? <KpiCard variant="purple" icon={Wallet} title={t("cab.home.petty")} value={data ? money(sums.petty) : "…"} href="/cab/petty-cash" /> : null}
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard title={t("cab.home.position")} subtitle={today ? dmy(today) : undefined} size="sm">
          <div className="@container/pos min-w-0 overflow-x-auto" data-testid="cash-position">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="[&>th]:h-10 [&>th]:bg-surface-raised [&>th]:px-3 [&>th]:font-medium [&>th]:whitespace-nowrap">
                  <th className="rounded-l-md text-left">{t("cab.home.colAccount")}</th>
                  <th className="hidden text-left @min-[44rem]/pos:table-cell">{t("cab.home.colLocation")}</th>
                  <th className="hidden text-right @min-[36rem]/pos:table-cell">{t("cab.home.colOpening")}</th>
                  <th className="hidden text-right @min-[30rem]/pos:table-cell">{t("cab.home.colIn")}</th>
                  <th className="hidden text-right @min-[30rem]/pos:table-cell">{t("cab.home.colOut")}</th>
                  <th className="rounded-r-md text-right">{t("cab.home.colBalance")}</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.kind}>
                  <tr>
                    <td colSpan={6} className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {tk(`cab.kind.${g.kind}`)}
                    </td>
                  </tr>
                  {g.rows.map(row)}
                </tbody>
              ))}
              <tfoot>
                <tr className="font-semibold [&>td]:bg-surface-raised [&>td]:px-3 [&>td]:py-2">
                  <td className="rounded-l-md">{t("cab.home.total")}</td>
                  <td className="hidden @min-[44rem]/pos:table-cell" />
                  <td className="hidden text-right @min-[36rem]/pos:table-cell">
                    <MoneyText poisha={total.opening} className="font-mono" />
                  </td>
                  <td className="hidden text-right @min-[30rem]/pos:table-cell">
                    <MoneyText poisha={total.in} className="font-mono" />
                  </td>
                  <td className="hidden text-right @min-[30rem]/pos:table-cell">
                    <MoneyText poisha={total.out} className="font-mono" />
                  </td>
                  <td className="rounded-r-md text-right">
                    <MoneyText poisha={total.balance} className="font-mono" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>
        <SectionCard title={t("cab.home.pdcSoon")} size="sm" seeAllHref="/cab/cheques" icon={CalendarClock}>
          {data?.soon.length ? (
            <ul className="flex flex-col">
              {data.soon.map((c) => (
                <li key={c.id} className="flex flex-col gap-0.5 border-b border-hairline py-2 text-[0.8125rem] last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/cab/cheques?id=${c.id}`} lang="en" className="font-mono text-link hover:underline">
                      {c.chequeNo}
                    </Link>
                    <MoneyText poisha={c.amountP} className="font-mono" />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{nameOf(data.parties.get(c.partyId), locale)}</span>
                    <span className={cn(c.chequeDate <= today && "font-medium text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning")}>{dmy(c.chequeDate)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={CalendarClock} title={t("cab.home.noPdc")} size="sm" />
          )}
        </SectionCard>
      </div>
    </div>
  )
}
