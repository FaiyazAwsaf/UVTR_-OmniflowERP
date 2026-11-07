"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Printer, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyText } from "@/components/shared/money-text"
import { QtyInput } from "@/components/shared/money-input"
import { PageHeader } from "@/components/shared/page-header"
import { PrintLayout } from "@/components/shared/print-layout"
import { BiLabel, TaxDocHeader } from "@/components/shared/tax-doc-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { locationById } from "@/config/brand.config"
import { dhakaTime } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { DebitNoteRow, GrnLineRow, Id, PurchaseReturnRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { isoToDmy } from "@/lib/i18n/dmy"
import { formatMoney, formatNumber } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"
import { Field, ItemCell, ListToolbar, OptionSelect, PrintPreview, freshKey, useScmLookups } from "@/modules/ic/components/scm-ui"

import { returnToVendor } from "../commands"
import { ptlBn } from "../i18n/bn"
import { ptlEn } from "../i18n/en"

type Row = PurchaseReturnRow & { debitNote?: DebitNoteRow; grnNo: string }

/** /ptl/returns: purchase returns with their Mushak 6.8 debit notes; "New return" from a GRN (`?grn=` preselects one, `?id=` opens a return). */
export function ReturnsScreen() {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const { t, locale, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const [creating, setCreating] = React.useState<boolean>(!!params.get("grn"))
  const [printing, setPrinting] = React.useState<string | null>(params.get("id"))
  const data = useLiveQuery(async () => {
    const returns = await db.purchaseReturns.orderBy("date").reverse().toArray()
    const out: Row[] = []
    for (const r of returns) {
      out.push({ ...r, debitNote: r.debitNoteId ? await db.debitNotes.get(r.debitNoteId) : undefined, grnNo: r.grnId ? ((await db.grns.get(r.grnId))?.grnNo ?? "") : "" })
    }
    return out
  }, [db])
  const canReturn = (lookups?.stockLocations ?? []).some((l) => can("ptl.return.create", l.id))
  const printed = data?.find((r) => r.id === printing)

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "no",
        header: t("ptl.returns.no"),
        accessorFn: (r) => r.returnNo,
        cell: ({ row }) => (
          <span lang="en" className="font-mono" data-testid="return-row">
            {row.original.returnNo}
          </span>
        ),
      },
      { id: "date", header: t("ptl.returns.date"), accessorFn: (r) => r.date, cell: ({ row }) => <span className="nums">{dmy(row.original.date)}</span>, meta: { hideBelow: "sm" } },
      {
        id: "vendor",
        header: t("ptl.returns.vendor"),
        accessorFn: (r) => r.vendorId,
        cell: ({ row }) => <span className="block max-w-48 truncate">{nameOf(lookups?.vendors.get(row.original.vendorId), locale)}</span>,
      },
      {
        id: "grn",
        header: t("ptl.returns.grn"),
        accessorFn: (r) => r.grnNo,
        cell: ({ row }) => (row.original.grnId ? <DocLink docType="grns" docId={row.original.grnId} docNo={row.original.grnNo} showApp={false} /> : "-"),
        meta: { hideBelow: "md" },
      },
      { id: "lines", header: t("ptl.returns.lines"), accessorFn: (r) => r.lines.length, cell: ({ row }) => num(row.original.lines.length), meta: { align: "right", hideBelow: "lg" } },
      {
        id: "dn",
        header: t("ptl.returns.debitNote"),
        accessorFn: (r) => r.debitNote?.debitNoteNo ?? "",
        cell: ({ row }) =>
          row.original.debitNote ? (
            <span className="flex flex-col">
              <span lang="en" className="font-mono text-xs">
                {row.original.debitNote.debitNoteNo}
              </span>
              <MoneyText poisha={row.original.debitNote.totalP} className="text-xs text-muted-foreground" />
            </span>
          ) : (
            "-"
          ),
        meta: { hideBelow: "sm" },
      },
      {
        id: "value",
        header: t("ptl.returns.value"),
        accessorFn: (r) => r.lines.reduce((s, l) => s + l.valueP, 0),
        cell: ({ row }) => <MoneyText poisha={row.original.lines.reduce((s, l) => s + l.valueP, 0)} />,
        meta: { align: "right" },
      },
      {
        id: "print",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Button variant="link" size="sm" onClick={() => setPrinting(row.original.id)} data-testid="debit-note-print">
            <Printer />
            {t("ptl.returns.print")}
          </Button>
        ),
        meta: { align: "right" },
      },
    ],
    [t, locale, num, dmy, lookups]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("ptl.returns.title")}
        subtitle={t("ptl.returns.subtitle")}
        actions={
          canReturn ? (
            <Button onClick={() => setCreating(true)} data-testid="return-new">
              <Undo2 />
              {t("ptl.returns.new")}
            </Button>
          ) : null
        }
      />
      <DataTable data={data ?? []} columns={columns} rowId={(r) => r.id} emptyTitle={t("ptl.returns.empty")} toolbar={<ListToolbar />} />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl" data-testid="return-dialog">
          {creating ? (
            <ReturnForm
              initialGrn={params.get("grn") ?? undefined}
              onClose={(id) => {
                setCreating(false)
                if (params.get("grn")) router.replace("/ptl/returns")
                if (id) setPrinting(id)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <PrintPreview open={!!printed} onOpenChange={(o) => !o && setPrinting(null)} title={t("ptl.returns.dnTitle")} docNo={printed?.debitNote?.debitNoteNo ?? ""}>
        {printed ? <DebitNotePrint ret={printed} /> : null}
      </PrintPreview>
    </div>
  )
}

/** Pick a GRN, the quantities to return per line (purchase units, up to what is returnable) and a reason. */
function ReturnForm({ initialGrn, onClose }: { initialGrn?: string; onClose: (id?: string) => void }) {
  const db = useDb()
  const { t, locale, dmy, num } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const submit = useCommand(returnToVendor)
  const [grnId, setGrnId] = React.useState<Id | null>(initialGrn ?? null)
  const [qty, setQty] = React.useState<Record<Id, number | null>>({})
  const [reason, setReason] = React.useState("")
  const grns = useLiveQuery(async () => {
    const recent = await db.grns.orderBy("date").reverse().limit(60).toArray()
    const out: { value: Id; label: string }[] = []
    for (const g of recent) {
      if (!can("ptl.return.create", g.locationId)) continue
      const lines = await db.grnLines.where("grnId").equals(g.id).toArray()
      if (!lines.some((l) => l.qtyAccepted - l.qtyReturned > 0) && g.id !== initialGrn) continue
      out.push({ value: g.id, label: `${g.grnNo} · ${nameOf(lookups?.vendors.get(g.vendorId), locale)} · ${dmy(g.date)}` })
    }
    return out
  }, [db, lookups, locale, initialGrn])
  const lines = useLiveQuery(async () => (grnId ? ((await db.grnLines.where("grnId").equals(grnId).toArray()) as GrnLineRow[]) : []), [db, grnId])
  const chosen = (lines ?? []).filter((l) => (qty[l.id] ?? 0) > 0)
  const valid = grnId && chosen.length && reason.trim().length >= 3

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await submit.run({
          grnId: grnId!,
          reason,
          lines: chosen.map((l) => ({ grnLineId: l.id, qty: qty[l.id]! })),
          idempotencyKey: freshKey(),
        })
        if (out) {
          toast.success(t("ptl.returns.posted", { no: out.returnNo, dbn: out.debitNoteNo }))
          onClose(out.id)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("ptl.returns.newTitle")}</DialogTitle>
        <DialogDescription>{t("ptl.returns.subtitle")}</DialogDescription>
      </DialogHeader>
      <Field label={t("ptl.returns.pickGrn")}>
        <OptionSelect
          value={grnId ?? "none"}
          onChange={(v) => {
            setGrnId(v === "none" ? null : v)
            setQty({})
          }}
          label={t("ptl.returns.pickGrn")}
          testId="return-grn"
          className="w-full"
          options={[{ value: "none", label: t("ptl.returns.chooseGrn") }, ...(grns ?? [])]}
        />
      </Field>
      {(lines ?? []).map((l) => {
        const item = lookups?.items.get(l.itemId)
        const returnable = roundQty(l.qtyAccepted - l.qtyReturned)
        return (
          <div key={l.id} className="flex flex-wrap items-end gap-3 rounded-md bg-surface-raised/40 p-3" data-testid="return-line" data-sku={item?.sku}>
            <ItemCell item={item} className="min-w-48 flex-1" />
            <span className="text-xs text-muted-foreground">
              {t("ptl.returns.returnable", { qty: `${num(returnable)} ${item?.purchaseUom ?? ""}` })}
            </span>
            <QtyInput value={qty[l.id] ?? null} onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))} unit={item?.purchaseUom} className="w-32" disabled={returnable <= 0} data-testid="return-qty" />
          </div>
        )
      })}
      <Field label={t("ptl.returns.reason")}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-14" data-testid="return-reason" />
      </Field>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => onClose()}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!valid || submit.pending} data-testid="return-submit">
          <Undo2 />
          {t("ptl.returns.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}

type DnKey = "dnBill" | "dnReturn" | "dnVendor" | "dnReason" | "dnNet" | "dnVat" | "dnTotal" | "dnItem" | "dnQty"
/** A bilingual print label from the PTL dictionaries (Bangla first, English below). */
const bi = (key: DnKey) => <BiLabel bn={ptlBn.ptl.returns[key]} en={ptlEn.ptl.returns[key]} />

/** Mushak 6.8 debit note (bilingual labels, Latin numbers). */
function DebitNotePrint({ ret }: { ret: Row }) {
  const db = useDb()
  const lookups = useScmLookups()
  const bill = useLiveQuery(async () => (ret.billId ? db.vendorBills.get(ret.billId) : undefined), [db, ret.billId])
  const dn = ret.debitNote
  if (!dn) return null
  const vendor = lookups?.vendors.get(ret.vendorId)
  return (
    <PrintLayout showBrand={false} demoFooter={false}>
      <div data-testid="debit-note">
        <TaxDocHeader form="6.8" docNo={dn.debitNoteNo} issuedAt={`${isoToDmy(dn.date)} ${dhakaTime(dn.createdAt)}`} location={locationById(ret.locationId)?.code} />
        <div className="mb-4 grid grid-cols-2 gap-4 text-[0.75rem]">
          <div>
            {bi("dnVendor")}
            <div className="mt-1 font-semibold">{vendor?.nameEn}</div>
            <div lang="en" className="font-mono">
              {vendor?.bin ? `BIN ${vendor.bin}` : vendor?.code}
            </div>
          </div>
          <div>
            {bi("dnReturn")}
            <div lang="en" className="mt-1 font-mono">
              {ret.returnNo} · {ret.grnNo}
            </div>
            {bill ? (
              <div className="mt-2">
                {bi("dnBill")}
                <div lang="en" className="font-mono">
                  {bill.billNo} · {bill.vendorRef}
                </div>
              </div>
            ) : null}
          </div>
          <div className="col-span-2">
            {bi("dnReason")}
            <div className="mt-1">{dn.reason}</div>
          </div>
        </div>
        <table className="w-full border-collapse text-[0.75rem]">
          <thead>
            <tr className="border-y border-[#111] text-left">
              <th className="py-1 pr-2">{bi("dnItem")}</th>
              <th className="py-1 text-right">{bi("dnQty")}</th>
            </tr>
          </thead>
          <tbody>
            {ret.lines.map((l, i) => {
              const item = lookups?.items.get(l.itemId)
              return (
                <tr key={i} className="border-b border-[#ddd]">
                  <td className="py-1 pr-2">
                    {item?.nameBn}
                    <span className="block text-[0.6875rem] text-[#555]">
                      {item?.nameEn} · <span className="font-mono">{item?.sku}</span>
                    </span>
                  </td>
                  <td className="py-1 text-right font-mono">
                    {formatNumber(l.qtyBase, "en")} {item?.baseUom}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <dl className="mt-4 ml-auto grid w-72 grid-cols-2 gap-y-1 text-[0.75rem]">
          <dt>{bi("dnNet")}</dt>
          <dd className="text-right font-mono">{formatMoney(dn.netP, "en")}</dd>
          <dt>{bi("dnVat")}</dt>
          <dd className="text-right font-mono">{formatMoney(dn.vatP, "en")}</dd>
          <dt className="border-t border-[#111] font-semibold">{bi("dnTotal")}</dt>
          <dd className="border-t border-[#111] text-right font-mono font-semibold">{formatMoney(dn.totalP, "en")}</dd>
        </dl>
      </div>
    </PrintLayout>
  )
}

