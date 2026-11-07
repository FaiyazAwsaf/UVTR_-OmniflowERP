import { locations } from "@/config/brand.config"
import { CHART } from "@/core/ledger/chart"
import { CASH_BANK_ACCOUNTS } from "@/core/seed/generators/accounts"
import type { Locale } from "@/lib/i18n/config"

/**
 * Journal narrations in the window's language. The system writes narrations
 * in English from fixed templates ("Sales invoice INV-…", "Consumables
 * used, SO-…") and keeps them on the voucher as written; a Bangla window
 * shows them through this table, first match wins. Document numbers stay
 * Latin; studio and cash account names read in Bangla; text a person typed
 * (a reason, a petty cash description, a vendor's name) stays as typed. An
 * unknown narration (one a person wrote) is shown as it is.
 */

const PLACE_BN = new Map<string, string>([
  ...locations.map((l): [string, string] => [l.name.en, l.name.bn]),
  ...CASH_BANK_ACCOUNTS.map((a): [string, string] => [a.nameEn, a.nameBn]),
])

/** Recurring and payroll lines that end in ", <period>". */
const PERIODIC_BN: Record<string, string> = {
  "Monthly depreciation": "মাসিক অবচয়",
  "Salary and incentive accrual": "বেতন ও প্রণোদনা বকেয়া",
  "Salaries and incentives paid": "বেতন ও প্রণোদনা পরিশোধ",
  "Prepaid amortisation": "অগ্রিম খরচের অবলোপন",
  "Internet and telephone accrual": "ইন্টারনেট ও টেলিফোন বকেয়া",
  "Rent accrual": "ভাড়া বকেয়া",
}

const TAX_BN: Record<string, string> = {
  VAT: "ভ্যাট",
  AIT: "এআইটি",
  VDS: "ভিডিএস",
}
const MFS_BN: Record<string, string> = {
  Card: "কার্ড",
  bKash: "বিকাশ",
  Nagad: "নগদ",
}

const place = (name: string) => PLACE_BN.get(name.trim()) ?? name

type Rule = [RegExp, (m: RegExpMatchArray) => string]

const RULES: Rule[] = [
  [/^Sales invoice (\S+)$/, (m) => `বিক্রয় চালান ${m[1]}`],
  [/^Receipt (\S+)$/, (m) => `রসিদ ${m[1]}`],
  [/^Cheque cleared, receipt (\S+)$/, (m) => `চেক নগদায়িত, রসিদ ${m[1]}`],
  [/^Consumables used, (\S+)$/, (m) => `ব্যবহৃত উপকরণ, ${m[1]}`],
  [/^Extra consumables, (\S+)$/, (m) => `অতিরিক্ত উপকরণ, ${m[1]}`],
  [
    /^Unused consumables returned, (\S+)$/,
    (m) => `অব্যবহৃত উপকরণ ফেরত, ${m[1]}`,
  ],
  [/^Retail goods out, (\S+)$/, (m) => `খুচরা পণ্য বিক্রয়, ${m[1]}`],
  [/^Counter goods sold, (\S+)$/, (m) => `কাউন্টারে পণ্য বিক্রয়, ${m[1]}`],
  [/^Goods received, (\S+) \((\S+)\)$/, (m) => `মাল গ্রহণ, ${m[1]} (${m[2]})`],
  [/^Goods received, (\S+)$/, (m) => `মাল গ্রহণ, ${m[1]}`],
  [
    /^Goods delivered, (\S+) \((\S+)\)$/,
    (m) => `মাল সরবরাহ, ${m[1]} (${m[2]})`,
  ],
  [/^Transfer dispatched, (\S+)$/, (m) => `স্থানান্তর প্রেরিত, ${m[1]}`],
  [/^Transfer received, (\S+)$/, (m) => `স্থানান্তর গৃহীত, ${m[1]}`],
  [/^Vendor bill (\S+), (.+)$/, (m) => `সরবরাহকারীর বিল ${m[1]}, ${m[2]}`],
  [/^Vendor bill (\S+)$/, (m) => `সরবরাহকারীর বিল ${m[1]}`],
  [
    /^Vendor payment (\S+), (.+)$/,
    (m) => `সরবরাহকারীকে পরিশোধ ${m[1]}, ${m[2]}`,
  ],
  [
    /^(Card|bKash|Nagad) settlement (\S+)$/,
    (m) => `${MFS_BN[m[1]]} নিষ্পত্তি ${m[2]}`,
  ],
  [
    /^Settlement (\S+): (.+) to (.+)$/,
    (m) => `নিষ্পত্তি ${m[1]}: ${place(m[2])} থেকে ${place(m[3])}`,
  ],
  [
    /^Credit note (\S+) against (\S+)$/,
    (m) => `ক্রেডিট নোট ${m[1]}, চালান ${m[2]}-এর বিপরীতে`,
  ],
  [
    /^Customer refund (\S+), (.+?): (.+)$/,
    (m) => `গ্রাহককে ফেরত ${m[1]}, ${m[2]}: ${m[3]}`,
  ],
  [/^Stock count variance (\S+)$/, (m) => `মজুত গণনার পার্থক্য ${m[1]}`],
  [/^Stock adjustment (\S+)(.*)$/, (m) => `মজুত সমন্বয় ${m[1]}${m[2]}`],
  [/^Internal use (\S+)(.*)$/, (m) => `অভ্যন্তরীণ ব্যবহার ${m[1]}${m[2]}`],
  [
    /^Quarantine accepted, (\S+) \((\S+)\)$/,
    (m) => `কোয়ারেন্টিন থেকে গৃহীত, ${m[1]} (${m[2]})`,
  ],
  [
    /^Purchase return (\S+) \((\S+)\): (.+)$/,
    (m) => `ক্রয় ফেরত ${m[1]} (${m[2]}): ${m[3]}`,
  ],
  [
    /^Petty cash topped up to the imprest, (\S+)$/,
    (m) => `খুচরা নগদ ইমপ্রেস্ট পর্যন্ত পূরণ, ${m[1]}`,
  ],
  [
    /^Petty cash top-up (\S+): (.+)$/,
    (m) => `খুচরা নগদ পূরণ ${m[1]}: ${place(m[2])}`,
  ],
  [/^Petty cash (\S+): (.+)$/, (m) => `খুচরা নগদ ${m[1]}: ${m[2]}`],
  [
    /^Contra (\S+): (.+) to (.+)$/,
    (m) => `কন্ট্রা ${m[1]}: ${place(m[2])} থেকে ${place(m[3])}`,
  ],
  [
    /^Till cash deposited to (.+), (\S+)$/,
    (m) => `ক্যাশের নগদ ${place(m[1])}-এ জমা, ${m[2]}`,
  ],
  [
    /^Transfer from (.+) to (.+), (\S+)$/,
    (m) => `স্থানান্তর, ${place(m[1])} থেকে ${place(m[2])}, ${m[3]}`,
  ],
  [
    /^Treasury deposit (\S+): (VAT|AIT|VDS) for (\S+)$/,
    (m) => `ট্রেজারি জমা ${m[1]}: ${TAX_BN[m[2]]}, ${m[3]}`,
  ],
  [
    /^VAT return \(Mushak 9\.1\) settlement for (\S+)$/,
    (m) => `ভ্যাট রিটার্ন (মূসক ৯.১) নিষ্পত্তি, ${m[1]}`,
  ],
  [
    /^Year-end closing, fiscal year (\S+)$/,
    (m) => `বছর শেষের সমাপনী, অর্থবছর ${m[1]}`,
  ],
  [/^Opening balances$/, () => "প্রারম্ভিক জের"],
  [/^Stock shrinkage before cutover$/, () => "কাটওভারের আগের মজুত ঘাটতি"],
  [
    /^Account maintenance and SMS charge \(bank statement\)$/,
    () => "হিসাব রক্ষণাবেক্ষণ ও এসএমএস চার্জ (ব্যাংক বিবরণী)",
  ],
  [/^Bank charge \(bank statement\)$/, () => "ব্যাংক চার্জ (ব্যাংক বিবরণী)"],
  [/^(.+) \(bank statement\)$/, (m) => `${m[1]} (ব্যাংক বিবরণী)`],
  [/^Reversal of (\S+): (.+)$/, (m) => `রিভার্সাল, ${m[1]}: ${m[2]}`],
  [
    /^Summary transfer \(history\), (.+) to (.+)$/,
    (m) => `সারাংশ স্থানান্তর (ইতিহাস), ${place(m[1])} থেকে ${place(m[2])}`,
  ],
  [
    /^Summary purchase \(history\), (.+), bill (\S+)$/,
    (m) => `সারাংশ ক্রয় (ইতিহাস), ${m[1]}, বিল ${m[2]}`,
  ],
  [
    /^Daily sales summary \(history\), (.+)$/,
    (m) => `দৈনিক বিক্রয় সারাংশ (ইতিহাস), ${place(m[1])}`,
  ],
  [
    /^Sales summary for (\d+) days to (\S+) \(history\), (.+)$/,
    (m) =>
      `${m[2]} পর্যন্ত ${m[1]} দিনের বিক্রয় সারাংশ (ইতিহাস), ${place(m[3])}`,
  ],
  [
    /^Salaries and incentives paid, June \(opening\)$/,
    () => "বেতন ও প্রণোদনা পরিশোধ, জুন (প্রারম্ভিক)",
  ],
  [
    /^Term loan instalment, (.+), (\S+)$/,
    (m) => `মেয়াদি ঋণের কিস্তি, ${place(m[1])}, ${m[2]}`,
  ],
  [
    /^Electricity and water accrual, Gulshan and Uttara$/,
    () => "বিদ্যুৎ ও পানির বকেয়া, গুলশান ও উত্তরা",
  ],
  [
    /^Uttara second detailing bay fit-out completed, contractor's bill to follow$/,
    () =>
      "উত্তরার দ্বিতীয় ডিটেইলিং বে-র সজ্জা সম্পন্ন, ঠিকাদারের বিল পরে আসবে",
  ],
  [
    /^Demo setup (\S+): (\S+) (topped up|reduced) by (\S+) at the studio$/,
    (m) =>
      `ডেমো প্রস্তুতি ${m[1]}: স্টুডিওতে ${m[2]} ${m[4]} ${m[3] === "reduced" ? "কমানো হয়েছে" : "বাড়ানো হয়েছে"}`,
  ],
  [
    /^([^,]+), (\S+)$/,
    (m) => (PERIODIC_BN[m[1]] ? `${PERIODIC_BN[m[1]]}, ${m[2]}` : m[0]),
  ],
]

/** The narration as a window in `locale` shows it. */
export function narrationIn(text: string, locale: Locale): string {
  if (locale !== "bn" || !text) return text
  for (const [pattern, render] of RULES) {
    const m = text.match(pattern)
    if (m) return render(m)
  }
  return text
}

const KNOWN_BN = new Map<string, string>([
  ...PLACE_BN,
  ...CHART.map((c): [string, string] => [c.nameEn, c.nameBn]),
])

/** A known name stored in English (an account, a studio, a cash account) in the window's language; anything else as it is. */
export function knownNameIn(text: string, locale: Locale): string {
  return locale === "bn" ? (KNOWN_BN.get(text) ?? text) : text
}
