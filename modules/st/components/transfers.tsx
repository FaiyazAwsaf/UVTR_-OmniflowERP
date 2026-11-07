"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeftRight } from "lucide-react"
import { toast } from "sonner"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type { TransferRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { ItemLinesEditor, newLine, type DraftLine } from "@/modules/ic/components/lines-editor"
import { Field, ListToolbar, LocationSelect, OptionSelect, freshKey, useScmLookups } from "@/modules/ic/components/scm-ui"

import { requestTransfer } from "../commands"

type Row = TransferRow & { lines: number; valueP: number }

/** /st/transfers: transfers between the Central Store and the studios, and "Request transfer". */
export function TransfersList() {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const [location, setLocation] = React.useState("all")
  const [status, setStatus] = React.useState("all")
  const [creating, setCreating] = React.useState(false)

  const data = useLiveQuery(async () => {
    const transfers = await db.transfers.orderBy("requestedAt").reverse().toArray()
    const lines = await db.transferLines.toArray()
    const agg = new Map<string, { lines: number; valueP: number }>()
    for (const l of lines) {
      const a = agg.get(l.transferId) ?? { lines: 0, valueP: 0 }
      a.lines += l.qtyRequested > 0 || l.qtySent > 0 ? 1 : 0
      a.valueP += l.valueP
      agg.set(l.transferId, a)
    }
    return transfers.map((tr): Row => ({ ...tr, ...(agg.get(tr.id) ?? { lines: 0, valueP: 0 }) }))
  }, [db])
  const rows = (data ?? []).filter(
    (r) => (location === "all" || r.fromLocationId === location || r.toLocationId === location) && (status === "all" || r.status === status)
  )
  const canRequest = (lookups?.stockLocations ?? []).some((l) => can("st.transfer.request", l.id))
  const loc = (id: string) => nameOf(lookups?.locations.get(id), locale)

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "no",
        header: t("st.transfers.no"),
        accessorFn: (r) => r.transferNo,
        cell: ({ row }) => (
          <span lang="en" className="font-mono text-link" data-testid="transfer-row" data-transfer-no={row.original.transferNo}>
            {row.original.transferNo}
          </span>
        ),
      },
      {
        id: "date",
        header: t("st.transfers.date"),
        accessorFn: (r) => r.dispatchedAt ?? r.requestedAt,
        cell: ({ row }) => <span className="nums">{dmy(row.original.dispatchedAt ?? row.original.requestedAt)}</span>,
        meta: { hideBelow: "sm" },
      },
      { id: "from", header: t("st.transfers.from"), accessorFn: (r) => r.fromLocationId, cell: ({ row }) => loc(row.original.fromLocationId) },
      { id: "to", header: t("st.transfers.to"), accessorFn: (r) => r.toLocationId, cell: ({ row }) => loc(row.original.toLocationId) },
      { id: "lines", header: t("st.transfers.lines"), accessorFn: (r) => r.lines, cell: ({ row }) => num(row.original.lines), meta: { align: "right", hideBelow: "lg" } },
      {
        id: "value",
        header: t("st.transfers.value"),
        accessorFn: (r) => r.valueP,
        cell: ({ row }) => (row.original.valueP ? <MoneyText poisha={row.original.valueP} /> : "-"),
        meta: { align: "right", hideBelow: "md" },
      },
      {
        id: "status",
        header: t("st.transfers.status"),
        accessorFn: (r) => r.status,
        cell: ({ row }) => <DocStatus status={row.original.status === "dispatched" ? "in-transit" : row.original.status} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, num, dmy, lookups]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("st.transfers.title")}
        subtitle={t("st.transfers.subtitle")}
        actions={
          canRequest ? (
            <Button onClick={() => setCreating(true)} data-testid="transfer-new">
              <ArrowLeftRight />
              {t("st.transfers.new")}
            </Button>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.id}
        onRowClick={(r) => router.push(`/st/transfers/${r.id}`)}
        emptyTitle={t("st.transfers.empty")}
        toolbar={
          <ListToolbar>
            <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
            <OptionSelect
              value={status}
              onChange={setStatus}
              label={t("st.transfers.status")}
              options={[
                { value: "all", label: t("st.transfers.allStatuses") },
                ...(["requested", "dispatched", "received", "cancelled"] as const).map((s) => ({ value: s, label: tk(`shared.status.${s === "dispatched" ? "in-transit" : s}`) })),
              ]}
            />
          </ListToolbar>
        }
      />
      <RequestTransferDialog open={creating} onOpenChange={setCreating} onDone={(id) => router.push(`/st/transfers/${id}`)} />
    </div>
  )
}

/** "Request transfer" (st.requestTransfer): into a location the user may request for, from another stock location. */
export function RequestTransferDialog({
  open,
  onOpenChange,
  onDone,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: (id: string) => void
  initial?: { toLocationId?: string; lines?: DraftLine[] }
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="transfer-dialog">
        {open ? <RequestForm initial={initial} onClose={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function RequestForm({ initial, onClose, onDone }: { initial?: { toLocationId?: string; lines?: DraftLine[] }; onClose: () => void; onDone?: (id: string) => void }) {
  const db = useDb()
  const { t, num } = useLocale()
  const { can } = usePermissions()
  const session = useSession()
  const lookups = useScmLookups()
  const request = useCommand(requestTransfer)
  const stock = lookups?.stockLocations ?? []
  const into = stock.filter((l) => can("st.transfer.request", l.id))
  const [to, setTo] = React.useState<string | null>(initial?.toLocationId ?? null)
  const toId = to ?? (into.find((l) => l.id === session.locationId && l.kind === "studio") ?? into.find((l) => l.kind === "studio") ?? into[0])?.id ?? ""
  const [from, setFrom] = React.useState<string | null>(null)
  const fromId = from ?? (stock.find((l) => l.kind === "store" && l.id !== toId) ?? stock.find((l) => l.id !== toId))?.id ?? ""
  const [lines, setLines] = React.useState<DraftLine[]>(initial?.lines ?? [newLine()])
  const [note, setNote] = React.useState("")
  const available = useLiveQuery(async () => new Map((await db.stockValues.where("locationId").equals(fromId).toArray()).map((v) => [v.itemId, v.qtyBase])), [db, fromId])
  const valid = toId && fromId && toId !== fromId && lines.every((l) => l.itemId && l.qty && l.qty > 0)

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await request.run({
          fromLocationId: fromId,
          toLocationId: toId,
          note: note || undefined,
          lines: lines.map((l) => ({ itemId: l.itemId!, qtyBase: l.qty! })),
          idempotencyKey: freshKey(),
        })
        if (out) {
          toast.success(t("st.transfers.requested", { no: out.transferNo }))
          onClose()
          onDone?.(out.id)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("st.transfers.newTitle")}</DialogTitle>
        <DialogDescription>{t("st.transfers.newHint")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("st.transfers.from")}>
          <LocationSelect value={fromId} onChange={setFrom} locations={stock.filter((l) => l.id !== toId)} includeAll={false} testId="transfer-from" className="w-full" />
        </Field>
        <Field label={t("st.transfers.to")}>
          <LocationSelect value={toId} onChange={setTo} locations={into} includeAll={false} testId="transfer-to" className="w-full" />
        </Field>
      </div>
      <ItemLinesEditor
        lines={lines}
        onChange={setLines}
        items={lookups?.items}
        unit={(item) => item.baseUom}
        qtyLabel={t("st.transfers.qty")}
        lineTestId="transfer-line"
        qtyTestId="transfer-qty"
        hint={(line, item) => (item ? t("st.transfers.atSource", { qty: `${num(available?.get(item.id) ?? 0)} ${item.baseUom}` }) : null)}
      />
      <Field label={t("ic.ui.note")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
      </Field>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!valid || request.pending} data-testid="transfer-submit">
          {t("st.transfers.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
