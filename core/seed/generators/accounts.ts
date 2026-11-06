import type { AccountTag, CashBankKind } from "@/core/db/schema"
import { accountIdOf, CHART, defaultPostingMap, normalSideOf } from "@/core/ledger/chart"

import type { SeedCtx } from "../context"

/**
 * Chart of accounts, the posting map and the cash and bank accounts
 * (accounting_rules.md §2, plan §5.6). Main-agent foundation.
 */
export function seedChartOfAccounts(ctx: SeedCtx): void {
  for (const entry of CHART) {
    ctx.bag.put("accounts", accountIdOf(entry.code), ctx.now, {
      code: entry.code,
      nameEn: entry.nameEn,
      nameBn: entry.nameBn,
      type: entry.type,
      parentId: entry.parent ? accountIdOf(entry.parent) : undefined,
      isGroup: !!entry.group,
      normalSide: normalSideOf(entry),
      tag: entry.tag,
      isControl: !!entry.control,
      active: true,
    })
  }
  ctx.bag.put("settings", "postingAccounts", ctx.now, { value: defaultPostingMap() })
}

type CashBankSeed = {
  id: string
  code: string
  nameEn: string
  nameBn: string
  kind: CashBankKind
  tag: AccountTag
  locationId?: string
  bankName?: string
  branchName?: string
  accountNoMasked?: string
  floatP?: number
  imprestP?: number
}

const T = (taka: number) => taka * 100

/** Cash tills, petty cash, banks, MFS wallets and card clearing (seed_data.md §6). */
export const CASH_BANK_ACCOUNTS: CashBankSeed[] = [
  { id: "cba_till_gul", code: "TILL-GUL", nameEn: "Cash till, Gulshan Studio", nameBn: "ক্যাশ, গুলশান স্টুডিও", kind: "cash-till", tag: "CASH_TILL_GUL", locationId: "loc_gul", floatP: T(20_000) },
  { id: "cba_till_utt", code: "TILL-UTT", nameEn: "Cash till, Uttara Studio", nameBn: "ক্যাশ, উত্তরা স্টুডিও", kind: "cash-till", tag: "CASH_TILL_UTT", locationId: "loc_utt", floatP: T(15_000) },
  { id: "cba_petty_hq", code: "PETTY-HQ", nameEn: "Petty cash, Head Office", nameBn: "খুচরা নগদ, প্রধান কার্যালয়", kind: "petty-cash", tag: "PETTY_HQ", locationId: "loc_hq", imprestP: T(15_000) },
  { id: "cba_petty_gul", code: "PETTY-GUL", nameEn: "Petty cash, Gulshan Studio", nameBn: "খুচরা নগদ, গুলশান স্টুডিও", kind: "petty-cash", tag: "PETTY_GUL", locationId: "loc_gul", imprestP: T(10_000) },
  { id: "cba_petty_utt", code: "PETTY-UTT", nameEn: "Petty cash, Uttara Studio", nameBn: "খুচরা নগদ, উত্তরা স্টুডিও", kind: "petty-cash", tag: "PETTY_UTT", locationId: "loc_utt", imprestP: T(10_000) },
  { id: "cba_brac", code: "BANK-BRAC", nameEn: "BRAC Bank, current account", nameBn: "ব্র্যাক ব্যাংক, চলতি হিসাব", kind: "bank", tag: "BANK_MAIN", bankName: "BRAC Bank", branchName: "Gulshan", accountNoMasked: "****4471" },
  { id: "cba_dbbl", code: "BANK-DBBL", nameEn: "Dutch-Bangla Bank, collection account", nameBn: "ডাচ-বাংলা ব্যাংক, কালেকশন হিসাব", kind: "bank", tag: "BANK_COLLECTION", bankName: "Dutch-Bangla Bank", branchName: "Gulshan", accountNoMasked: "****9023" },
  { id: "cba_bkash", code: "MFS-BKASH", nameEn: "bKash merchant wallet", nameBn: "বিকাশ মার্চেন্ট ওয়ালেট", kind: "mfs", tag: "MFS_BKASH" },
  { id: "cba_nagad", code: "MFS-NAGAD", nameEn: "Nagad merchant wallet", nameBn: "নগদ মার্চেন্ট ওয়ালেট", kind: "mfs", tag: "MFS_NAGAD" },
  { id: "cba_card", code: "CARD-CLR", nameEn: "Card settlement clearing", nameBn: "কার্ড নিষ্পত্তি ক্লিয়ারিং", kind: "card-clearing", tag: "CARD_CLEARING" },
]

export function seedCashBankAccounts(ctx: SeedCtx): void {
  for (const a of CASH_BANK_ACCOUNTS) {
    ctx.bag.put("cashBankAccounts", a.id, ctx.now, {
      code: a.code,
      nameEn: a.nameEn,
      nameBn: a.nameBn,
      kind: a.kind,
      accountTag: a.tag,
      locationId: a.locationId,
      bankName: a.bankName,
      branchName: a.branchName,
      accountNoMasked: a.accountNoMasked,
      floatP: a.floatP,
      imprestP: a.imprestP,
      active: true,
    })
  }
}
