"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCheck, Save, Send, XCircle } from "lucide-react"
import { toast } from "sonner"

import { ApprovalChip } from "@/components/shared/approval-chip"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyText } from "@/components/shared/money-text"
import { QtyInput } from "@/components/shared/money-input"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type { Id, StockCountRow } from "@/core/db/schema"
import { stockValueId } from "@/core/db/tables"
import { useCommand } from "@/core/engine/useCommand"
import { useCan, useLimit } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { issueValue, roundQty, standardValue } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { cancelCount, postCount, recordCounts } from "../commands"
import { DocHeader, HIDE, ItemCell, LinesTable, NotFound, QtyText, freshKey, useScmLookups } from "./scm-ui"

/** /ic/counts/[id]: enter counted quantities, review the variance, post it (within limit) or send it for approval. */
export function CountDetail({ id }: { id: string }) {
  const db = useDb()
  const { t, locale, money, time, dmy, num } = useLocale()
  const lookups = useScmLookups()
  const limit = useLimit("stock-adjust")
  const save = useCommand(recordCounts)
  const post = useCommand(postCount)
  const cancel = useCommand(cancelCount)
  const [edits, setEdits] = React.useState<Record<number, number | null>>({})
  const [cancelling, setCancelling] = React.useState(false)
  const [reason, setReason] = React.useState("")

  const data = useLiveQuery(async () => {
    const count = await db.stockCounts.get(id)
    if (!count) return { count: undefined }
    const ids = [...new Set(count.lines.map((l) => l.itemId))]
    const values = new Map((await db.stockValues.bulkGet(ids.map((i) => stockValueId(i, count.locationId)))).filter(Boolean).map((v) => [v!.itemId, v!]))
    const batchIds = [...new Set(count.lines.map((l) => l.batchId).filter(Boolean) as Id[])]
    const batches = new Map((await db.batches.bulkGet(batchIds)).filter(Boolean).map((b) => [b!.id, b!]))
    return { count, values, batches }
  }, [db, id])
  const canCount = useCan("ic.count.create", data?.count?.locationId)

  if (data === undefined) return null
  if (!data.count) return <NotFound title={t("ic.count.notFound")} backHref="/ic/counts" backLabel={t("ic.count.back")} />
  const { count, values, batches } = data
  const editable = canCount && (count.status === "open" || count.status === "counted")
  const counted = (i: number) => (i in edits ? edits[i] : (count.lines[i].countedQty ?? null))
  const dirty = Object.keys(edits).length > 0

  // Live variance preview at today's average cost (posting recomputes it).
  const state = new Map<Id, { qty: number; value: number }>()
  const preview = count.lines.map((line, i) => {
    const c = counted(i)
    const varianceQty = c === null ? 0 : roundQty(c - line.expectedQty)
    if (!varianceQty) return { varianceQty, valueP: 0 }
    const item = lookups?.items.get(line.itemId)
    if (!state.has(line.itemId)) {
      const v = values.get(line.itemId)
      state.set(line.itemId, { qty: v?.qtyBase ?? 0, value: v?.valueP ?? 0 })
    }
    const s = state.get(line.itemId)!
    if (varianceQty < 0) {
      const taken = issueValue(-varianceQty, s.qty, s.value)
      s.qty += varianceQty
      s.value -= taken
      return { varianceQty, valueP: -taken }
    }
    const added = s.qty > 0 ? Math.round((varianceQty * s.value) / s.qty) : item ? standardValue(item, varianceQty) : 0
    s.qty += varianceQty
    s.value += added
    return { varianceQty, valueP: added }
  })
  const shown = editable ? preview : count.lines.map((l) => ({ varianceQty: l.varianceQty, valueP: l.varianceValueP }))
  const absTotal = shown.reduce((s, p) => s + Math.abs(p.valueP), 0)
  const countedLines = count.lines.filter((_, i) => counted(i) !== null).length
  const allCounted = countedLines === count.lines.length

  const saveCounts = async (): Promise<StockCountRow | undefined> => {
    const out = await save.run({
      countId: count.id,
      expectedVersion: count.version,
      counts: count.lines.map((_, i) => ({ index: i, countedQty: counted(i) })),
    })
    if (!out) return undefined
    setEdits({})
    return db.stockCounts.get(count.id)
  }

  return (
    <div className="flex flex-col gap-5" data-testid="count-detail">
      <DocHeader
        kind={t("ic.count.kind")}
        docNo={count.countNo}
        status={count.status}
        lines={[
          `${nameOf(lookups?.locations.get(count.locationId), locale)} · ${t("ic.count.snapshot", { time: `${dmy(count.snapshotAt)} ${time(count.snapshotAt)}` })}`,
          t("ic.count.openedBy", { name: userName(lookups?.users.get(count.openedBy), locale) }),
        ]}
        amounts={[
          { label: t("ic.count.countedLines"), value: `${num(countedLines)} / ${num(count.lines.length)}` },
          { label: t("ic.count.varianceLines"), value: num(shown.filter((p) => p.varianceQty !== 0).length) },
          { label: t("ic.count.variancesTotal"), value: <span data-testid="count-variance-total" data-total-p={absTotal}>{money(absTotal)}</span> },
        ]}
        actions={
          editable ? (
            <>
              <Button
                variant="neutral"
                onClick={() =>
                  setEdits((e) => {
                    const next = { ...e }
                    count.lines.forEach((l, i) => {
                      if (counted(i) === null) next[i] = l.expectedQty
                    })
                    return next
                  })
                }
                data-testid="count-fill"
              >
                <CheckCheck />
                {t("ic.count.fillExpected")}
              </Button>
              <Button
                variant="outline"
                disabled={!dirty || save.pending}
                onClick={async () => {
                  if (await saveCounts()) toast.success(t("ic.count.saved"))
                }}
                data-testid="count-save"
              >
                <Save />
                {t("ic.count.saveCounts")}
              </Button>
              <Button
                disabled={!allCounted || post.pending || save.pending}
                data-testid="count-post"
                onClick={async () => {
                  const current = dirty ? await saveCounts() : count
                  if (!current) return
                  const out = await post.run({ countId: current.id, expectedVersion: current.version, idempotencyKey: freshKey() })
                  if (out) toast.success(out.status === "posted" ? t("ic.count.posted", { no: count.countNo }) : t("ic.count.pending", { no: count.countNo }))
                }}
              >
                <Send />
                {t("ic.count.post")}
              </Button>
              <Button variant="ghost" onClick={() => setCancelling(true)} data-testid="count-cancel">
                <XCircle />
                {t("ic.count.cancel")}
              </Button>
              <span className="text-xs text-muted-foreground" data-testid="count-limit-note">
                {absTotal > limit ? t("ic.ui.needsApproval", { limit: money(limit) }) : t("ic.ui.withinLimit", { limit: money(limit === Infinity ? absTotal : limit) })}
              </span>
            </>
          ) : undefined
        }
        links={
          count.approvalId || count.journalId ? (
            <>
              {count.approvalId ? <ApprovalChip approvalId={count.approvalId} /> : null}
              {count.journalId ? <JournalLink journalId={count.journalId} /> : null}
            </>
          ) : undefined
        }
      />
      <SectionCard title={t("ic.pages.count")} subtitle={!editable && count.status !== "cancelled" ? t("ic.count.readOnly") : undefined}>
        <LinesTable
          head={[
            { label: t("ic.count.item") },
            { label: t("ic.count.batch"), hide: "md" },
            { label: t("ic.count.expected"), align: "right" },
            { label: t("ic.count.counted"), align: "right" },
            { label: t("ic.count.variance"), align: "right" },
            { label: t("ic.count.varianceValue"), align: "right", hide: "sm" },
          ]}
        >
          {count.lines.map((line, i) => {
            const item = lookups?.items.get(line.itemId)
            const batch = line.batchId ? batches.get(line.batchId) : undefined
            const p = shown[i]
            return (
              <tr key={i} data-testid="count-line" data-sku={item?.sku} data-index={i} data-expected={line.expectedQty}>
                <td>
                  <ItemCell item={item} href={item ? `/ic/items/${item.id}?location=${count.locationId}` : undefined} />
                </td>
                <td className={HIDE.md}>
                  <span lang="en" className="font-mono text-xs">
                    {batch?.batchNo ?? "-"}
                  </span>
                  {batch?.expiry ? <span className="block text-[0.6875rem] text-muted-foreground">{dmy(batch.expiry)}</span> : null}
                </td>
                <td className="text-right">
                  <QtyText value={line.expectedQty} uom={item?.baseUom} />
                </td>
                <td className="text-right">
                  {editable ? (
                    <QtyInput
                      value={counted(i)}
                      onChange={(v) => setEdits((e) => ({ ...e, [i]: v }))}
                      unit={item?.baseUom}
                      className="ml-auto w-32"
                      data-testid="count-qty"
                      aria-label={`${t("ic.count.counted")} ${item?.sku ?? ""}`}
                    />
                  ) : line.countedQty !== undefined ? (
                    <QtyText value={line.countedQty} uom={item?.baseUom} />
                  ) : (
                    <span className="text-muted-foreground">{t("ic.count.notCounted")}</span>
                  )}
                </td>
                <td className={cn("text-right", p.varianceQty < 0 ? "text-destructive" : p.varianceQty > 0 ? "text-success" : "text-muted-foreground")}>
                  {p.varianceQty ? <QtyText value={p.varianceQty} signed /> : "0"}
                </td>
                <td className={cn("text-right", HIDE.sm)}>{p.valueP ? <MoneyText poisha={p.valueP} signed colorize /> : "-"}</td>
              </tr>
            )
          })}
        </LinesTable>
      </SectionCard>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ic.count.cancelTitle", { no: count.countNo })}</DialogTitle>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ic.ui.reason")} />
          <DialogFooter>
            <Button variant="neutral" onClick={() => setCancelling(false)}>
              {t("common.close")}
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || cancel.pending}
              onClick={async () => {
                const out = await cancel.run({ countId: count.id, expectedVersion: count.version, reason })
                if (out) {
                  toast.success(t("ic.count.cancelled"))
                  setCancelling(false)
                }
              }}
            >
              {t("ic.count.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** The voucher a document posted, as a DocLink to FA. */
export function JournalLink({ journalId, label }: { journalId: Id; label?: string }) {
  const db = useDb()
  const { t } = useLocale()
  const journal = useLiveQuery(() => db.journals.get(journalId), [db, journalId])
  if (!journal) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="journal-link">
      {label ?? t("ic.ui.journal")}
      <DocLink docType="journals" docId={journal.id} docNo={journal.journalNo} />
    </span>
  )
}
