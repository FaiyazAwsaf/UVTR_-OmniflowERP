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
export function MoneyInput({
  valueP,
  onChange,
  className,
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
  const [text, setText] = React.useState(() => format(valueP))
  const [focused, setFocused] = React.useState(false)
  React.useEffect(() => {
    if (!focused) setText(format(valueP))
  }, [valueP, focused, format])
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">৳</span>
      <Input
        inputMode="decimal"
        value={text}
        placeholder={t("shared.money.placeholder")}
        onFocus={() => {
          setFocused(true)
          setText(valueP === null ? "" : String(valueP / 100))
        }}
        onBlur={() => {
          setFocused(false)
          setText(format(valueP))
        }}
        onChange={(e) => {
          setText(e.target.value)
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
  ...props
}: {
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
  step?: number
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "step">) {
  const [text, setText] = React.useState(value === null ? "" : String(value))
  React.useEffect(() => {
    setText((current) => (Number(latinDigits(current)) === value ? current : value === null ? "" : String(value)))
  }, [value])
  return (
    <div className={cn("relative", className)}>
      <Input
        inputMode="decimal"
        value={text}
        data-step={step}
        onChange={(e) => {
          setText(e.target.value)
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
