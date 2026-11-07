"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

import { ItemPicker } from "@/components/shared/pickers"
import { QtyInput } from "@/components/shared/money-input"
import { Button } from "@/components/ui/button"
import type { ItemRow } from "@/core/db/schema"
import { newId } from "@/core/db/ids"
import { useLocale } from "@/lib/i18n/provider"

/** One editable document line: an item, a quantity and optional extras. */
export type DraftLine = {
  key: string
  itemId: string | null
  qty: number | null
  batchId?: string | null
  costP?: number | null
  vendorId?: string | null
}

export function newLine(init: Partial<DraftLine> = {}): DraftLine {
  return { key: newId("ln"), itemId: null, qty: null, ...init }
}

/**
 * Item lines for transfer requests, adjustments, internal use, requisitions
 * and POs: an item picker, the quantity in the item's unit (base or
 * purchase), extra fields per line, and add and remove. Wraps to two rows in
 * a 960px window.
 */
export function ItemLinesEditor({
  lines,
  onChange,
  items,
  unit,
  qtyLabel,
  kinds,
  extra,
  hint,
  lineTestId = "line",
  qtyTestId = "line-qty",
}: {
  lines: DraftLine[]
  onChange: (lines: DraftLine[]) => void
  items: Map<string, ItemRow> | undefined
  unit: (item: ItemRow) => string
  qtyLabel: string
  kinds?: ItemRow["kind"][]
  /** Extra controls for a line (batch, cost, vendor) */
  extra?: (line: DraftLine, item: ItemRow | undefined, set: (patch: Partial<DraftLine>) => void) => React.ReactNode
  /** A muted note under a line (available quantity, value) */
  hint?: (line: DraftLine, item: ItemRow | undefined) => React.ReactNode
  lineTestId?: string
  qtyTestId?: string
}) {
  const { t } = useLocale()
  const set = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  return (
    <div className="flex flex-col gap-3">
      {lines.map((line, index) => {
        const item = line.itemId ? items?.get(line.itemId) : undefined
        return (
          <div key={line.key} data-testid={lineTestId} data-index={index} className="flex flex-col gap-1.5 rounded-md bg-surface-raised/40 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-56 flex-[2] flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t("ic.ui.item")}</span>
                <ItemPicker value={line.itemId} onChange={(id) => set(line.key, { itemId: id, batchId: null })} kinds={kinds} testId={`${lineTestId}-item`} />
              </div>
              <div className="flex w-36 flex-col gap-1">
                <span className="text-xs text-muted-foreground">{qtyLabel}</span>
                <QtyInput value={line.qty} onChange={(v) => set(line.key, { qty: v })} unit={item ? unit(item) : undefined} data-testid={qtyTestId} />
              </div>
              {extra?.(line, item, (patch) => set(line.key, patch))}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("ic.ui.removeLine")}
                disabled={lines.length === 1}
                onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                className="mb-1"
              >
                <Trash2 />
              </Button>
            </div>
            {hint ? <div className="text-xs text-muted-foreground">{hint(line, item)}</div> : null}
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...lines, newLine()])} data-testid={`${lineTestId}-add`}>
        <Plus />
        {t("ic.ui.addLine")}
      </Button>
    </div>
  )
}
