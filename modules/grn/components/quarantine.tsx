"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"

import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDb } from "@/core/db/DbProvider"
import type { GrnLineRow, GrnRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field, HIDE, ItemCell, LinesTable, useScmLookups } from "@/modules/ic/components/scm-ui"

import { acceptQuarantine, returnRejected } from "../commands"

type Row = { line: GrnLineRow; grn: GrnRow }

/** /grn/quarantine: lots held at receipt; accept into stock at the PO cost (R12) or return to the vendor (nothing posts). */
export function QuarantineScreen() {
  const db = useDb()
  const { t, tk, num, dmy } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const [tab, setTab] = React.useState<"held" | "decided">("held")
  const [deciding, setDeciding] = React.useState<{ row: Row; action: "accept" | "return" } | null>(null)

  const rows = useLiveQuery(async () => {
    const lines = (await db.grnLines.where("quarantineStatus").anyOf(tab === "held" ? ["held"] : ["accepted", "returned"]).toArray()) as GrnLineRow[]
    const grns = new Map((await db.grns.bulkGet([...new Set(lines.map((l) => l.grnId))])).filter(Boolean).map((g) => [g!.id, g!]))
    return lines
      .map((line) => ({ line, grn: grns.get(line.grnId)! }))
      .filter((r) => r.grn)
      .sort((a, b) => b.grn.receivedAt - a.grn.receivedAt)
  }, [db, tab])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("grn.quarantine.title")} subtitle={t("grn.quarantine.subtitle")} />
      <section className="surface-card flex flex-col gap-4 p-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "held" | "decided")}>
          <TabsList>
            <TabsTrigger value="held">{t("grn.quarantine.held")}</TabsTrigger>
            <TabsTrigger value="decided">{t("grn.quarantine.decided")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {rows?.length ? (
          <LinesTable
            head={[
              { label: t("grn.quarantine.item") },
              { label: t("grn.quarantine.grn"), hide: "sm" },
              { label: t("grn.quarantine.batch"), hide: "lg" },
              { label: t("grn.quarantine.qty"), align: "right" },
              { label: t("grn.quarantine.reason"), hide: "md" },
              { label: t("grn.quarantine.value"), align: "right", hide: "md" },
              { label: t("grn.quarantine.status") },
              { label: "" },
            ]}
          >
            {rows.map((r) => {
              const item = lookups?.items.get(r.line.itemId)
              const allowed = can("grn.quarantine.decide", r.grn.locationId)
              return (
                <tr key={r.line.id} data-testid="quarantine-row" data-sku={item?.sku}>
                  <td>
                    <ItemCell item={item} />
                  </td>
                  <td className={HIDE.sm}>
                    <DocLink docType="grns" docId={r.grn.id} docNo={r.grn.grnNo} showApp={false} />
                    <span className="block text-[0.6875rem] text-muted-foreground">{dmy(r.grn.date)}</span>
                  </td>
                  <td className={HIDE.lg}>
                    <span lang="en" className="font-mono text-xs">
                      {r.line.batchNo ?? "-"}
                    </span>
                    {r.line.expiry ? <span className="block text-[0.6875rem] text-muted-foreground">{dmy(r.line.expiry)}</span> : null}
                  </td>
                  <td className="text-right nums">
                    {num(r.line.qtyRejected)} <span className="text-xs text-muted-foreground">{item?.purchaseUom}</span>
                  </td>
                  <td className={HIDE.md}>{r.line.rejectReason ? tk(`grn.reason.${r.line.rejectReason}`) : "-"}</td>
                  <td className={cn("text-right", HIDE.md)}>
                    <MoneyText poisha={Math.round(r.line.qtyRejected * r.line.unitCostP)} />
                  </td>
                  <td>
                    <DocStatus status={r.line.quarantineStatus ?? "held"} />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {tab === "held" && allowed ? (
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, action: "accept" })} data-testid="quarantine-accept">
                          {t("grn.quarantine.accept")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeciding({ row: r, action: "return" })} data-testid="quarantine-return">
                          {t("grn.quarantine.return")}
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </LinesTable>
        ) : (
          <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">{t("grn.quarantine.empty")}</p>
        )}
      </section>
      <Dialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent>{deciding ? <DecideForm row={deciding.row} action={deciding.action} sku={lookups?.items.get(deciding.row.line.itemId)?.sku ?? ""} onClose={() => setDeciding(null)} /> : null}</DialogContent>
      </Dialog>
    </div>
  )
}

function DecideForm({ row, action, sku, onClose }: { row: Row; action: "accept" | "return"; sku: string; onClose: () => void }) {
  const { t, num } = useLocale()
  const accept = useCommand(acceptQuarantine)
  const ret = useCommand(returnRejected)
  const [note, setNote] = React.useState("")
  const qty = num(row.line.qtyRejected)
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const input = { grnLineId: row.line.id, expectedVersion: row.line.version, note: note || undefined }
        const out = action === "accept" ? await accept.run(input) : await ret.run(input)
        if (out) {
          toast.success(action === "accept" ? t("grn.quarantine.accepted") : t("grn.quarantine.returned"))
          onClose()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{action === "accept" ? t("grn.quarantine.accept") : t("grn.quarantine.return")}</DialogTitle>
        <DialogDescription>{action === "accept" ? t("grn.quarantine.confirmAccept", { qty, sku }) : t("grn.quarantine.confirmReturn", { qty, sku })}</DialogDescription>
      </DialogHeader>
      <Field label={t("grn.quarantine.note")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={accept.pending || ret.pending} data-testid="quarantine-confirm">
          {action === "accept" ? t("grn.quarantine.accept") : t("grn.quarantine.return")}
        </Button>
      </DialogFooter>
    </form>
  )
}
