"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { latinDigits } from "@/lib/i18n/dmy"
import { formatDecimal } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/** Taka typed as text (Bangla digits and grouping commas accepted) to integer poisha, or null. */
export function parseTaka(text: string): number | null {
  const clean = latinDigits(text).replace(/[,\s৳]/g, "")
  if (!clean) return null
  if (!/^-?\d*(\.\d{0,2})?$/.test(clean)) return null
  const value = Number(clean)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

/**
 * Money entry (ui_guidelines.md §4): right-aligned mono with a ৳ prefix, the
 * value in and out as integer poisha. Typing accepts Latin or Bangla digits;
 * on blur the amount is shown grouped (lakh/crore) in the window's numerals.
 */
/**
 * When focus swaps the shown text (formatted to raw), the browser drops the
 * selection; select the whole value again right after that render so typing
 * (or an automated fill) replaces it instead of appending to it.
 */
function useSelectOnFocusSwap(outer: React.Ref<HTMLInputElement> | undefined) {
  const node = React.useRef<HTMLInputElement | null>(null)
  const pending = React.useRef(false)
  React.useLayoutEffect(() => {
    if (!pending.current) return
    pending.current = false
    if (node.current && document.activeElement === node.current) node.current.select()
  })
  React.useImperativeHandle(outer, () => node.current as HTMLInputElement, [])
  return { ref: node, markSwap: () => (pending.current = true) }
}

export function MoneyInput({
  valueP,
  onChange,
  className,
  ref: outerRef,
  onFocus,
  onBlur,
  ...props
}: {
  valueP: number | null
  onChange: (valueP: number | null) => void
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type">) {
  const { locale, t } = useLocale()
  const format = React.useCallback(
    (p: number | null) => (p === null ? "" : formatDecimal(p / 100, locale, 2)),
    [locale]
  )
  // While focused the raw typed text is kept; otherwise the formatted value shows.
  const [editing, setEditing] = React.useState<string | null>(null)
  const { ref, markSwap } = useSelectOnFocusSwap(outerRef)
  const text = editing ?? format(valueP)
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">৳</span>
      <Input
        ref={ref}
        inputMode="decimal"
        value={text}
        placeholder={t("shared.money.placeholder")}
        onFocus={(e) => {
          markSwap()
          setEditing(valueP === null ? "" : String(valueP / 100))
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setEditing(null)
          onBlur?.(e)
        }}
        onChange={(e) => {
          setEditing(e.target.value)
          onChange(parseTaka(e.target.value))
        }}
        className="pl-7 text-right font-mono tabular-nums"
        {...props}
      />
    </div>
  )
}

/** Quantity entry with its unit shown at the right (ml, g, pc, kit, can...). */
export function QtyInput({
  value,
  onChange,
  unit,
  step = 1,
  className,
  onBlur,
  ...props
}: {
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
  step?: number
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "step">) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const text = editing ?? (value === null ? "" : String(value))
  return (
    <div className={cn("relative", className)}>
      <Input
        inputMode="decimal"
        value={text}
        data-step={step}
        onBlur={(e) => {
          setEditing(null)
          onBlur?.(e)
        }}
        onChange={(e) => {
          setEditing(e.target.value)
          const clean = latinDigits(e.target.value).replace(/[,\s]/g, "")
          const n = Number(clean)
          onChange(clean === "" || !Number.isFinite(n) ? null : n)
        }}
        className={cn("text-right font-mono tabular-nums", unit && "pr-12")}
        {...props}
      />
      {unit ? (
        <span lang="en" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  )
}
