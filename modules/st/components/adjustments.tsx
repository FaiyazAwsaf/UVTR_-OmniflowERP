"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ClipboardMinus, PackageMinus } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { ApprovalChip } from "@/components/shared/approval-chip"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { StockAdjustmentRow, StockMoveRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { JournalLink } from "@/modules/ic/components/count-detail"
import { ItemCell, LinesTable, ListToolbar, LocationSelect, QtyText, useScmLookups } from "@/modules/ic/components/scm-ui"

import { AdjustmentForm, type AdjustmentPrefill } from "./adjustment-form"

function useAdjustments(internal: boolean) {
  const db = useDb()
  return useLiveQuery(
    async () => (await db.stockAdjustments.orderBy("date").reverse().toArray()).filter((a) => (a.reason === "internal-use") === internal),
    [db, internal]
  )
}

/** The adjustments table shared by /st/adjustments and the internal-use tab of /st/issues. */
function AdjustmentTable({ rows, onOpen, internal }: { rows: StockAdjustmentRow[]; onOpen: (a: StockAdjustmentRow) => void; internal: boolean }) {
  const { t, tk, locale, num, dmy } = useLocale()
  const lookups = useScmLookups()
  const columns = React.useMemo<ColumnDef<StockAdjustmentRow, unknown>[]>(
    () => [
      {
        id: "no",
        header: t("st.adjustments.no"),
        accessorFn: (a) => a.adjustmentNo,
        cell: ({ row }) => (
          <span lang="en" className="font-mono text-link" data-testid="adjustment-row" data-adjustment-no={row.original.adjustmentNo}>
            {row.original.adjustmentNo}
          </span>
        ),
      },
      { id: "date", header: t("st.adjustments.date"), accessorFn: (a) => a.createdAt, cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span>, meta: { hideBelow: "sm" } },
      {
        id: "location",
        header: t("st.adjustments.location"),
        accessorFn: (a) => a.locationId,
        cell: ({ row }) => nameOf(lookups?.locations.get(row.original.locationId), locale),
        meta: { hideBelow: "md" },
      },
      {
        id: "reason",
        header: internal ? t("st.issues.expense") : t("st.adjustments.reason"),
        accessorFn: (a) => a.reason,
        cell: ({ row }) => (internal ? tk(`st.expense.${row.original.expenseTag}`) : tk(`st.reason.${row.original.reason}`)),
      },
      { id: "lines", header: t("st.adjustments.lines"), accessorFn: (a) => a.lines.length, cell: ({ row }) => num(row.original.lines.length), meta: { align: "right", hideBelow: "lg" } },
      {
        id: "value",
        header: t("st.adjustments.value"),
        accessorFn: (a) => a.lines.reduce((s, l) => s + l.valueP, 0),
        cell: ({ row }) => <MoneyText poisha={row.original.lines.reduce((s, l) => s + l.valueP, 0)} signed colorize />,
        meta: { align: "right" },
      },
      { id: "status", header: t("st.adjustments.status"), accessorFn: (a) => a.status, cell: ({ row }) => <DocStatus status={row.original.status} /> },
    ],
    [t, tk, locale, num, dmy, lookups, internal]
  )
  return <DataTable data={rows} columns={columns} rowId={(a) => a.id} onRowClick={onOpen} emptyTitle={t("st.adjustments.empty")} bare />
}

/** One adjustment: lines with values, approval and journal. */
function AdjustmentView({ adjustment, onClose }: { adjustment: StockAdjustmentRow | null; onClose: () => void }) {
  const { t, tk, locale, dmy } = useLocale()
  const lookups = useScmLookups()
  return (
    <Dialog open={!!adjustment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="adjustment-view">
        {adjustment ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-3">
                <span lang="en" className="font-mono">
                  {adjustment.adjustmentNo}
                </span>
                <DocStatus status={adjustment.status} />
              </DialogTitle>
              <DialogDescription>
                {nameOf(lookups?.locations.get(adjustment.locationId), locale)} · {dmy(adjustment.date)} ·{" "}
                {adjustment.reason === "internal-use" ? tk(`st.expense.${adjustment.expenseTag}`) : tk(`st.reason.${adjustment.reason}`)} · {t("st.adjustments.preparedBy")}{" "}
                {userName(lookups?.users.get(adjustment.preparedBy), locale)}
              </DialogDescription>
            </DialogHeader>
            {adjustment.note ? <p className="text-[0.8125rem]">{adjustment.note}</p> : null}
            <LinesTable head={[{ label: t("ic.ui.item") }, { label: t("ic.ui.qty"), align: "right" }, { label: t("ic.ui.value"), align: "right" }]}>
              {adjustment.lines.map((l, i) => {
                const item = lookups?.items.get(l.itemId)
                return (
                  <tr key={i}>
                    <td>
                      <ItemCell item={item} />
                    </td>
                    <td className="text-right">
                      <QtyText value={l.qtyBase} uom={item?.baseUom} signed />
                    </td>
                    <td className="text-right">
                      <MoneyText poisha={l.valueP} signed colorize />
                    </td>
                  </tr>
                )
              })}
            </LinesTable>
            <div className="flex flex-wrap items-center gap-3 text-[0.8125rem]">
              {adjustment.approvalId ? <ApprovalChip approvalId={adjustment.approvalId} /> : null}
              {adjustment.journalId ? <JournalLink journalId={adjustment.journalId} /> : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** /st/adjustments: damage, expiry, loss, found and corrections with approval above the maker's limit. `?id=` opens one; `?new=expiry&...` prefills a write-off. */
export function AdjustmentsScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const { t } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const rows = useAdjustments(false)
  const [location, setLocation] = React.useState("all")
  const [creating, setCreating] = React.useState<AdjustmentPrefill | null>(() => {
    const reason = params.get("new")
    if (!reason) return null
    return {
      reason: reason === "expiry" ? "expiry" : "damage",
      locationId: params.get("location") ?? undefined,
      itemId: params.get("item") ?? undefined,
      batchId: params.get("batch") ?? undefined,
      qty: params.get("qty") ? Number(params.get("qty")) : undefined,
    }
  })
  const [openId, setOpenId] = React.useState<string | null>(params.get("id"))
  const open = rows?.find((a) => a.id === openId) ?? null
  const shown = (rows ?? []).filter((a) => location === "all" || a.locationId === location)
  const canCreate = (lookups?.stockLocations ?? []).some((l) => can("st.adjust.create", l.id))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("st.adjustments.title")}
        subtitle={t("st.adjustments.subtitle")}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating({})} data-testid="adjustment-new">
              <ClipboardMinus />
              {t("st.adjustments.new")}
            </Button>
          ) : null
        }
      />
      <section className="surface-card flex flex-col gap-4 p-5">
        <ListToolbar>
          <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
        </ListToolbar>
        <AdjustmentTable rows={shown} onOpen={(a) => setOpenId(a.id)} internal={false} />
      </section>
      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent className="sm:max-w-3xl" data-testid="adjustment-dialog">
          {creating ? (
            <AdjustmentForm
              mode="adjust"
              prefill={creating}
              onClose={(id) => {
                setCreating(null)
                if (id) setOpenId(id)
                if (params.get("new")) router.replace("/st/adjustments")
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <AdjustmentView adjustment={open} onClose={() => setOpenId(null)} />
    </div>
  )
}

/** /st/issues: internal use (with its expense) and the issues to jobs recorded by STL. */
export function IssuesScreen() {
  const db = useDb()
  const { t, locale, dmy, time } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const nowMs = useNow(60_000)
  const internal = useAdjustments(true)
  const [location, setLocation] = React.useState("all")
  const [creating, setCreating] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const since = addDaysISO(dhakaDate(nowMs), -6)
  const jobs = useLiveQuery(async () => (await db.stockMoves.where("date").aboveOrEqual(since).toArray()).filter((m) => m.type === "issue-job").sort((a, b) => b.at - a.at), [db, since])
  const canCreate = (lookups?.stockLocations ?? []).some((l) => can("st.adjust.create", l.id))
  const byLocation = <T extends { locationId: string }>(rows: T[] | undefined) => (rows ?? []).filter((r) => location === "all" || r.locationId === location)

  const jobColumns = React.useMemo<ColumnDef<StockMoveRow, unknown>[]>(
    () => [
      {
        id: "date",
        header: t("st.adjustments.date"),
        accessorFn: (m) => m.at,
        cell: ({ row }) => (
          <span className="nums" data-testid="job-issue-row">
            {dmy(row.original.at)} {time(row.original.at)}
          </span>
        ),
      },
      { id: "order", header: t("st.issues.order"), enableSorting: false, cell: ({ row }) => <DocLink docType={row.original.ref.docType} docId={row.original.ref.docId} docNo={row.original.ref.docNo} /> },
      { id: "item", header: t("ic.ui.item"), accessorFn: (m) => m.itemId, cell: ({ row }) => <ItemCell item={lookups?.items.get(row.original.itemId)} /> },
      {
        id: "location",
        header: t("ic.ui.location"),
        accessorFn: (m) => m.locationId,
        cell: ({ row }) => nameOf(lookups?.locations.get(row.original.locationId), locale),
        meta: { hideBelow: "md" },
      },
      {
        id: "qty",
        header: t("ic.ui.qty"),
        accessorFn: (m) => -m.qtyBase,
        cell: ({ row }) => <QtyText value={-row.original.qtyBase} uom={lookups?.items.get(row.original.itemId)?.baseUom} />,
        meta: { align: "right" },
      },
      { id: "value", header: t("ic.ui.value"), accessorFn: (m) => -m.valueP, cell: ({ row }) => <MoneyText poisha={-row.original.valueP} />, meta: { align: "right", hideBelow: "sm" } },
    ],
    [t, dmy, time, locale, lookups]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("st.issues.title")}
        subtitle={t("st.issues.subtitle")}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)} data-testid="issue-new">
              <PackageMinus />
              {t("st.issues.new")}
            </Button>
          ) : null
        }
      />
      <section className="surface-card flex flex-col gap-4 p-5">
        <Tabs defaultValue="internal">
          <div className="flex flex-wrap items-center gap-3">
            <TabsList>
              <TabsTrigger value="internal">{t("st.issues.internal")}</TabsTrigger>
              <TabsTrigger value="jobs" data-testid="tab-jobs">
                {t("st.issues.jobs")}
              </TabsTrigger>
            </TabsList>
            <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} className="ml-auto" />
          </div>
          <TabsContent value="internal" className="pt-4">
            <AdjustmentTable rows={byLocation(internal)} onOpen={(a) => setOpenId(a.id)} internal />
          </TabsContent>
          <TabsContent value="jobs" className="pt-4">
            <DataTable data={byLocation(jobs)} columns={jobColumns} rowId={(m) => m.id} density="compact" emptyTitle={t("st.issues.empty")} bare />
          </TabsContent>
        </Tabs>
      </section>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-3xl" data-testid="issue-dialog">
          {creating ? (
            <AdjustmentForm
              mode="issue"
              onClose={(id) => {
                setCreating(false)
                if (id) setOpenId(id)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <AdjustmentView adjustment={internal?.find((a) => a.id === openId) ?? null} onClose={() => setOpenId(null)} />
    </div>
  )
}
