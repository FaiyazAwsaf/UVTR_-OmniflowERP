import { locations, printHeader, tenant, type LocationCode } from "@/config/brand.config"

/** Mushak forms produced by the demo (accounting_rules.md §4.4). */
export const MUSHAK_FORMS = {
  "6.3": { bn: "কর চালানপত্র", en: "Tax invoice" },
  "6.5": { bn: "পণ্য স্থানান্তর চালানপত্র", en: "Transfer challan between own locations" },
  "6.6": { bn: "উৎসে কর কর্তন সনদপত্র", en: "VAT deduction at source certificate" },
  "6.7": { bn: "ক্রেডিট নোট", en: "Credit note" },
  "6.8": { bn: "ডেবিট নোট", en: "Debit note" },
  "9.1": { bn: "মূসক দাখিলপত্র (সারসংক্ষেপ)", en: "VAT return (summary)" },
} as const

export type MushakForm = keyof typeof MUSHAK_FORMS

/** A bilingual print label: Bangla first, English below (accounting_rules.md §4.4). */
export function BiLabel({ bn, en }: { bn: string; en: string }) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{bn}</span>
      <span className="text-[0.625rem] text-[#555]">{en}</span>
    </span>
  )
}

/**
 * The Mushak form header for printed tax documents: the form number and
 * title (Bangla first, English below), the registered seller with BIN and
 * address from config/brand.config.ts, the document number and date and time
 * (Latin numbers), and the demo note. Use inside `PrintLayout` with
 * `showBrand={false}`.
 */
export function TaxDocHeader({
  form,
  docNo,
  issuedAt,
  location,
}: {
  form: MushakForm
  docNo: string
  /** Formatted date and time, Latin digits (e.g. "07-11-2026 11:42") */
  issuedAt: string
  location?: LocationCode
}) {
  const title = MUSHAK_FORMS[form]
  const loc = location ? locations.find((l) => l.code === location) : undefined
  return (
    <header className="mb-4 border-b-2 border-[#111] pb-3 text-[#111]" data-testid="tax-doc-header">
      <div className="flex items-start justify-between gap-4">
        <div className="text-[0.6875rem]">
          <div>গণপ্রজাতন্ত্রী বাংলাদেশ সরকার, জাতীয় রাজস্ব বোর্ড</div>
          <div className="text-[#555]">Government of the People&apos;s Republic of Bangladesh, National Board of Revenue</div>
        </div>
        <div lang="en" className="shrink-0 rounded border border-[#111] px-2 py-0.5 font-mono text-xs font-bold">
          Mushak {form}
        </div>
      </div>
      <div className="mt-2 text-center">
        <div className="text-base font-bold">{title.bn}</div>
        <div className="text-xs font-semibold uppercase tracking-wide">{title.en}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[0.75rem]">
        <div>
          <div className="font-semibold">
            {tenant.legalName.bn} / {tenant.legalName.en}
          </div>
          <div>{(loc?.address ?? tenant.registeredAddress).bn}</div>
          <div className="text-[#555]">{(loc?.address ?? tenant.registeredAddress).en}</div>
          <div lang="en">BIN {tenant.bin}</div>
        </div>
        <div className="text-right">
          <div lang="en" className="font-mono text-sm font-semibold">
            {docNo}
          </div>
          <div lang="en" className="font-mono">
            {issuedAt}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[0.625rem] text-[#555] italic">
        {printHeader.demoNote.bn} / {printHeader.demoNote.en}
      </div>
    </header>
  )
}
