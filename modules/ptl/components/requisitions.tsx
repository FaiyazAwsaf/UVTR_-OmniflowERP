"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { FilePlus2 } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { buttonVariants } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { PurchaseRequisitionRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { ExportCsvButton, ListToolbar, LocationSelect, OptionSelect, useScmLookups } from "@/modules/ic/components/scm-ui"

type Row = PurchaseRequisitionRow & { lines: number }

/** /ptl/requisitions: requisitions by status (draft, waiting for approval, approved, ordered, rejected). */
export function RequisitionsList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const [status, setStatus] = React.useState("all")
  const [location, setLocation] = React.useState("all")
  const data = useLiveQuery(async () => {
    const prs = await db.purchaseRequisitions.orderBy("date").reverse().toArray()
    const lines = await db.prLines.toArray()
    const count = new Map<string, number>()
    for (const l of lines) count.set(l.prId, (count.get(l.prId) ?? 0) + 1)
    return prs.map((p): Row => ({ ...p, lines: count.get(p.id) ?? 0 }))
  }, [db])
  const rows = (data ?? []).filter((r) => (status === "all" || r.status === status) && (location === "all" || r.locationId === location))

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "no",
        header: t("ptl.pr.no"),
        accessorFn: (r) => r.prNo,
        cell: ({ row }) => (
          <span lang="en" className="font-mono text-link" data-testid="pr-row" data-pr-no={row.original.prNo}>
            {row.original.prNo}
          </span>
        ),
      },
      { id: "date", header: t("ptl.pr.date"), accessorFn: (r) => r.createdAt, cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span>, meta: { hideBelow: "sm" } },
      {
        id: "location",
        header: t("ptl.pr.location"),
        accessorFn: (r) => r.locationId,
        cell: ({ row }) => nameOf(lookups?.locations.get(row.original.locationId), locale),
        meta: { hideBelow: "lg" },
      },
      {
        id: "by",
        header: t("ptl.pr.requestedBy"),
        accessorFn: (r) => r.requestedBy,
        cell: ({ row }) => userName(lookups?.users.get(row.original.requestedBy), locale),
        meta: { hideBelow: "md" },
      },
      { id: "reason", header: t("ptl.pr.reason"), accessorFn: (r) => r.reason, cell: ({ row }) => tk(`ptl.reason.${row.original.reason}`), meta: { hideBelow: "lg" } },
      { id: "lines", header: t("ptl.pr.lines"), accessorFn: (r) => r.lines, cell: ({ row }) => num(row.original.lines), meta: { align: "right", hideBelow: "md" } },
      { id: "total", header: t("ptl.pr.total"), accessorFn: (r) => r.totalP, cell: ({ row }) => <MoneyText poisha={row.original.totalP} />, meta: { align: "right" } },
      { id: "status", header: t("ptl.pr.status"), accessorFn: (r) => r.status, cell: ({ row }) => <DocStatus status={row.original.status} /> },
    ],
    [t, tk, locale, num, dmy, lookups]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("ptl.pr.title")}
        subtitle={t("ptl.pr.subtitle")}
        actions={
          can("ptl.pr.create") ? (
            <Link href="/ptl/requisitions/new" className={buttonVariants()} data-testid="pr-new">
              <FilePlus2 />
              {t("ptl.pr.new")}
            </Link>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.id}
        onRowClick={(r) => router.push(`/ptl/requisitions/${r.id}`)}
        emptyTitle={t("ptl.pr.empty")}
        toolbar={
          <ListToolbar
            actions={
              <ExportCsvButton
                permission="ptl.export"
                fileName="requisitions"
                columns={[
                  { key: "no", label: t("ptl.pr.no") },
                  { key: "date", label: t("ptl.pr.date") },
                  { key: "location", label: t("ptl.pr.location") },
                  { key: "by", label: t("ptl.pr.requestedBy") },
                  { key: "totalP", label: t("ptl.pr.total") },
                  { key: "status", label: t("ptl.pr.status") },
                ]}
                rows={() =>
                  rows.map((r) => ({
                    no: r.prNo,
                    date: r.date,
                    location: nameOf(lookups?.locations.get(r.locationId), locale),
                    by: userName(lookups?.users.get(r.requestedBy), locale),
                    totalP: r.totalP,
                    status: tk(`shared.status.${r.status}`),
                  }))
                }
              />
            }
          >
            <OptionSelect
              value={status}
              onChange={setStatus}
              label={t("ptl.pr.status")}
              options={[
                { value: "all", label: t("ptl.pr.allStatuses") },
                ...(["draft", "pending-approval", "approved", "ordered", "rejected"] as const).map((s) => ({ value: s, label: tk(`shared.status.${s}`) })),
              ]}
            />
            <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
          </ListToolbar>
        }
      />
    </div>
  )
}
