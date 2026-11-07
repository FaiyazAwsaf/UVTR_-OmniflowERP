"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus, UsersRound } from "lucide-react"

import { PartyAvatar } from "@/components/shared/avatars"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { ALL_SEGMENTS, regSearchKey } from "../lib"
import { CsvButton, LinkButton, ListTable, NativeSelect, Pills, SearchBox, Stat, type Column } from "./kit"

type Row = { party: PartyRow; vehicles: number; regs: string }

/** /par: the party master, customers and vendors, filtered and searchable (plan §9). */
export function PartyList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, num } = useLocale()
  const { can } = usePermissions()
  const [kind, setKind] = React.useState("all")
  const [segment, setSegment] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [query, setQuery] = React.useState("")

  const data = useLiveQuery(async () => {
    const [parties, vehicles] = await Promise.all([db.parties.toArray(), db.vehicles.toArray()])
    const byParty = new Map<string, { count: number; regs: string[] }>()
    for (const v of vehicles) {
      const e = byParty.get(v.partyId) ?? { count: 0, regs: [] }
      e.count += 1
      e.regs.push(v.regNo, v.regNoBn)
      byParty.set(v.partyId, e)
    }
    return parties
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((party) => ({ party, vehicles: byParty.get(party.id)?.count ?? 0, regs: regSearchKey((byParty.get(party.id)?.regs ?? []).join(" ")) }))
  }, [db])

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const qKey = regSearchKey(query)
    return (data ?? []).filter(({ party, regs }) => {
      if (kind === "customers" && !party.isCustomer) return false
      if (kind === "vendors" && !party.isVendor) return false
      if (segment && party.segment !== segment) return false
      if (status && party.status !== status) return false
      if (!q) return true
      return (
        party.nameEn.toLowerCase().includes(q) ||
        party.nameBn.includes(query.trim()) ||
        party.code.toLowerCase().includes(q) ||
        regSearchKey(party.phone).includes(qKey) ||
        (qKey.length >= 3 && regs.includes(qKey))
      )
    })
  }, [data, kind, segment, status, query])

  const totals = React.useMemo(() => {
    const all = data ?? []
    return {
      customers: all.filter((r) => r.party.isCustomer).length,
      vendors: all.filter((r) => r.party.isVendor).length,
      held: all.filter((r) => r.party.status !== "active").length,
    }
  }, [data])

  const columns: Column<Row>[] = [
    {
      key: "party",
      header: t("par.list.colParty"),
      sortValue: (r) => r.party.nameEn,
      cell: ({ party }) => (
        <Link href={`/par/${party.id}`} className="flex min-w-0 items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
          <PartyAvatar party={party} size={30} className="shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-foreground">{nameOf(party, locale)}</span>
            <span lang="en" className="font-mono text-xs text-muted-foreground">
              {party.code}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "segment",
      header: t("par.list.colSegment"),
      hide: "sm",
      sortValue: (r) => r.party.segment,
      cell: ({ party }) => (
        <span className="text-muted-foreground">
          {tk(`reports.enum.segment.${party.segment}`)}
          {party.isCustomer && party.isVendor ? ` · ${t("par.list.both")}` : ""}
        </span>
      ),
    },
    {
      key: "phone",
      header: t("par.list.colPhone"),
      hide: "md",
      cell: ({ party }) => (
        <span lang="en" className="font-mono text-xs">
          {party.phone}
        </span>
      ),
    },
    {
      key: "vehicles",
      header: t("par.list.colVehicles"),
      align: "right",
      hide: "lg",
      sortValue: (r) => r.vehicles,
      cell: (r) => (r.vehicles ? num(r.vehicles) : "-"),
    },
    {
      key: "credit",
      header: t("par.list.colCredit"),
      align: "right",
      hide: "lg",
      sortValue: (r) => r.party.creditLimitP,
      cell: ({ party }) => (party.creditLimitP ? <MoneyText poisha={party.creditLimitP} className="font-mono" /> : <span className="text-muted-foreground">-</span>),
    },
    {
      key: "status",
      header: t("par.list.colStatus"),
      sortValue: (r) => r.party.status,
      cell: ({ party }) => <DocStatus status={party.status} />,
    },
  ]

  const csvRows = rows.map(({ party, vehicles }) => ({
    code: party.code,
    name: party.nameEn,
    segment: party.segment,
    phone: party.phone,
    vehicles,
    creditLimitP: party.creditLimitP,
    status: party.status,
  }))

  return (
    <div className="flex flex-col gap-4" data-testid="party-list">
      <PageHeader
        title={t("par.pages.home")}
        subtitle={t("par.list.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="par.export"
              fileName="parties"
              rows={csvRows}
              columns={[
                { key: "code", label: "Code" },
                { key: "name", label: t("par.list.colParty") },
                { key: "segment", label: t("par.list.colSegment") },
                { key: "phone", label: t("par.list.colPhone") },
                { key: "vehicles", label: t("par.list.colVehicles") },
                { key: "creditLimitP", label: t("par.list.colCredit") },
                { key: "status", label: t("par.list.colStatus") },
              ]}
            />
            {can("par.customer.create") || can("par.vendor.create") ? (
              <LinkButton href="/par/new" testId="party-new">
                <Plus />
                {t("par.list.newParty")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 @container/card md:p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <Stat label={t("par.list.customers")} value={num(totals.customers)} />
          <Stat label={t("par.list.vendors")} value={num(totals.vendors)} />
          <Stat label={t("par.list.onHold")} value={num(totals.held)} tone={totals.held ? "warning" : undefined} />
          <span className="ml-auto text-xs text-muted-foreground">{t("par.list.count", { count: num(rows.length) })}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder={t("par.list.searchPlaceholder")} testId="party-search" />
          <Pills
            value={kind}
            onChange={setKind}
            testId="party-kind"
            options={[
              { value: "all", label: t("par.list.kindAll") },
              { value: "customers", label: t("par.list.kindCustomers") },
              { value: "vendors", label: t("par.list.kindVendors") },
            ]}
          />
          <NativeSelect
            value={segment}
            onChange={setSegment}
            placeholder={t("par.list.segmentAll")}
            ariaLabel={t("par.list.colSegment")}
            className="w-44"
            options={ALL_SEGMENTS.map((s) => ({ value: s, label: tk(`reports.enum.segment.${s}`) }))}
          />
          <NativeSelect
            value={status}
            onChange={setStatus}
            placeholder={t("par.list.statusAll")}
            ariaLabel={t("par.list.colStatus")}
            className="w-40"
            options={["active", "on-hold", "blocked"].map((s) => ({ value: s, label: tk(`shared.status.${s}`) }))}
          />
        </div>
        <ListTable
          rows={data ? rows : undefined}
          columns={columns}
          rowKey={(r) => r.party.id}
          rowTestId="party-row"
          rowAttrs={(r) => ({ "party-id": r.party.id, code: r.party.code })}
          onRowClick={(r) => router.push(`/par/${r.party.id}`)}
          empty={
            <div className="flex flex-col items-center gap-2 p-8 text-sm text-muted-foreground">
              <UsersRound className="size-5" />
              {t("common.noResults")}
            </div>
          }
        />
      </section>
    </div>
  )
}
