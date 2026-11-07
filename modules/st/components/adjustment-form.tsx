"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type { Id, StockAdjustmentRow } from "@/core/db/schema"
import { stockValueId } from "@/core/db/tables"
import { useCommand } from "@/core/engine/useCommand"
import { useLimit, usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { issueValue, standardValue } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import { ItemLinesEditor, newLine, type DraftLine } from "@/modules/ic/components/lines-editor"
import { Field, LocationSelect, OptionSelect, freshKey, useScmLookups } from "@/modules/ic/components/scm-ui"

import { ISSUE_TAGS, recordIssue, saveAdjustment, type IssueTag } from "../commands"

type AdjustReason = Exclude<StockAdjustmentRow["reason"], "internal-use">
const REASONS: AdjustReason[] = ["damage", "expiry", "loss", "found", "correction"]

export type AdjustmentPrefill = { reason?: AdjustReason; locationId?: Id; itemId?: Id; batchId?: Id; qty?: number }

/** Batches of an item with stock at a location, for the line's batch select. */
function BatchSelect({ itemId, locationId, value, onChange }: { itemId: Id; locationId: Id; value: Id | null | undefined; onChange: (id: Id | null) => void }) {
  const db = useDb()
  const { t, dmy } = useLocale()
  const options = useLiveQuery(async () => {
    const balances = (await db.stockBalances.where("[itemId+locationId]").equals([itemId, locationId]).toArray()).filter((b) => b.batchId && b.qtyBase > 0)
    const batches = await db.batches.bulkGet(balances.map((b) => b.batchId!))
    return batches.filter(Boolean).map((b) => ({ value: b!.id, label: `${b!.batchNo}${b!.expiry ? ` · ${dmy(b!.expiry)}` : ""}` }))
  }, [db, itemId, locationId])
  if (!options?.length) return null
  return (
    <div className="flex w-52 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{t("st.adjustments.batch")}</span>
      <OptionSelect value={value ?? "any"} onChange={(v) => onChange(v === "any" ? null : v)} label={t("st.adjustments.batch")} options={[{ value: "any", label: t("st.adjustments.anyBatch") }, ...options]} />
    </div>
  )
}

/**
 * A new stock adjustment (st.saveAdjustment) or internal use (st.recordIssue):
 * location, reason or expense, lines; the estimated value against the
 * maker's `stock-adjust` limit says whether it posts at once or waits.
 */
export function AdjustmentForm({ mode, prefill, onClose }: { mode: "adjust" | "issue"; prefill?: AdjustmentPrefill; onClose: (id?: string) => void }) {
  const db = useDb()
  const { t, tk, money } = useLocale()
  const { can } = usePermissions()
  const session = useSession()
  const lookups = useScmLookups()
  const limit = useLimit("stock-adjust")
  const adjust = useCommand(saveAdjustment)
  const issue = useCommand(recordIssue)
  const allowed = (lookups?.stockLocations ?? []).filter((l) => can("st.adjust.create", l.id))
  const [location, setLocation] = React.useState<Id | null>(prefill?.locationId ?? null)
  const loc = location ?? (allowed.find((l) => l.id === session.locationId) ?? allowed[0])?.id ?? ""
  const [reason, setReason] = React.useState<AdjustReason>(prefill?.reason ?? "damage")
  const [expense, setExpense] = React.useState<IssueTag>("OFFICE")
  const [note, setNote] = React.useState("")
  const [lines, setLines] = React.useState<DraftLine[]>(() => [newLine({ itemId: prefill?.itemId ?? null, batchId: prefill?.batchId ?? null, qty: prefill?.qty ?? null })])
  const signed = (q: number) => (mode === "issue" ? -Math.abs(q) : reason === "found" ? Math.abs(q) : reason === "correction" ? q : -Math.abs(q))

  const values = useLiveQuery(async () => {
    const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean) as Id[])]
    return new Map((await db.stockValues.bulkGet(ids.map((i) => stockValueId(i, loc)))).filter(Boolean).map((v) => [v!.itemId, v!]))
  }, [db, loc, lines.map((l) => l.itemId).join(",")])

  // The value estimate, in line order (the command recomputes it at posting).
  let estimate = 0
  const state = new Map<Id, { qty: number; value: number }>()
  for (const l of lines) {
    if (!l.itemId || !l.qty) continue
    const item = lookups?.items.get(l.itemId)
    if (!state.has(l.itemId)) state.set(l.itemId, { qty: values?.get(l.itemId)?.qtyBase ?? 0, value: values?.get(l.itemId)?.valueP ?? 0 })
    const s = state.get(l.itemId)!
    const q = signed(l.qty)
    if (q < 0) {
      const taken = issueValue(-q, s.qty, s.value)
      s.qty += q
      s.value -= taken
      estimate += taken
    } else {
      const added = s.qty > 0 ? Math.round((q * s.value) / s.qty) : item ? standardValue(item, q) : 0
      s.qty += q
      s.value += added
      estimate += added
    }
  }
  const valid = !!loc && note.trim().length >= 3 && lines.every((l) => l.itemId && l.qty)
  const pending = adjust.pending || issue.pending

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out =
          mode === "issue"
            ? await issue.run({
                locationId: loc,
                expenseTag: expense,
                note,
                lines: lines.map((l) => ({ itemId: l.itemId!, qtyBase: Math.abs(l.qty!) })),
                idempotencyKey: freshKey(),
              })
            : await adjust.run({
                locationId: loc,
                reason,
                note,
                lines: lines.map((l) => ({ itemId: l.itemId!, batchId: l.batchId ?? undefined, qtyBase: signed(l.qty!) })),
                idempotencyKey: freshKey(),
              })
        if (out) {
          const posted = out.status === "posted"
          toast.success(
            mode === "issue"
              ? t(posted ? "st.issues.posted" : "st.issues.pending", { no: out.adjustmentNo })
              : t(posted ? "st.adjustments.posted" : "st.adjustments.pending", { no: out.adjustmentNo })
          )
          onClose(out.id)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{mode === "issue" ? t("st.issues.newTitle") : t("st.adjustments.newTitle")}</DialogTitle>
        <DialogDescription>{mode === "issue" ? t("st.issues.subtitle") : t("st.adjustments.subtitle")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("ic.ui.location")}>
          <LocationSelect value={loc} onChange={setLocation} locations={allowed} includeAll={false} testId="adjustment-location" className="w-full" />
        </Field>
        {mode === "issue" ? (
          <Field label={t("st.issues.expense")}>
            <OptionSelect
              value={expense}
              onChange={setExpense}
              label={t("st.issues.expense")}
              className="w-full"
              testId="issue-expense"
              options={ISSUE_TAGS.map((tag) => ({ value: tag, label: tk(`st.expense.${tag}`) }))}
            />
          </Field>
        ) : (
          <Field label={t("st.adjustments.reason")}>
            <OptionSelect value={reason} onChange={setReason} label={t("st.adjustments.reason")} className="w-full" testId="adjustment-reason" options={REASONS.map((r) => ({ value: r, label: t(`st.reason.${r}`) }))} />
          </Field>
        )}
      </div>
      <ItemLinesEditor
        lines={lines}
        onChange={setLines}
        items={lookups?.items}
        unit={(item) => item.baseUom}
        qtyLabel={mode === "issue" ? t("st.issues.qty") : reason === "found" ? t("st.adjustments.qtyIn") : reason === "correction" ? t("st.adjustments.qtySigned") : t("st.adjustments.qtyOut")}
        lineTestId="adjustment-line"
        qtyTestId="adjustment-qty"
        extra={(line, item, set) => (mode === "adjust" && item && loc ? <BatchSelect itemId={item.id} locationId={loc} value={line.batchId} onChange={(id) => set({ batchId: id })} /> : null)}
        hint={(line, item) => (item ? t("ic.ui.available", { qty: `${values?.get(item.id)?.qtyBase ?? 0} ${item.baseUom}` }) : null)}
      />
      <Field label={t("ic.ui.note")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ic.ui.notePlaceholder")} className="min-h-16" data-testid="adjustment-note" />
      </Field>
      <p className="rounded-md bg-surface-raised px-3 py-2 text-[0.8125rem]" data-testid="adjustment-estimate">
        {t("ic.ui.estValue", { value: money(estimate) })} ·{" "}
        <span className={estimate > limit ? "text-warning" : "text-success"}>
          {estimate > limit ? t("ic.ui.needsApproval", { limit: money(limit) }) : t("ic.ui.withinLimit", { limit: money(limit === Infinity ? estimate : limit) })}
        </span>
      </p>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => onClose()}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!valid || pending} data-testid="adjustment-submit">
          {mode === "issue" ? t("st.issues.submit") : t("st.adjustments.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
