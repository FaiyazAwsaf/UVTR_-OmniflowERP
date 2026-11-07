"use client"

import * as React from "react"

import { TenantMark } from "@/components/shared/tenant-mark"
import {
  locations,
  printHeader,
  tenant,
  type LocationCode,
} from "@/config/brand.config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export type PaperSize = "A4" | "A5" | "receipt" | "label"

const PAPER: Record<
  PaperSize,
  { width: string; minHeight: string; page: string; pad: string }
> = {
  A4: { width: "210mm", minHeight: "297mm", page: "A4", pad: "14mm" },
  A5: { width: "148mm", minHeight: "210mm", page: "A5", pad: "10mm" },
  receipt: {
    width: "80mm",
    minHeight: "120mm",
    page: "80mm 200mm",
    pad: "5mm",
  },
  label: { width: "70mm", minHeight: "45mm", page: "70mm 45mm", pad: "3mm" },
}

/**
 * Tokens pinned for paper: print layouts are never themed (docs/ui_guidelines.md
 * §6), so shared components nested inside read black-on-white values.
 */
const PAPER_TOKENS = {
  "--background": "#ffffff",
  "--foreground": "#111111",
  "--card": "#ffffff",
  "--card-foreground": "#111111",
  "--popover": "#ffffff",
  "--surface": "#ffffff",
  "--surface-raised": "#f1f1f1",
  "--muted-foreground": "#555555",
  "--border": "#c9c9c9",
  "--hairline": "#e0e0e0",
  "--primary": "#111111",
  "--primary-foreground": "#ffffff",
  "--link": "#111111",
} as React.CSSProperties

function printCss(page: string) {
  return `@media print {
  @page { size: ${page}; margin: 0; }
  html, body { background: #fff !important; }
  /* Only the sheet goes on paper: every branch of the page that does not lead
     to it is removed (not just hidden), so it takes no room and adds no
     pages. */
  *:has([data-print-root]) > *:not([data-print-root]):not(:has([data-print-root])) { display: none !important; }
  /* The sheet's ancestors (the app frame, a dialog centred with translate and
     animated with scale) become plain blocks at the page origin, so a long
     sheet runs onto as many pages as it needs. Tailwind v4 moves dialogs with
     the separate translate and scale properties, not transform. */
  *:has([data-print-root]) {
    display: block !important; position: static !important; inset: auto !important;
    transform: none !important; translate: none !important; scale: none !important; rotate: none !important; animation: none !important;
    overflow: visible !important; width: auto !important; max-width: none !important; height: auto !important; max-height: none !important; min-height: 0 !important;
    margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; outline: 0 !important;
  }
  [data-print-root] { position: static !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
}`
}

/**
 * White paper with black text and the tenant header (name, address, BIN from
 * config/brand.config.ts), for every printed document: Mushak forms,
 * quotation, job card, challan, gate pass, receipt, PO, GRN, vouchers. On
 * screen it previews the sheet; printing shows only the sheet at its page
 * size. The Bangla face is the embedded Noto Sans Bengali (ui_guidelines §6).
 */
export function PrintLayout({
  children,
  size = "A4",
  title,
  docNo,
  meta,
  location,
  showBrand = true,
  footer,
  demoFooter = true,
  className,
}: {
  children: React.ReactNode
  size?: PaperSize
  /** Document type, e.g. "Tax invoice (Mushak 6.3)" */
  title?: React.ReactNode
  /** Document number, shown in mono (Latin digits) */
  docNo?: string
  /** Extra right-hand header lines (date, party, and so on) */
  meta?: React.ReactNode
  /** Location for the address line; the registered address otherwise */
  location?: LocationCode
  /** Tenant header (off for small labels) */
  showBrand?: boolean
  footer?: React.ReactNode
  /** "Simplified layout for demonstration" (accounting_rules.md §4.4) */
  demoFooter?: boolean
  className?: string
}) {
  const { locale } = useLocale()
  const paper = PAPER[size]
  const locationRow = location
    ? locations.find((l) => l.code === location)
    : undefined
  const small = size === "label" || size === "receipt"

  return (
    <div
      data-print-root
      data-slot="print-layout"
      style={{
        ...PAPER_TOKENS,
        width: paper.width,
        minHeight: paper.minHeight,
        padding: paper.pad,
      }}
      className={cn(
        "mx-auto flex max-w-full flex-col bg-white text-[#111] shadow-2xl ring-1 ring-black/5 print:shadow-none",
        small ? "text-[0.6875rem]" : "text-[0.8125rem]",
        className
      )}
    >
      <style>{printCss(paper.page)}</style>
      {showBrand ? (
        <header
          className={cn(
            "flex items-start justify-between gap-4 border-b-2 pb-3",
            small ? "mb-2" : "mb-5"
          )}
          style={{ borderColor: "#111" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <TenantMark size={small ? 24 : 40} />
            <div className="min-w-0">
              <div
                className={cn(
                  "leading-tight font-bold",
                  small ? "text-xs" : "text-lg"
                )}
              >
                {tenant.legalName.en}
              </div>
              {!small ? (
                <div className="text-[0.8125rem] leading-tight font-medium">
                  {tenant.legalName.bn}
                </div>
              ) : null}
              <div className="mt-0.5 text-[0.6875rem] text-[#555]">
                {locationRow
                  ? `${locationRow.address[locale]} · ${locationRow.phone}`
                  : `${tenant.registeredAddress[locale]} · ${tenant.helpline}`}
              </div>
              <div lang="en" className="text-[0.6875rem] text-[#555]">
                BIN {tenant.bin}
              </div>
            </div>
          </div>
          {title || docNo || meta ? (
            <div className="shrink-0 text-right">
              {title ? (
                <div
                  className={cn(
                    "font-bold uppercase",
                    small ? "text-[0.625rem]" : "text-sm tracking-wide"
                  )}
                >
                  {title}
                </div>
              ) : null}
              {docNo ? (
                <div lang="en" className="font-mono text-xs">
                  {docNo}
                </div>
              ) : null}
              {meta ? (
                <div className="mt-1 text-[0.6875rem] text-[#555]">{meta}</div>
              ) : null}
            </div>
          ) : null}
        </header>
      ) : null}

      <div className="flex-1">{children}</div>

      {footer || demoFooter ? (
        <footer className="mt-4 flex items-end justify-between gap-4 border-t border-[#e0e0e0] pt-2 text-[0.625rem] text-[#555]">
          <div className="min-w-0">{footer}</div>
          {demoFooter ? (
            <div className="shrink-0 italic">
              {printHeader.demoNote[locale]}
            </div>
          ) : null}
        </footer>
      ) : null}
    </div>
  )
}
