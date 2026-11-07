"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"

import { useInlineApproval } from "@/components/shared/approval-dialog"
import { QtyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { invoiceOpen } from "@/core/ar/receipt"
import { useDb } from "@/core/db/DbProvider"
import type { Id, SalesInvoiceLineRow, SalesInvoiceRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useLimit } from "@/core/security/useCan"
import { percentOf } from "@/core/tax/vat"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { newKey } from "@/modules/stl/components/kit"

import { createCreditNote } from "../commands"

/**
 * Mushak 6.7 credit note against invoice lines (E12): pick the lines (a
 * quantity for goods), the reason and whether returned goods go back on the
 * shelf. Above the maker's credit-note limit an approver confirms on the
 * spot (PIN), or it is sent to the approvals inbox. The part beyond what
 * the invoice still owes is kept as the customer's advance.
 */
export function CreditNoteDialog({
  invoice,
  lines,
  open,
  onOpenChange,
}: {
  invoice: SalesInvoiceRow
  lines: SalesInvoiceLineRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const db = useDb()
  const { t, locale, money, num } = useLocale()
  const limit = useLimit("credit-note")
  const create = useCommand(createCreditNote)
  const { requestApproval, dialog } = useInlineApproval()
  const [picked, setPicked] = React.useState<Record<Id, number | null>>({})
  const [reason, setReason] = React.useState("")
  const [restock, setRestock] = React.useState(false)

  const credited = useLiveQuery(async () => {
    const notes = (await db.creditNotes.where("invoiceId").equals(invoice.id).toArray()).filter((c) => c.status !== "rejected")
    const out = new Map<Id, number>()
    for (const n of notes) for (const l of n.lines) out.set(l.invoiceLineId, (out.get(l.invoiceLineId) ?? 0) + (l.qty ?? 0))
    return out
  }, [db, invoice.id])

  const rows = lines.map((l) => {
    const remaining = Math.max(0, l.qty - (credited?.get(l.id) ?? 0))
    const qty = picked[l.id]
    const chosen = qty !== undefined && qty !== null && qty > 0
    let amount = 0
    if (chosen) {
      if (qty === l.qty) amount = l.netP + l.vatP
      else {
        const gross = Math.round(qty * l.unitPriceP)
        const net = gross - Math.round((l.discountP * qty) / l.qty)
        amount = net + percentOf(net, l.vatRatePct)
      }
    }
    return { line: l, remaining, qty, chosen, amount }
  })
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const open_ = Math.max(0, invoiceOpen(invoice) - invoice.reservedP)
  const toInvoice = Math.min(total, open_)
  const toAdvance = total - toInvoice
  const hasGoods = rows.some((r) => r.chosen && r.line.itemId)
  const overLimit = total > limit
  const valid = total > 0 && reason.trim().length >= 3 && rows.every((r) => !r.chosen || (r.qty ?? 0) <= r.remaining)

  const close = () => {
    setPicked({})
    setReason("")
    setRestock(false)
    onOpenChange(false)
  }

  const submit = async (queue: boolean) => {
    let inline
    if (overLimit && !queue) {
      inline = await requestApproval({
        kind: "credit-note",
        docType: "creditNotes",
        locationId: invoice.locationId,
        amountP: total,
        description: t("si.credit.ask", { amount: money(total), no: invoice.invoiceNo }),
      })
      if (!inline) return
    }
    const out = await create.run({
      invoiceId: invoice.id,
      lines: rows.filter((r) => r.chosen).map((r) => ({ invoiceLineId: r.line.id, qty: r.qty ?? undefined })),
      reason,
      restock: hasGoods && restock,
      inline,
      queue: overLimit && queue,
      idempotencyKey: newKey(),
    })
    if (out) {
      toast.success(t(out.status === "posted" ? "si.credit.posted" : "si.credit.queued", { no: out.creditNoteNo }))
      close()
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
        <DialogContent className="sm:max-w-xl" data-testid="credit-note-dialog">
          <DialogHeader>
            <DialogTitle>{t("si.credit.title", { no: invoice.invoiceNo })}</DialogTitle>
            <DialogDescription>{t("si.credit.body")}</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.line.id} className={cn("flex flex-wrap items-center gap-3 rounded-md px-3 py-2", r.chosen ? "bg-primary-soft" : "bg-surface-raised/60", !r.remaining && "opacity-50")} data-testid="credit-note-line">
                <Checkbox
                  checked={r.chosen}
                  disabled={!r.remaining}
                  onCheckedChange={(v) => setPicked((cur) => ({ ...cur, [r.line.id]: v ? r.remaining : null }))}
                  data-testid="credit-note-line-check"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem]">{locale === "bn" ? r.line.descriptionBn : r.line.descriptionEn}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.remaining < r.line.qty ? t("si.credit.remaining", { qty: num(r.remaining) }) : null}
                  </span>
                </span>
                {r.chosen && r.line.itemId && r.line.qty > 1 ? (
                  <QtyInput value={r.qty ?? null} onChange={(v) => setPicked((cur) => ({ ...cur, [r.line.id]: v }))} unit="pc" className="w-24" />
                ) : null}
                <MoneyText poisha={r.chosen ? r.amount : r.line.netP + r.line.vatP} className={cn("font-mono text-[0.8125rem]", !r.chosen && "text-muted-foreground")} />
              </li>
            ))}
          </ul>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("si.credit.reason")} data-testid="credit-note-reason" className="min-h-16" />
          {hasGoods ? (
            <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
              {t("si.credit.restock")}
              <Switch checked={restock} onCheckedChange={setRestock} data-testid="credit-note-restock" />
            </label>
          ) : null}
          <dl className="grid grid-cols-3 gap-2 rounded-md bg-surface-raised px-3 py-2 text-[0.8125rem]">
            <div>
              <dt className="text-xs text-muted-foreground">{t("common.total")}</dt>
              <dd className="font-mono font-semibold" data-testid="credit-note-total">
                <MoneyText poisha={total} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("si.credit.toInvoice")}</dt>
              <dd className="font-mono">
                <MoneyText poisha={toInvoice} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("si.credit.toAdvance")}</dt>
              <dd className="font-mono">
                <MoneyText poisha={toAdvance} />
              </dd>
            </div>
          </dl>
          {overLimit ? <p className="text-xs text-warning">{t("si.credit.overLimit", { limit: money(limit) })}</p> : null}
          <DialogFooter>
            <Button variant="neutral" onClick={close}>
              {t("common.cancel")}
            </Button>
            {overLimit ? (
              <Button variant="outline" onClick={() => submit(true)} disabled={!valid || create.pending} data-testid="credit-note-queue">
                {t("si.credit.sendForApproval")}
              </Button>
            ) : null}
            <Button onClick={() => submit(false)} disabled={!valid || create.pending} data-testid="credit-note-submit">
              {overLimit ? t("si.credit.approveNow") : t("si.credit.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  )
}
