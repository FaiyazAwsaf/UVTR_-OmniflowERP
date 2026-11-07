"use client"

import * as React from "react"
import { Printer } from "lucide-react"

import { PrintLayout } from "@/components/shared/print-layout"
import { useCellFormatter } from "@/components/shared/report-view"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ReportResult } from "@/core/reports/runner"
import type { DatasetRow } from "@/core/reports/types"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The report on white paper (ui_guidelines.md §6): tenant header, title,
 * code, parameters and who generated it, then the grouped table with
 * subtotals and totals. "Print" prints only the sheet.
 */
export function PrintPreview({
  open,
  onOpenChange,
  result,
  title,
  code,
  meta,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: ReportResult
  title: string
  code: string
  meta: React.ReactNode
}) {
  const { t, tk } = useLocale()
  const format = useCellFormatter()
  const fields = new Map(result.dataset.fields.map((f) => [f.key, f]))
  const columns = result.columns.filter((c) => fields.has(c))
  const numeric = (key: string) => ["money", "number"].includes(fields.get(key)?.type ?? "")
  const cell = (row: DatasetRow, key: string) => format(fields.get(key), row[key])
  const rows = (list: DatasetRow[]) =>
    list.map((row, i) => (
      <tr key={i} className="border-b border-[#e0e0e0]">
        {columns.map((key) => (
          <td key={key} className={numeric(key) ? "px-1.5 py-1 text-right font-mono" : "px-1.5 py-1"}>
            {cell(row, key)}
          </td>
        ))}
      </tr>
    ))
  const totalsRow = (totals: Record<string, number>, label: string) => (
    <tr className="border-t-2 border-[#111] font-semibold">
      {columns.map((key, i) => (
        <td key={key} className={numeric(key) ? "px-1.5 py-1 text-right font-mono" : "px-1.5 py-1"}>
          {key in totals ? cell({ [key]: totals[key] }, key) : i === 0 ? label : ""}
        </td>
      ))}
    </tr>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] sm:max-w-[min(64rem,calc(100vw-2rem))]" data-testid="report-print-sheet">
        <DialogHeader>
          <DialogTitle className="text-[1.0625rem] font-semibold">{t("irt.run.printPreview")}</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-md bg-surface-raised p-4">
          <PrintLayout title={title} docNo={code} meta={meta}>
            <table className="w-full border-collapse text-[0.75rem]">
              <thead>
                <tr className="border-b-2 border-[#111]">
                  {columns.map((key) => (
                    <th key={key} className={numeric(key) ? "px-1.5 py-1 text-right" : "px-1.5 py-1 text-left"}>
                      {tk(fields.get(key)?.labelKey ?? key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.groups
                  ? result.groups.map((group, gi) => (
                      <React.Fragment key={gi}>
                        <tr className="bg-[#f1f1f1]">
                          <td colSpan={columns.length} className="px-1.5 py-1 font-semibold">
                            {Object.entries(group.key)
                              .map(([k, v]) => format(fields.get(k), v))
                              .join(" · ")}{" "}
                            ({group.count})
                          </td>
                        </tr>
                        {rows(group.rows)}
                        {Object.keys(group.totals).length ? totalsRow(group.totals, "") : null}
                      </React.Fragment>
                    ))
                  : rows(result.rows)}
                {Object.keys(result.totals).length ? totalsRow(result.totals, t("shared.report.totals")) : null}
              </tbody>
            </table>
          </PrintLayout>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <SimulatedBadge />
          <Button onClick={() => window.print()} data-testid="report-print">
            <Printer />
            {t("irt.run.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
