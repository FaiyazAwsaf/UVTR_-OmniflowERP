import { describe, expect, it } from "vitest"

import { defaultTaxSettings } from "@/config/rules.config"
import { percentOf, priceLine, spreadAmount, spreadDiscount, vatForLines } from "@/core/tax/vat"
import { customerDeductions, withholdingFor } from "@/core/tax/withholding"

const tax = defaultTaxSettings

describe("VAT (accounting_rules.md §4.1)", () => {
  it("rounds per line half up to the poisha", () => {
    expect(percentOf(1_00, 7.5)).toBe(8)
    expect(percentOf(3, 15)).toBe(0) // 0.45 → 0
    expect(percentOf(10, 15)).toBe(2) // 1.5 → 2
    const lines = vatForLines(
      [
        { netP: 6_175_00, vatCategory: "standard" as const },
        { netP: 3_333, vatCategory: "standard" as const },
        { netP: 5_000_00, vatCategory: "exempt" as const },
      ],
      tax
    )
    expect(lines.map((l) => l.vatP)).toEqual([926_25, 500, 0])
    expect(lines[0].vatRatePct).toBe(15)
  })

  it("prices a line: gross, discount, net, VAT, total", () => {
    expect(priceLine({ qty: 1, unitPriceP: 36_000_00, discountP: 0, vatRatePct: 15 })).toEqual({
      grossP: 36_000_00,
      discountP: 0,
      netP: 36_000_00,
      vatP: 5_400_00,
      totalP: 41_400_00,
    })
  })

  it("spreads a discount and a package price exactly (the last part takes the remainder)", () => {
    const parts = spreadDiscount([1_800_00, 3_500_00, 17_000_00, 7_000_00], 10)
    expect(parts.reduce((s, p) => s + p, 0)).toBe(2_930_00)
    const spread = spreadAmount([3_500_00, 36_000_00, 3_500_00, 2_200_00], 40_000_00)
    expect(spread.reduce((s, p) => s + p, 0)).toBe(40_000_00)
  })
})

describe("withholding (accounting_rules.md §4.2)", () => {
  it("E6: security services pay AIT 10% and VDS 100% of VAT", () => {
    const w = withholdingFor(
      "services",
      [{ allocatedP: 69_000_00, billNetP: 60_000_00, billVatP: 9_000_00, billTotalP: 69_000_00 }],
      tax
    )
    expect(w).toEqual({ aitP: 6_000_00, vdsP: 9_000_00, netPaidP: 54_000_00 })
  })

  it("goods vendors: AIT 3% on the VAT-exclusive value, no VDS", () => {
    const w = withholdingFor(
      "goods",
      [{ allocatedP: 115_000_00, billNetP: 100_000_00, billVatP: 15_000_00, billTotalP: 115_000_00 }],
      tax
    )
    expect(w).toEqual({ aitP: 3_000_00, vdsP: 0, netPaidP: 112_000_00 })
  })

  it("part payments withhold pro rata; utilities withhold nothing", () => {
    const w = withholdingFor(
      "rent",
      [{ allocatedP: 57_500_00, billNetP: 100_000_00, billVatP: 15_000_00, billTotalP: 115_000_00 }],
      tax
    )
    expect(w.vdsP).toBe(7_500_00)
    expect(w.aitP).toBe(2_500_00)
    expect(withholdingFor("utility", [{ allocatedP: 9_500_00, billNetP: 9_500_00, billVatP: 0, billTotalP: 9_500_00 }], tax).netPaidP).toBe(9_500_00)
  })
})

describe("customer deductions (accounting_rules.md §4.3)", () => {
  it("VDS is the VAT on the allocated value; AIT 5% of the VAT-exclusive value", () => {
    const d = customerDeductions(
      { deductsVds: true, deductsAit: true },
      [{ allocatedP: 92_000_00, invoiceVatP: 12_000_00, invoiceTotalP: 92_000_00 }],
      tax
    )
    expect(d).toEqual({ vdsP: 12_000_00, aitP: 4_000_00 })
    expect(customerDeductions({ deductsVds: false, deductsAit: false }, [{ allocatedP: 100, invoiceVatP: 13, invoiceTotalP: 100 }], tax)).toEqual({
      vdsP: 0,
      aitP: 0,
    })
  })
})
