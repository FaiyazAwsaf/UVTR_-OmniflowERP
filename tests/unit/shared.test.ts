import { describe, expect, it } from "vitest"

import { amountInWords, numberToWords } from "@/components/shared/amount-in-words"
import { parseTaka } from "@/components/shared/money-input"
import { searchKey } from "@/components/shared/pickers"
import { DATASETS } from "@/core/reports/datasets"
import { toCsv } from "@/core/reports/csv"
import { shapeReport } from "@/core/reports/runner"
import { dictionaries, lookup } from "@/lib/i18n"

describe("amount in words (lakh and crore)", () => {
  it("writes English with Taka and Poisha", () => {
    expect(amountInWords(12_345_650, "en")).toBe(
      "Taka One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Poisha only"
    )
    expect(amountInWords(5_400_000_00, "en")).toBe("Taka Fifty Four Lakh only")
    expect(numberToWords(12_00_00_000, "en")).toBe("Twelve Crore")
  })

  it("writes Bangla with every number word from 1 to 99", () => {
    expect(amountInWords(12_345_650, "bn")).toBe("এক লক্ষ তেইশ হাজার চারশত ছাপ্পান্ন টাকা পঞ্চাশ পয়সা মাত্র")
    expect(numberToWords(99, "bn")).toBe("নিরানব্বই")
    expect(numberToWords(47, "bn")).toBe("সাতচল্লিশ")
    for (let n = 1; n < 100; n += 1) expect(numberToWords(n, "bn")).not.toBe("")
  })
})

describe("inputs and search", () => {
  it("parses taka typed with Bangla digits and grouping into poisha", () => {
    expect(parseTaka("১,২৩,৪৫৬.৫০")).toBe(12_345_650)
    expect(parseTaka("৳ 575")).toBe(575_00)
    expect(parseTaka("abc")).toBeNull()
    expect(parseTaka("")).toBeNull()
  })

  it("matches a registration typed in Bangla digits, with or without dashes", () => {
    expect(searchKey("DHAKA METRO-GHA 15-7731")).toContain("157731")
    expect(searchKey("১৫-৭৭৩১")).toBe("157731")
  })
})

describe("reporting core (plan §3.19)", () => {
  it("registers the 22 datasets with labelled fields in both languages", () => {
    expect(DATASETS).toHaveLength(22)
    for (const ds of DATASETS) {
      expect(lookup(dictionaries.en, ds.labelKey)).not.toBe(ds.labelKey)
      expect(lookup(dictionaries.bn, ds.labelKey)).not.toBe(ds.labelKey)
      for (const f of ds.fields) expect(lookup(dictionaries.bn, f.labelKey)).not.toBe(f.labelKey)
    }
  })

  it("filters, groups and totals rows", () => {
    const ds = DATASETS.find((d) => d.code === "si.invoiceLines")!
    const rows = [
      { category: "wash", location: "GUL", netP: 1_000_00, date: "2026-11-01" },
      { category: "wash", location: "UTT", netP: 500_00, date: "2026-11-02" },
      { category: "protection", location: "GUL", netP: 36_000_00, date: "2026-11-03" },
    ]
    const result = shapeReport(ds, rows, {
      dataset: ds.code,
      columns: ["category", "location", "netP"],
      filters: [{ field: "date", op: "gte", value: "2026-11-02" }],
      groupBy: ["category"],
      totals: ["netP"],
    })
    expect(result.rowCount).toBe(2)
    expect(result.totals.netP).toBe(36_500_00)
    expect(result.groups?.map((g) => [g.key.category, g.totals.netP])).toEqual([
      ["wash", 500_00],
      ["protection", 36_000_00],
    ])
  })

  it("writes CSV with taka amounts and quoted text", () => {
    const csv = toCsv([{ party: 'Swift "Ride"', amountP: 312_000_00 }], [
      { key: "party", label: "Party" },
      { key: "amountP", label: "Amount" },
    ])
    expect(csv).toContain('"Swift ""Ride""",312000.00')
  })
})
