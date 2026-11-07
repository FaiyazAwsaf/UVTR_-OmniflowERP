"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ClipboardList } from "lucide-react"
import { toast } from "sonner"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDb } from "@/core/db/DbProvider"
import type { StockCountRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { openCount } from "../commands"
import { Field, ListToolbar, LocationSelect, OptionSelect, freshKey, useScmLookups } from "./scm-ui"

/** /ic/counts: stock counts (open, counted, waiting for approval, posted) and "Open count". */
export function CountsList() {
  const db = useDb()
  const router = useRouter()
  const { t, locale, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const [location, setLocation] = React.useState("all")
  const [opening, setOpening] = React.useState(false)
  const counts = useLiveQuery(() => db.stockCounts.orderBy("date").reverse().toArray(), [db])
  const rows = (counts ?? []).filter((c) => location === "all" || c.locationId === location)
  const canOpen = (lookups?.stockLocations ?? []).some((l) => can("ic.count.create", l.id))

  const columns = React.useMemo<ColumnDef<StockCountRow, unknown>[]>(
    () => [
      {
        id: "no",
        header: t("ic.counts.countNo"),
        accessorFn: (c) => c.countNo,
        cell: ({ row }) => (
          <span lang="en" className="font-mono text-link" data-testid="count-row">
            {row.original.countNo}
          </span>
        ),
      },
      { id: "date", header: t("ic.counts.date"), accessorFn: (c) => c.snapshotAt, cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span> },
      {
        id: "location",
        header: t("ic.counts.location"),
        accessorFn: (c) => c.locationId,
        cell: ({ row }) => nameOf(lookups?.locations.get(row.original.locationId), locale),
        meta: { hideBelow: "sm" },
      },
      { id: "lines", header: t("ic.counts.lines"), accessorFn: (c) => c.lines.length, cell: ({ row }) => num(row.original.lines.length), meta: { align: "right", hideBelow: "md" } },
      {
        id: "variances",
        header: t("ic.counts.variances"),
        accessorFn: (c) => c.lines.filter((l) => l.varianceQty !== 0).length,
        cell: ({ row }) => num(row.original.lines.filter((l) => l.varianceQty !== 0).length),
        meta: { align: "right", hideBelow: "md" },
      },
      {
        id: "value",
        header: t("ic.counts.varianceValue"),
        accessorFn: (c) => c.lines.reduce((s, l) => s + l.varianceValueP, 0),
        cell: ({ row }) => <MoneyText poisha={row.original.lines.reduce((s, l) => s + l.varianceValueP, 0)} colorize signed />,
        meta: { align: "right" },
      },
      { id: "status", header: t("ic.counts.status"), accessorFn: (c) => c.status, cell: ({ row }) => <DocStatus status={row.original.status} /> },
    ],
    [t, locale, num, dmy, lookups]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("ic.counts.title")}
        subtitle={t("ic.counts.subtitle")}
        actions={
          canOpen ? (
            <Button onClick={() => setOpening(true)} data-testid="count-open">
              <ClipboardList />
              {t("ic.counts.openCount")}
            </Button>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowId={(c) => c.id}
        onRowClick={(c) => router.push(`/ic/counts/${c.id}`)}
        emptyTitle={t("ic.counts.empty")}
        toolbar={
          <ListToolbar>
            <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
          </ListToolbar>
        }
      />
      <Dialog open={opening} onOpenChange={setOpening}>
        <DialogContent data-testid="count-open-dialog">{opening ? (
            <OpenCountForm
              onDone={(id) => {
                setOpening(false)
                if (id) router.push(`/ic/counts/${id}`)
              }}
            />
          ) : null}</DialogContent>
      </Dialog>
    </div>
  )
}

function OpenCountForm({ onDone }: { onDone: (id?: string) => void }) {
  const { t, locale } = useLocale()
  const { can } = usePermissions()
  const session = useSession()
  const lookups = useScmLookups()
  const open = useCommand(openCount)
  const allowed = (lookups?.stockLocations ?? []).filter((l) => can("ic.count.create", l.id))
  const [location, setLocation] = React.useState<string | null>(null)
  const [category, setCategory] = React.useState("all")
  const loc = location ?? (allowed.find((l) => l.id === session.locationId) ?? allowed[0])?.id ?? ""
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await open.run({ locationId: loc, categoryIds: category === "all" ? undefined : [category], idempotencyKey: freshKey() })
        if (out) {
          toast.success(t("ic.counts.opened", { no: out.countNo }))
          onDone(out.id)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("ic.counts.openTitle")}</DialogTitle>
        <DialogDescription>{t("ic.counts.openHint")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("ic.counts.location")}>
          <LocationSelect value={loc} onChange={setLocation} locations={allowed} includeAll={false} testId="count-location" className="w-full" />
        </Field>
        <Field label={t("ic.counts.scope")}>
          <OptionSelect
            value={category}
            onChange={setCategory}
            label={t("ic.counts.scope")}
            className="w-full"
            options={[{ value: "all", label: t("ic.counts.allCategories") }, ...[...(lookups?.categories.values() ?? [])].map((c) => ({ value: c.id, label: nameOf(c, locale) }))]}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => onDone()}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={open.pending || !loc} data-testid="count-open-submit">
          {t("ic.counts.open")}
        </Button>
      </DialogFooter>
    </form>
  )
}
