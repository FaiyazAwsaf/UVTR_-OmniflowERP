import { describe, expect, it } from "vitest"

import * as R from "@/core/ledger/rules"
import type { LineInput } from "@/core/ledger/rules"

const bal = (lines: LineInput[]) => {
  const t = R.totals(lines)
  expect(t.debitP).toBe(t.creditP)
  expect(t.debitP).toBeGreaterThan(0)
  for (const l of lines) expect((l.debitP ?? 0) > 0 && (l.creditP ?? 0) > 0).toBe(false)
  return t
}
const amount = (lines: LineInput[], account: string, side: "debitP" | "creditP") =>
  lines.filter((l) => l.account === account).reduce((s, l) => s + (l[side] ?? 0), 0)

describe("posting rules (accounting_rules.md §3)", () => {
  it("R1a balances opening balances against retained earnings", () => {
    const lines = R.linesForOpeningBalances([
      { account: "BANK_MAIN", balanceP: 1_840_000_00 },
      { account: "TERM_LOAN", balanceP: -2_000_000_00 },
      { account: "AR_CONTROL", balanceP: 785_000_00, partyId: "pty_a" },
    ])
    bal(lines)
    expect(amount(lines, "RETAINED_EARNINGS", "creditP")).toBe(625_000_00)
  })

  it("R1b closes income and expense to retained earnings", () => {
    const lines = R.linesForYearEndClosing([
      { account: "acc_4110", type: "income", balanceP: -500_00 },
      { account: "acc_6200", type: "expense", balanceP: 200_00 },
    ])
    bal(lines)
    expect(amount(lines, "RETAINED_EARNINGS", "creditP")).toBe(300_00)
  })

  it("R2 daily summary: collections + discount = gross + VAT, consumption and COGS at standard", () => {
    const lines = R.linesForDailySummary({
      locationId: "loc_gul",
      collections: [
        { tag: "CASH_TILL_GUL", amountP: 5_000_00 },
        { tag: "MFS_BKASH", amountP: 4_200_00 },
      ],
      discountP: 200_00,
      revenue: [
        { tag: "REV_WASH", grossP: 6_000_00 },
        { tag: "REV_INTERIOR", grossP: 2_000_00 },
      ],
      vatP: 1_400_00,
      consumption: [
        { tag: "INV_CHEMICAL", valueP: 300_00 },
        { tag: "INV_CONSUMABLE", valueP: 100_00 },
      ],
      cogsP: 250_00,
    })
    bal(lines)
    expect(amount(lines, "CONSUMABLES_USED", "debitP")).toBe(400_00)
    expect(lines.every((l) => l.locationId === "loc_gul")).toBe(true)
  })

  it("R6 posts the invoice and applies the advance in the same voucher", () => {
    const lines = R.linesForSalesInvoice({
      partyId: "pty_shahed",
      locationId: "loc_gul",
      lines: [
        { revenueTag: "REV_PROTECTION", grossP: 36_000_00, discountP: 0, vatP: 5_400_00 },
        { revenueTag: "REV_INTERIOR", grossP: 6_500_00, discountP: 325_00, vatP: 926_25 },
      ],
      advanceAppliedP: 10_000_00,
    })
    bal(lines)
    expect(amount(lines, "AR_CONTROL", "debitP")).toBe(48_501_25)
    expect(amount(lines, "AR_CONTROL", "creditP")).toBe(10_000_00)
    expect(amount(lines, "CUSTOMER_ADVANCE", "debitP")).toBe(10_000_00)
    expect(amount(lines, "VAT_OUTPUT", "creditP")).toBe(6_326_25)
    expect(lines.filter((l) => ["AR_CONTROL", "CUSTOMER_ADVANCE"].includes(String(l.account))).every((l) => l.partyId)).toBe(true)
  })

  it("R8 and R10 record customer deductions; the rest of a receipt becomes an advance", () => {
    const lines = R.linesForReceipt({
      partyId: "pty_swift_ride",
      locationId: "loc_hq",
      cashTag: "BANK_MAIN",
      amountP: 80_000_00,
      vdsP: 12_000_00,
      aitP: 4_000_00,
      allocatedP: 92_000_00,
      advanceP: 4_000_00,
    })
    bal(lines)
    expect(amount(lines, "VAT_CURRENT", "debitP")).toBe(12_000_00)
    expect(amount(lines, "CUSTOMER_ADVANCE", "creditP")).toBe(4_000_00)
  })

  it("R11 splits a credit note between the invoice and customer advance, with restock", () => {
    const lines = R.linesForCreditNote({
      partyId: "p",
      locationId: "loc_gul",
      lines: [{ revenueTag: "REV_INTERIOR", grossP: 6_500_00, discountP: 0, vatP: 975_00 }],
      toInvoiceP: 0,
      toAdvanceP: 7_475_00,
      restock: [{ itemId: "itm_x", tag: "INV_RETAIL", valueP: 100_00 }],
    })
    bal(lines)
    expect(amount(lines, "CUSTOMER_ADVANCE", "creditP")).toBe(7_475_00)
    expect(amount(lines, "COGS", "creditP")).toBe(100_00)
  })

  it("R13 sends the price difference to PPV and VAT without a Mushak 6.3 to PPV", () => {
    const withMushak = R.linesForGoodsBill({
      partyId: "pty_gloss_guard",
      locationId: "loc_cst",
      lines: [{ grniP: 117_000_00, ppvP: 7_020_00, vatP: 18_603_00 }],
      hasMushak63: true,
    })
    bal(withMushak)
    expect(amount(withMushak, "PPV", "debitP")).toBe(7_020_00)
    expect(amount(withMushak, "AP_CONTROL", "creditP")).toBe(142_623_00)
    const without = R.linesForGoodsBill({
      partyId: "v",
      locationId: "loc_cst",
      lines: [{ grniP: 1_000_00, ppvP: -10_00, vatP: 150_00 }],
      hasMushak63: false,
    })
    bal(without)
    expect(amount(without, "VAT_CURRENT", "debitP")).toBe(0)
    expect(amount(without, "PPV", "debitP")).toBe(140_00)
  })

  it("R15 pays net of AIT and VDS (E6: ৳69,000 bill, ৳54,000 cash)", () => {
    const lines = R.linesForVendorPayment({
      partyId: "pty_prime_guard",
      cashTag: "BANK_MAIN",
      grossP: 69_000_00,
      aitP: 6_000_00,
      vdsP: 9_000_00,
    })
    bal(lines)
    expect(amount(lines, "BANK_MAIN", "creditP")).toBe(54_000_00)
  })

  it("R16 handles unbilled and billed returns with PPV and the AP/advance split", () => {
    const unbilled = R.linesForPurchaseReturn({
      partyId: "v",
      locationId: "loc_cst",
      billed: false,
      lines: [{ itemId: "i", tag: "INV_CHEMICAL", stockValueP: 980_00, priceValueP: 1_000_00, vatP: 0 }],
    })
    bal(unbilled)
    expect(amount(unbilled, "GRNI", "debitP")).toBe(1_000_00)
    expect(amount(unbilled, "PPV", "creditP")).toBe(20_00)
    const billed = R.linesForPurchaseReturn({
      partyId: "v",
      locationId: "loc_cst",
      billed: true,
      lines: [{ itemId: "i", tag: "INV_CHEMICAL", stockValueP: 1_000_00, priceValueP: 1_050_00, vatP: 157_50 }],
      apOpenP: 1_000_00,
      vatClaimed: true,
    })
    bal(billed)
    expect(amount(billed, "AP_CONTROL", "debitP")).toBe(1_000_00)
    expect(amount(billed, "ADV_VENDOR", "debitP")).toBe(207_50)
  })

  it("R17, R18, R19, R23 move cash with fees", () => {
    bal(R.linesForContra({ fromTag: "CASH_TILL_GUL", toTag: "BANK_COLLECTION", amountP: 50_000_00, feesP: 50_00 }))
    const settle = R.linesForSettlement({ clearingTag: "CARD_CLEARING", bankTag: "BANK_MAIN", grossP: 10_000_00, feesP: 150_00 })
    bal(settle)
    expect(amount(settle, "BANK_MAIN", "debitP")).toBe(9_850_00)
    bal(R.linesForPettyCash({ pettyTag: "PETTY_GUL", expenseTag: "CONVEYANCE", amountP: 350_00, locationId: "loc_gul" }))
    bal(R.linesForBankCharge({ bankTag: "BANK_MAIN", amountP: 575_00 }))
  })

  it("R20 and R21 carry value through transit; a shortfall goes to inventory loss", () => {
    const out = R.linesForTransferDispatch({
      fromLocationId: "loc_cst",
      toLocationId: "loc_utt",
      lines: [{ itemId: "i", tag: "INV_CHEMICAL", valueP: 2_600_00 }],
    })
    bal(out)
    expect(out.find((l) => l.account === "INV_TRANSIT")).toMatchObject({ locationId: "loc_utt", itemId: "i" })
    const back = R.linesForTransferReceipt({
      toLocationId: "loc_utt",
      lines: [{ itemId: "i", tag: "INV_CHEMICAL", receivedValueP: 2_400_00, shortfallValueP: 200_00 }],
    })
    bal(back)
    expect(amount(back, "INV_TRANSIT", "creditP")).toBe(2_600_00)
  })

  it("R22 posts losses, gains and internal use", () => {
    const lines = R.linesForStockAdjustment({
      locationId: "loc_gul",
      lines: [
        { itemId: "a", tag: "INV_CHEMICAL", valueP: -3_400_00 },
        { itemId: "b", tag: "INV_CONSUMABLE", valueP: 800_00 },
      ],
    })
    bal(lines)
    expect(amount(lines, "INV_LOSS", "debitP")).toBe(3_400_00)
    expect(amount(lines, "INV_LOSS", "creditP")).toBe(800_00)
    const use = R.linesForStockAdjustment({
      locationId: "loc_gul",
      lines: [{ itemId: "a", tag: "INV_CHEMICAL", valueP: -100_00 }],
      internalUseTag: "REPAIRS",
    })
    expect(amount(use, "REPAIRS", "debitP")).toBe(100_00)
  })

  it("R26 swaps every line; R27a sets off VAT and carries the excess forward", () => {
    const original = R.linesForBankCharge({ bankTag: "BANK_MAIN", amountP: 575_00 })
    const reversal = R.linesForReversal(original)
    expect(amount(reversal, "BANK_CHARGES", "creditP")).toBe(575_00)
    const vat = R.vatSettlement({ outputVatP: 100_000_00, creditsP: 120_000_00 })
    expect(vat).toMatchObject({ setOffP: 100_000_00, netPayableP: 0, carryForwardP: 20_000_00 })
    bal(vat.lines)
    bal(R.linesForTaxDeposit({ kind: "vds", amountP: 12_000_00, bankTag: "BANK_MAIN" }))
  })

  it("R3, R4, R5, R12, R28 balance", () => {
    bal(R.linesForDeposit({ cashTag: "MFS_BKASH", amountP: 10_000_00, partyId: "p", locationId: "loc_gul" }))
    const consumption = R.linesForJobConsumption({
      locationId: "loc_gul",
      lines: [{ itemId: "i", tag: "INV_CHEMICAL", valueP: 4_940_00 }],
    })
    bal(consumption)
    const ret = R.linesForJobConsumption({
      locationId: "loc_gul",
      lines: [{ itemId: "i", tag: "INV_CHEMICAL", valueP: 100_00 }],
      reverse: true,
    })
    expect(amount(ret, "CONSUMABLES_USED", "creditP")).toBe(100_00)
    bal(R.linesForRetailGoodsOut({ locationId: "loc_gul", lines: [{ itemId: "i", valueP: 180_00 }] }))
    bal(R.linesForGoodsAccepted({ partyId: "v", locationId: "loc_cst", lines: [{ itemId: "i", tag: "INV_CHEMICAL", valueP: 117_000_00 }] }))
    bal(R.linesForRefund({ partyId: "p", cashTag: "CASH_TILL_GUL", amountP: 7_475_00, locationId: "loc_gul" }))
  })

  it("computes monthly straight-line depreciation", () => {
    expect(R.monthlyDepreciationP(3_200_000_00, 20)).toBe(53_333_33)
  })
})
