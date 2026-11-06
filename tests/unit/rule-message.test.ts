import { describe, expect, it } from "vitest"

import { ruleMessage } from "@/components/shared/rule-message"
import { dictionaries, interpolate, lookup } from "@/lib/i18n"
import type { Locale } from "@/lib/i18n/config"
import { formatDmy, formatMoney, formatNumber } from "@/lib/i18n/format"

function formatters(locale: Locale) {
  return {
    locale,
    tk: (key: string, params?: Record<string, string | number>) =>
      interpolate(lookup(dictionaries[locale], key), params),
    num: (value: number) => formatNumber(value, locale),
    money: (poisha: number) => formatMoney(poisha, locale),
    dmy: (value: string | number | Date) => formatDmy(value, locale),
  }
}

describe("ruleMessage", () => {
  const en = formatters("en")

  it("reads the engine's shared rules", () => {
    expect(ruleMessage("OUT_OF_SCOPE", {}, en)).toBe(lookup(dictionaries.en, "rules.OUT_OF_SCOPE"))
  })

  it("formats dates as DD-MM-YYYY and locations by name, in the window's language", () => {
    const message = ruleMessage("PERIOD_CLOSED", { period: "2627-04", date: "2026-10-15" }, en)
    expect(message).toContain("15-10-2026")
    const bn = formatters("bn")
    const stock = ruleMessage(
      "STOCK_NEGATIVE",
      { item: "CH-CC2-50", location: "loc_utt", available: 20, needed: 38 },
      bn
    )
    expect(stock).toContain("উত্তরা স্টুডিও")
    expect(stock).toContain("CH-CC2-50")
  })

  it("formats money params (P suffix) with lakh grouping", () => {
    const message = interpolate("{amountP}", { amountP: formatMoney(12_000_000, "en") })
    expect(message).toBe(formatMoney(12_000_000, "en"))
  })

  it("falls back to the code for an unknown rule", () => {
    expect(ruleMessage("NO_SUCH_RULE", {}, en)).toContain("NO_SUCH_RULE")
  })
})
