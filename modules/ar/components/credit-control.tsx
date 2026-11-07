"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { BellRing, MessageSquare, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, useUserMap, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { ListTable, useToday, type Column } from "@/modules/par/components/kit"

import { sendReminder } from "../commands"
import { invoiceOpenP, daysPastDue } from "../lib"

type Row = { party: PartyRow; exposureP: number; overdueP: number; oldest: number }

/** /ar/credit-control: limits, exposure, holds, credit overrides and reminders (plan §9). */
export function CreditControl() {
  const db = useDb()
  const today = useToday()
  const { t, locale, num } = useLocale()
  const { can } = usePermissions()
  const users = useUserMap()
  const remind = useCommand(sendReminder)

  const data = useLiveQuery(async () => {
    if (!today) return undefined
    const parties = (await db.parties.toArray()).filter((p) => p.isCustomer)
    const credit = parties.filter((p) => p.creditLimitP > 0 || p.status !== "active")
    const rows: Row[] = []
    for (const party of credit) {
      const invoices = await db.salesInvoices.where("partyId").equals(party.id).toArray()
      let exposureP = 0
      let overdueP = 0
      let oldest = 0
      for (const i of invoices) {
        const open = invoiceOpenP(i)
        if (open <= 0) continue
        exposureP += open
        const dpd = daysPastDue(i.dueDate, today)
        if (dpd > 0) {
          overdueP += open
          oldest = Math.max(oldest, dpd)
        }
      }
      rows.push({ party, exposureP, overdueP, oldest })
    }
    const overrides = (await db.approvals.where("kind").equals("credit-override").toArray()).sort((a, b) => (b.decidedAt ?? b.requestedAt) - (a.decidedAt ?? a.requestedAt))
    const reminders = (await db.sms.toArray()).filter((s) => s.templateId === "invoice-due").sort((a, b) => b.queuedAt - a.queuedAt).slice(0, 20)
    const all = new Map(parties.map((p) => [p.id, p]))
    return { rows: rows.sort((a, b) => b.overdueP - a.overdueP || b.exposureP - a.exposureP), overrides, reminders, parties: all }
  }, [db, today])

  const columns: Column<Row>[] = [
    {
      key: "party",
      header: t("ar.credit.colParty"),
      sortValue: (r) => r.party.nameEn,
      cell: (r) => (
        <Link href={`/par/${r.party.id}`} className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-link hover:underline">{nameOf(r.party, locale)}</span>
          <span lang="en" className="font-mono text-xs text-muted-foreground">
            {r.party.code}
          </span>
        </Link>
      ),
    },
    { key: "limit", header: t("ar.credit.colLimit"), align: "right", hide: "md", sortValue: (r) => r.party.creditLimitP, cell: (r) => <MoneyText poisha={r.party.creditLimitP} className="font-mono" /> },
    { key: "exposure", header: t("ar.credit.colExposure"), align: "right", sortValue: (r) => r.exposureP, cell: (r) => <MoneyText poisha={r.exposureP} className="font-mono" /> },
    {
      key: "available",
      header: t("ar.credit.colAvailable"),
      align: "right",
      hide: "lg",
      sortValue: (r) => r.party.creditLimitP - r.exposureP,
      cell: (r) => {
        const avail = r.party.creditLimitP - r.exposureP
        return avail < 0 ? <span className="text-destructive">{t("ar.credit.overLimit")}</span> : <MoneyText poisha={avail} className="font-mono" />
      },
    },
    {
      key: "overdue",
      header: t("ar.credit.colOverdue"),
      align: "right",
      hide: "sm",
      sortValue: (r) => r.overdueP,
      cell: (r) => (r.overdueP ? <MoneyText poisha={r.overdueP} className="font-mono text-destructive" /> : <span className="text-muted-foreground">-</span>),
    },
    { key: "oldest", header: t("ar.credit.colOldest"), align: "right", hide: "lg", sortValue: (r) => r.oldest, cell: (r) => (r.oldest ? t("ar.credit.days", { count: num(r.oldest) }) : "-") },
    { key: "status", header: t("ar.credit.colStatus"), cell: (r) => <DocStatus status={r.party.status} /> },
    {
      key: "actions",
      header: "",
      cell: (r) =>
        can("ar.reminder.send") && r.overdueP > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            className="text-link"
            data-testid="reminder-send"
            disabled={remind.pending}
            onClick={async (e) => {
              e.stopPropagation()
              const res = await remind.run({ partyId: r.party.id, lang: locale })
              if (res) toast.success(t("ar.credit.reminded", { count: num(res.sent), party: nameOf(r.party, locale) }))
            }}
          >
            <BellRing />
            <span className="hidden @min-[40rem]/list:inline">{t("ar.credit.remind")}</span>
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="credit-control">
      <PageHeader title={t("ar.pages.creditControl")} subtitle={t("ar.credit.subtitle")} />
      <section className="surface-card p-4 md:p-5">
        <ListTable
          rows={data?.rows}
          columns={columns}
          rowKey={(r) => r.party.id}
          rowTestId="credit-row"
          rowAttrs={(r) => ({ "party-id": r.party.id, status: r.party.status })}
          rowClassName={(r) => cn(r.party.status !== "active" && "bg-[color-mix(in_oklch,var(--warning)_8%,transparent)]")}
        />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t("ar.credit.overrides")} size="sm" icon={ShieldCheck}>
          {data?.overrides.length ? (
            <ul className="flex flex-col">
              {data.overrides.slice(0, 12).map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 border-b border-hairline py-2 text-[0.8125rem] last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span lang="en" className="font-mono">
                      {a.docNo}
                    </span>
                    <DocStatus status={a.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("ar.credit.requestedBy")} {userName(users.get(a.requestedBy), locale)} · {t("ar.credit.approvedBy")} {userName(users.get(a.decidedBy ?? ""), locale) || "-"} ·{" "}
                    <DateText value={a.decidedAt ?? a.requestedAt} variant="dmyTime" />
                  </span>
                  {a.reason ? <span className="text-xs">{a.reason}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ShieldCheck} title={t("ar.credit.noOverrides")} size="sm" />
          )}
        </SectionCard>
        <SectionCard title={t("ar.credit.reminders")} size="sm" icon={MessageSquare} action={<SimulatedBadge label={t("ar.credit.sms")} />}>
          {data?.reminders.length ? (
            <ul className="flex flex-col" data-testid="reminder-list">
              {data.reminders.map((s) => (
                <li key={s.id} className="flex flex-col gap-0.5 border-b border-hairline py-2 text-[0.8125rem] last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{nameOf(data.parties.get(s.partyId ?? ""), locale)}</span>
                    <DocStatus status={s.status === "delivered" ? "done" : "queued"} />
                  </div>
                  <span className="text-xs text-muted-foreground">{s.text}</span>
                  <DateText value={s.queuedAt} variant="dmyTime" className="text-xs text-muted-foreground" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={MessageSquare} title={t("ar.credit.noReminders")} size="sm" />
          )}
        </SectionCard>
      </div>
    </div>
  )
}
