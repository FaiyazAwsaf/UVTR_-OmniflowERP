"use client"

import * as React from "react"
import { Printer, Send } from "lucide-react"
import { toast } from "sonner"

import { PrintLayout, type PaperSize } from "@/components/shared/print-layout"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { sendToPrinter } from "@/core/connectors/printer"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Print preview on white paper (ui_guidelines.md §6): the sheet in a dialog,
 * the browser print of just that sheet, and "Send to printer" (simulated).
 */
export function PrintPreview({
  title,
  docNo,
  meta,
  size = "A4",
  showBrand = true,
  trigger,
  testId = "print-preview",
  children,
}: {
  title: string
  docNo?: string
  meta?: React.ReactNode
  size?: PaperSize
  showBrand?: boolean
  /** The button that opens the preview (defaults to an outline "Print") */
  trigger?: (open: () => void) => React.ReactNode
  testId?: string
  children: React.ReactNode
}) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  // Focus the paper (its top), not the first footer button, so a tall sheet opens at its header.
  const paperRef = React.useRef<HTMLDivElement>(null)
  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <Button
          variant="neutral"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid={testId}
        >
          <Printer />
          {t("fa.common.print")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          initialFocus={paperRef}
          className="max-h-[92svh] sm:max-w-[min(62rem,calc(100vw-2rem))]"
          data-testid={`${testId}-dialog`}
        >
          <DialogHeader>
            <DialogTitle>{t("fa.common.printPreview")}</DialogTitle>
            <DialogDescription>{title}</DialogDescription>
          </DialogHeader>
          <div
            ref={paperRef}
            tabIndex={-1}
            className="max-h-[calc(92svh-12rem)] overflow-auto rounded-md bg-surface-raised p-3 outline-none"
          >
            <PrintLayout
              size={size}
              title={title}
              docNo={docNo}
              meta={meta}
              showBrand={showBrand}
            >
              {children}
            </PrintLayout>
          </div>
          <DialogFooter className="items-center">
            <SimulatedBadge className="mr-auto" />
            <Button
              variant="neutral"
              onClick={() => {
                const result = sendToPrinter(docNo ?? title)
                toast.success(
                  t("fa.common.sentToPrinter", { what: result.message })
                )
              }}
            >
              <Send />
              {t("fa.common.sendToPrinter")}
            </Button>
            <Button onClick={() => window.print()}>
              <Printer />
              {t("fa.common.print")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A plain table for paper (black on white, hairline rows, money right-aligned mono). */
export function PaperTable({
  head,
  rows,
  foot,
  align,
}: {
  head: React.ReactNode[]
  rows: React.ReactNode[][]
  foot?: React.ReactNode[]
  /** Per column: "r" right-aligns (money) */
  align?: ("l" | "r")[]
}) {
  const cls = (i: number) =>
    align?.[i] === "r" ? "text-right font-mono tabular-nums" : "text-left"
  return (
    <table className="w-full border-collapse text-[0.75rem]">
      <thead>
        <tr className="border-b border-[#111]">
          {head.map((h, i) => (
            <th key={i} className={`px-1.5 py-1 font-semibold ${cls(i)}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className="border-b border-[#e0e0e0]">
            {row.map((cell, i) => (
              <td key={i} className={`px-1.5 py-0.5 align-top ${cls(i)}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot ? (
        <tfoot>
          <tr className="border-t-2 border-[#111] font-semibold">
            {foot.map((cell, i) => (
              <td key={i} className={`px-1.5 py-1 ${cls(i)}`}>
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  )
}
