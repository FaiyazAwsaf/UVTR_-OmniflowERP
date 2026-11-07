"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Pencil, Save, Send, ShoppingCart } from "lucide-react"
import { toast } from "sonner"

import { ApprovalChip } from "@/components/shared/approval-chip"
import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { Id, PrLineRow, PurchaseRequisitionRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan, usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { nameOf, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { ItemLinesEditor, newLine, type DraftLine } from "@/modules/ic/components/lines-editor"
import { DocHeader, Field, HIDE, ItemCell, LinesTable, LocationSelect, NotFound, OptionSelect, QtyText, freshKey, useScmLookups } from "@/modules/ic/components/scm-ui"

import { issuePo, saveRequisition, submitRequisition } from "../commands"

/** /ptl/requisitions/[id] ("new" creates): edit and submit a requisition; once approved, create one PO per vendor. */
export function RequisitionDetail({ id }: { id: string }) {
  const db = useDb()
  const { t } = useLocale()
  const [editing, setEditing] = React.useState(false)
  const data = useLiveQuery(async () => {
    if (id === "new") return { pr: undefined, lines: [] as PrLineRow[] }
    const pr = await db.purchaseRequisitions.get(id)
    if (!pr) return null
    return { pr, lines: await db.prLines.where("prId").equals(id).toArray() }
  }, [db, id])
  const canCreate = useCan("ptl.pr.create", data?.pr?.locationId)
  if (data === undefined) return null
  if (data === null) return <NotFound title={t("ptl.pr.notFound")} backHref="/ptl/requisitions" backLabel={t("ptl.pr.back")} />
  const draft = !data.pr || data.pr.status === "draft" || data.pr.status === "rejected"
  if (!data.pr || (draft && canCreate && (editing || data.pr.status === "draft"))) {
    return <RequisitionEditor pr={data.pr} lines={data.lines} />
  }
  return <RequisitionView pr={data.pr} lines={data.lines} onEdit={draft && canCreate ? () => setEditing(true) : undefined} />
}

/** New or draft requisition: location, reason, note and lines (qty in purchase units, estimated cost, suggested vendor). */
function RequisitionEditor({ pr, lines: existing }: { pr?: PurchaseRequisitionRow; lines: PrLineRow[] }) {
  const router = useRouter()
  const { t, tk, locale, money } = useLocale()
  const { can } = usePermissions()
  const session = useSession()
  const lookups = useScmLookups()
  const save = useCommand(saveRequisition)
  const submit = useCommand(submitRequisition)
  const allowed = (lookups?.stockLocations ?? []).filter((l) => can("ptl.pr.create", l.id))
  const [location, setLocation] = React.useState<Id | null>(pr?.locationId ?? null)
  const loc = location ?? (allowed.find((l) => l.id === session.locationId) ?? allowed.find((l) => l.kind === "store") ?? allowed[0])?.id ?? ""
  const [reason, setReason] = React.useState<PurchaseRequisitionRow["reason"]>(pr?.reason ?? "manual")
  const [note, setNote] = React.useState(pr?.note ?? "")
  const [lines, setLines] = React.useState<DraftLine[]>(() =>
    existing.length ? existing.map((l) => newLine({ itemId: l.itemId, qty: l.qty, costP: l.estUnitCostP, vendorId: l.suggestedVendorId ?? null })) : [newLine()]
  )
  const total = lines.reduce((s, l) => s + Math.round((l.qty ?? 0) * (l.costP ?? 0)), 0)
  const valid = !!loc && lines.every((l) => l.itemId && l.qty && l.qty > 0 && l.costP !== null && l.costP !== undefined)
  const payload = () => ({
    prId: pr?.id,
    expectedVersion: pr?.version,
    locationId: loc,
    reason,
    note: note || undefined,
    lines: lines.map((l) => ({ itemId: l.itemId!, qty: l.qty!, estUnitCostP: l.costP ?? 0, suggestedVendorId: l.vendorId ?? undefined })),
  })
  const vendorOptions = [{ value: "none", label: t("ptl.pr.noVendor") }, ...(lookups?.vendorList ?? []).map((v) => ({ value: v.id, label: nameOf(v, locale) }))]

  return (
    <div className="flex flex-col gap-5" data-testid="pr-editor">
      <PageHeader title={pr ? pr.prNo : t("ptl.pr.newTitle")} subtitle={t("ptl.pr.subtitle")} />
      <section className="surface-card grid gap-4 p-5 sm:grid-cols-3">
        <Field label={t("ptl.pr.location")}>
          <LocationSelect value={loc} onChange={setLocation} locations={allowed} includeAll={false} testId="pr-location" className="w-full" />
        </Field>
        <Field label={t("ptl.pr.reason")}>
          <OptionSelect value={reason} onChange={setReason} label={t("ptl.pr.reason")} className="w-full" options={(["manual", "reorder", "job-demand"] as const).map((r) => ({ value: r, label: tk(`ptl.reason.${r}`) }))} />
        </Field>
        <Field label={t("ptl.pr.note")} className="sm:col-span-3">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14" />
        </Field>
      </section>
      <SectionCard title={t("ic.ui.items")}>
        <ItemLinesEditor
          lines={lines}
          onChange={setLines}
          items={lookups?.items}
          unit={(item) => item.purchaseUom}
          qtyLabel={t("ptl.pr.qty")}
          lineTestId="pr-line"
          qtyTestId="pr-qty"
          extra={(line, item, set) => (
            <>
              <div className="flex w-40 flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t("ptl.pr.estCost")}</span>
                <MoneyInput
                  valueP={line.costP ?? (item ? item.standardCostP : null)}
                  onChange={(v) => set({ costP: v })}
                  data-testid="pr-cost"
                  onFocus={() => {
                    if ((line.costP === null || line.costP === undefined) && item) set({ costP: item.standardCostP })
                  }}
                />
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t("ptl.pr.vendor")}</span>
                <OptionSelect value={line.vendorId ?? "none"} onChange={(v) => set({ vendorId: v === "none" ? null : v })} label={t("ptl.pr.vendor")} className="w-full" options={vendorOptions} testId="pr-vendor" />
              </div>
            </>
          )}
          hint={(line, item) => (item && line.qty ? `${t("ptl.pr.lineTotal")}: ${money(Math.round(line.qty * (line.costP ?? item.standardCostP)))}` : null)}
        />
      </SectionCard>
      <section className="surface-card flex flex-wrap items-center justify-between gap-4 p-5">
        <span className="text-[0.8125rem] text-muted-foreground">
          {t("ptl.pr.total")} <MoneyText poisha={total} className="ml-2 text-base font-semibold text-foreground" />
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!valid || save.pending}
            onClick={async () => {
              const out = await save.run(fillCosts(payload(), lookups?.items))
              if (out) {
                toast.success(t("ptl.pr.saved", { no: out.prNo }))
                router.replace(`/ptl/requisitions/${out.id}`)
              }
            }}
            data-testid="pr-save"
          >
            <Save />
            {t("ptl.pr.saveDraft")}
          </Button>
          <Button
            disabled={!lines.every((l) => l.itemId && l.qty) || !loc || submit.pending}
            onClick={async () => {
              const out = await submit.run({ ...fillCosts(payload(), lookups?.items), idempotencyKey: freshKey() })
              if (out) {
                toast.success(out.status === "approved" ? t("ptl.pr.approvedNow", { no: out.prNo }) : t("ptl.pr.pendingNow", { no: out.prNo }))
                router.replace(`/ptl/requisitions/${out.id}`)
              }
            }}
            data-testid="pr-submit"
          >
            <Send />
            {t("ptl.pr.submit")}
          </Button>
        </div>
      </section>
    </div>
  )
}

/** Lines without a typed estimate take the item's standard cost. */
function fillCosts<T extends { lines: { itemId: string; estUnitCostP: number }[] }>(p: T, items: Map<string, { standardCostP: number }> | undefined): T {
  return { ...p, lines: p.lines.map((l) => ({ ...l, estUnitCostP: l.estUnitCostP || items?.get(l.itemId)?.standardCostP || 0 })) }
}

/** A submitted requisition: lines, approval and the POs made from it; when approved, "Create purchase orders". */
function RequisitionView({ pr, lines, onEdit }: { pr: PurchaseRequisitionRow; lines: PrLineRow[]; onEdit?: () => void }) {
  const db = useDb()
  const { t, tk, locale, money, dmy } = useLocale()
  const lookups = useScmLookups()
  const canPo = useCan("ptl.po.create", pr.locationId)
  const pos = useLiveQuery(() => db.purchaseOrders.where("prId").equals(pr.id).toArray(), [db, pr.id])

  return (
    <div className="flex flex-col gap-5" data-testid="pr-view">
      <DocHeader
        kind={t("ptl.pr.kind")}
        docNo={pr.prNo}
        status={pr.status}
        lines={[
          `${nameOf(lookups?.locations.get(pr.locationId), locale)} · ${tk(`ptl.reason.${pr.reason}`)}`,
          t("ptl.pr.requestedLine", { name: userName(lookups?.users.get(pr.requestedBy), locale), date: dmy(pr.date) }),
          pr.note,
        ]}
        amounts={[{ label: t("ptl.pr.total"), value: money(pr.totalP) }]}
        actions={
          onEdit ? (
            <Button variant="outline" onClick={onEdit}>
              <Pencil />
              {t("ptl.pr.editDraft")}
            </Button>
          ) : undefined
        }
        links={
          pr.approvalId || pos?.length ? (
            <>
              {pr.approvalId ? <ApprovalChip approvalId={pr.approvalId} /> : null}
              {(pos ?? []).map((po) => (
                <DocLink key={po.id} docType="purchaseOrders" docId={po.id} docNo={po.poNo} />
              ))}
            </>
          ) : undefined
        }
      />
      <SectionCard title={t("ic.ui.items")}>
        <LinesTable
          head={[
            { label: t("ptl.pr.item") },
            { label: t("ptl.pr.qty"), align: "right" },
            { label: t("ptl.pr.estCost"), align: "right", hide: "sm" },
            { label: t("ptl.pr.vendor"), hide: "md" },
            { label: t("ptl.pr.lineTotal"), align: "right" },
          ]}
        >
          {lines.map((l) => {
            const item = lookups?.items.get(l.itemId)
            return (
              <tr key={l.id} data-testid="pr-line">
                <td>
                  <ItemCell item={item} />
                </td>
                <td className="text-right">
                  <QtyText value={l.qty} uom={item?.purchaseUom} />
                </td>
                <td className={cn("text-right", HIDE.sm)}>
                  <MoneyText poisha={l.estUnitCostP} />
                </td>
                <td className={HIDE.md}>{l.suggestedVendorId ? nameOf(lookups?.vendors.get(l.suggestedVendorId), locale) : "-"}</td>
                <td className="text-right">
                  <MoneyText poisha={Math.round(l.qty * l.estUnitCostP)} />
                </td>
              </tr>
            )
          })}
        </LinesTable>
      </SectionCard>
      {pr.status === "approved" && canPo ? <CreatePos pr={pr} lines={lines} /> : null}
    </div>
  )
}

/** One PO per vendor from an approved requisition (ptl.issuePo with prId). */
function CreatePos({ pr, lines }: { pr: PurchaseRequisitionRow; lines: PrLineRow[] }) {
  const router = useRouter()
  const { t, locale, money, num } = useLocale()
  const lookups = useScmLookups()
  const issue = useCommand(issuePo)
  const today = dhakaDate(useNow(60_000))
  const [vendorOf, setVendorOf] = React.useState<Record<Id, Id | null>>(() => Object.fromEntries(lines.map((l) => [l.id, l.suggestedVendorId ?? null])))
  const [expected, setExpected] = React.useState<Record<string, string>>({})
  const [send, setSend] = React.useState(true)
  const groups = new Map<Id, PrLineRow[]>()
  for (const l of lines) {
    const v = vendorOf[l.id]
    if (v) groups.set(v, [...(groups.get(v) ?? []), l])
  }
  const missing = lines.some((l) => !vendorOf[l.id])
  const vendorOptions = (lookups?.vendorList ?? []).map((v) => ({ value: v.id, label: nameOf(v, locale) }))
  return (
    <SectionCard title={t("ptl.pr.createPos")} icon={ShoppingCart} subtitle={t("ptl.pr.withinTotal", { total: money(pr.totalP) })}>
      <div className="flex flex-col gap-4" data-testid="pr-create-pos">
        {lines
          .filter((l) => !vendorOf[l.id])
          .map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised/40 p-3">
              <ItemCell item={lookups?.items.get(l.itemId)} className="min-w-48 flex-1" />
              <OptionSelect value="none" onChange={(v) => setVendorOf((m) => ({ ...m, [l.id]: v === "none" ? null : v }))} label={t("ptl.pr.vendor")} options={[{ value: "none", label: t("ptl.pr.pickVendor") }, ...vendorOptions]} testId="pr-pick-vendor" />
            </div>
          ))}
        {[...groups.entries()].map(([vendorId, rows]) => (
          <div key={vendorId} className="flex flex-col gap-2 rounded-md border border-hairline p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">{t("ptl.pr.poFor", { vendor: nameOf(lookups?.vendors.get(vendorId), locale) })}</span>
              <Field label={t("ptl.pr.expected")} className="w-40">
                <DateField value={expected[vendorId] ?? addDaysISO(today, 3)} min={today} onChange={(iso) => setExpected((e) => ({ ...e, [vendorId]: iso }))} />
              </Field>
            </div>
            <ul className="text-[0.8125rem] text-muted-foreground">
              {rows.map((l) => {
                const item = lookups?.items.get(l.itemId)
                return (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="truncate">{nameOf(item, locale)}</span>
                    <span className="nums whitespace-nowrap">
                      {num(l.qty)} {item?.purchaseUom} · {money(Math.round(l.qty * l.estUnitCostP))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[0.8125rem]">
            <Checkbox checked={send} onCheckedChange={(v) => setSend(!!v)} />
            {t("ptl.pr.sendEmail")}
          </label>
          <Button
            disabled={missing || !groups.size || issue.pending}
            data-testid="pr-issue-pos"
            onClick={async () => {
              const out = await issue.run({
                prId: pr.id,
                locationId: pr.locationId,
                orders: [...groups.entries()].map(([vendorId, rows]) => ({
                  vendorId,
                  expectedDate: expected[vendorId] || addDaysISO(today, 3),
                  lines: rows.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCostP: l.estUnitCostP })),
                })),
                send,
                idempotencyKey: freshKey(),
              })
              if (out) {
                toast.success(t("ptl.pr.issued", { count: num(out.pos.length) }))
                router.push(out.pos.length === 1 ? `/ptl/po/${out.pos[0].id}` : "/ptl/po")
              }
            }}
          >
            <ShoppingCart />
            {missing ? t("ptl.pr.pickVendor") : t("ptl.pr.issuePos", { count: num(groups.size) })}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}
