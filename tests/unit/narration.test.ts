import { describe, expect, it } from "vitest"

import { narrationIn } from "@/core/ledger/narration"

import { built, rows } from "../seed/helpers"

/**
 * Bangla windows show the system's journal narrations in Bangla
 * (core/ledger/narration.ts): every narration the seed writes, and every
 * template the commands use, comes out starting in Bangla (or with its
 * document number), with no English template words left.
 */
const BANGLA_START = /^[ঀ-৿]|^[A-Z]{2,4}(-[A-Z]{2,4})?-\d{4}-\d+/
const ENGLISH_TEMPLATE =
  /\b(Sales|Receipt|Consumables|Goods|Transfer|Vendor|settlement|Settlement|Petty|Treasury|Summary|Daily|Monthly|Salar|Prepaid|Opening|Contra|Credit note|refund|Stock|Reversal|closing|deposited|imprest|Cheque cleared|instalment|accrual|amortisation|depreciation)\b/

/** One example per command narration template (modules/**, core/**). */
const COMMAND_EXAMPLES = [
  "Sales invoice INV-GUL-2627-000470",
  "Receipt MR-GUL-2627-000460",
  "Consumables used, SO-GUL-2627-00420",
  "Extra consumables, SO-GUL-2627-00420",
  "Unused consumables returned, SO-GUL-2627-00420",
  "Counter goods sold, INV-GUL-2627-000471",
  "Retail goods out, INV-GUL-2627-000471",
  "Goods received, GRN-CST-2627-0040 (PO-2627-0041)",
  "Goods delivered, DC-GUL-2627-0012 (SO-GUL-2627-00421)",
  "Transfer dispatched, TRF-2627-0019",
  "Transfer received, TRF-2627-0019",
  "Vendor bill BL-2627-00090, Gloss & Guard Trading (GG/INV/7781)",
  "Vendor payment VP-2627-00070, Prime Guard Security Services",
  "Settlement SET-2627-00220: Card clearing to BRAC Bank, current account",
  "Credit note CRN-GUL-2627-0005 against INV-GUL-2627-000470",
  "Customer refund RF-2627-0004, Shahed Kabir: Booking cancelled",
  "Stock count variance CNT-GUL-2627-0006",
  "Stock adjustment ADJ-UTT-2627-0009: Damaged in handling",
  "Internal use ADJ-GUL-2627-0010",
  "Quarantine accepted, GRN-CST-2627-0040 (CH-CC2-KIT)",
  "Purchase return PR-2627-0003 (GRN-CST-2627-0040): Short expiry",
  "Petty cash PCV-GUL-2627-0021: Tea stall, Tea and snacks for staff",
  "Petty cash top-up CT-2627-00280: Petty cash, Gulshan Studio",
  "Contra CT-2627-00281: Cash till, Gulshan Studio to Dutch-Bangla Bank, collection account",
  "Treasury deposit TXD-2627-0009: VAT for 2026-10",
  "VAT return (Mushak 9.1) settlement for 2026-10",
  "Account maintenance and SMS charge (bank statement)",
  "Bank charge (bank statement)",
  "Reversal of JV-2627-00012: Posted to the wrong account",
  "Year-end closing, fiscal year FY2025-26",
  "Monthly depreciation, 2026-10",
  "Internet and telephone accrual, 2026-10",
  "Electricity and water accrual, Gulshan and Uttara",
  "Uttara second detailing bay fit-out completed, contractor's bill to follow",
  "Demo setup J1: CH-CC2-KIT topped up by 120 at the studio",
]

describe("journal narrations in Bangla", () => {
  it("translates every narration the seed writes", () => {
    const untranslated = new Set<string>()
    for (const j of rows(built("small").bag, "journals")) {
      const bn = narrationIn(j.narration, "bn")
      if (
        !BANGLA_START.test(bn) ||
        ENGLISH_TEMPLATE.test(bn.replace(/:.*$/, ""))
      )
        untranslated.add(j.narration)
    }
    expect([...untranslated]).toEqual([])
  })

  it("translates every command template", () => {
    for (const text of COMMAND_EXAMPLES) {
      const bn = narrationIn(text, "bn")
      expect(bn, text).toMatch(BANGLA_START)
      expect(bn.replace(/:.*$/, ""), text).not.toMatch(ENGLISH_TEMPLATE)
    }
  })

  it("keeps typed text, document numbers and English windows as they are", () => {
    expect(narrationIn("Sales invoice INV-GUL-2627-000470", "en")).toBe(
      "Sales invoice INV-GUL-2627-000470"
    )
    expect(narrationIn("Paid the plumber in cash", "bn")).toBe(
      "Paid the plumber in cash"
    )
    expect(narrationIn("Receipt MR-GUL-2627-000460", "bn")).toBe(
      "রসিদ MR-GUL-2627-000460"
    )
    expect(
      narrationIn("Daily sales summary (history), Uttara Studio", "bn")
    ).toBe("দৈনিক বিক্রয় সারাংশ (ইতিহাস), উত্তরা স্টুডিও")
  })
})
