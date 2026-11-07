"use client"

import * as React from "react"
import { Printer, Send } from "lucide-react"
import { toast } from "sonner"

import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { sendToPrinter } from "@/core/connectors/printer"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Print preview of a document (plan §9 print layouts): the white-paper sheet
 * in a dialog, the browser print, and "Send to printer" (simulated, badge).
 */
export function PrintDialog({
  open,
  onOpenChange,
  title,
  docNo,
  children,
  testId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  docNo: string
  children: React.ReactNode
  testId?: string
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-1.5rem)] gap-4 bg-surface-raised p-4 sm:max-w-[min(58rem,calc(100%-1.5rem))]" data-testid={testId}>
        <DialogHeader className="flex-row flex-wrap items-center gap-2 pr-10">
          <DialogTitle className="mr-auto">{title}</DialogTitle>
          <SimulatedBadge />
          <Button
            size="sm"
            variant="neutral"
            onClick={() => {
              const r = sendToPrinter(docNo)
              toast.success(t("par.print.sent", { doc: r.message }))
            }}
          >
            <Send />
            {t("par.print.send")}
          </Button>
          <Button size="sm" onClick={() => window.print()} data-testid="print-now">
            <Printer />
            {t("common.print")}
          </Button>
        </DialogHeader>
        <div className="min-w-0 overflow-x-auto rounded-md">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
