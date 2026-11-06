import type { AccountTag, AccountType } from "@/core/db/schema"

/**
 * The seeded chart of accounts (accounting_rules.md §2). Groups are not
 * postable; `tag` is the system tag posting rules use (`acct(tx, tag)`);
 * control accounts accept lines only from posting rules (INV-03).
 */
export type ChartEntry = {
  code: string
  nameEn: string
  nameBn: string
  type: AccountType
  parent?: string
  group?: boolean
  tag?: AccountTag
  control?: boolean
  /** Contra accounts carry the opposite normal side (accumulated depreciation, discounts) */
  contra?: boolean
}

const g = (code: string, nameEn: string, nameBn: string, type: AccountType, parent?: string): ChartEntry => ({
  code,
  nameEn,
  nameBn,
  type,
  parent,
  group: true,
})
const a = (
  code: string,
  nameEn: string,
  nameBn: string,
  type: AccountType,
  parent: string,
  tag: AccountTag,
  opts: { control?: boolean; contra?: boolean } = {}
): ChartEntry => ({ code, nameEn, nameBn, type, parent, tag, ...opts })

export const CHART: ChartEntry[] = [
  g("1000", "Assets", "সম্পদ", "asset"),
  g("1100", "Current assets", "চলতি সম্পদ", "asset", "1000"),
  g("1110", "Cash in hand", "হাতে নগদ", "asset", "1100"),
  a("1111", "Cash till, Gulshan Studio", "ক্যাশ, গুলশান স্টুডিও", "asset", "1110", "CASH_TILL_GUL"),
  a("1112", "Cash till, Uttara Studio", "ক্যাশ, উত্তরা স্টুডিও", "asset", "1110", "CASH_TILL_UTT"),
  a("1113", "Petty cash, Head Office", "খুচরা নগদ, প্রধান কার্যালয়", "asset", "1110", "PETTY_HQ"),
  a("1114", "Petty cash, Gulshan Studio", "খুচরা নগদ, গুলশান স্টুডিও", "asset", "1110", "PETTY_GUL"),
  a("1115", "Petty cash, Uttara Studio", "খুচরা নগদ, উত্তরা স্টুডিও", "asset", "1110", "PETTY_UTT"),
  g("1120", "Bank accounts", "ব্যাংক হিসাব", "asset", "1100"),
  a("1121", "BRAC Bank, current account", "ব্র্যাক ব্যাংক, চলতি হিসাব", "asset", "1120", "BANK_MAIN"),
  a("1122", "Dutch-Bangla Bank, collection account", "ডাচ-বাংলা ব্যাংক, কালেকশন হিসাব", "asset", "1120", "BANK_COLLECTION"),
  g("1130", "Mobile financial services", "মোবাইল আর্থিক সেবা", "asset", "1100"),
  a("1131", "bKash merchant wallet", "বিকাশ মার্চেন্ট ওয়ালেট", "asset", "1130", "MFS_BKASH"),
  a("1132", "Nagad merchant wallet", "নগদ মার্চেন্ট ওয়ালেট", "asset", "1130", "MFS_NAGAD"),
  a("1140", "Card settlement clearing", "কার্ড নিষ্পত্তি ক্লিয়ারিং", "asset", "1100", "CARD_CLEARING"),
  a("1150", "Trade receivables", "বাণিজ্যিক প্রাপ্য", "asset", "1100", "AR_CONTROL", { control: true }),
  g("1160", "Inventories", "মজুদ পণ্য", "asset", "1100"),
  a("1161", "Inventory, detailing chemicals", "মজুদ, ডিটেইলিং রাসায়নিক", "asset", "1160", "INV_CHEMICAL", { control: true }),
  a("1162", "Inventory, consumables", "মজুদ, ভোগ্যপণ্য", "asset", "1160", "INV_CONSUMABLE", { control: true }),
  a("1163", "Inventory, retail goods", "মজুদ, খুচরা বিক্রয়ের পণ্য", "asset", "1160", "INV_RETAIL", { control: true }),
  a("1165", "Inventory in transit", "পথে থাকা মজুদ", "asset", "1160", "INV_TRANSIT", { control: true }),
  g("1170", "Advances, deposits and prepayments", "অগ্রিম, জামানত ও অগ্রিম খরচ", "asset", "1100"),
  a("1171", "Advances to suppliers", "সরবরাহকারীকে অগ্রিম", "asset", "1170", "ADV_VENDOR"),
  a("1172", "Security deposits", "জামানত", "asset", "1170", "DEPOSIT_RENT"),
  a("1173", "Prepaid expenses", "অগ্রিম পরিশোধিত খরচ", "asset", "1170", "PREPAID"),
  a("1180", "VAT current account (input VAT and VDS credits)", "মূসক চলতি হিসাব", "asset", "1100", "VAT_CURRENT", { control: true }),
  a("1190", "Advance income tax", "অগ্রিম আয়কর", "asset", "1100", "AIT_PAID"),
  g("1200", "Non-current assets", "স্থায়ী সম্পদ", "asset", "1000"),
  a("1210", "Detailing equipment", "ডিটেইলিং যন্ত্রপাতি", "asset", "1200", "EQUIPMENT"),
  a("1211", "Accumulated depreciation, equipment", "পুঞ্জীভূত অবচয়, যন্ত্রপাতি", "asset", "1200", "ACC_DEP_EQUIPMENT", { contra: true }),
  a("1220", "Furniture and fixtures", "আসবাবপত্র ও ফিক্সচার", "asset", "1200", "FURNITURE"),
  a("1221", "Accumulated depreciation, furniture", "পুঞ্জীভূত অবচয়, আসবাবপত্র", "asset", "1200", "ACC_DEP_FURNITURE", { contra: true }),
  a("1230", "Service vehicle", "সার্ভিস গাড়ি", "asset", "1200", "VEHICLE"),
  a("1231", "Accumulated depreciation, vehicle", "পুঞ্জীভূত অবচয়, গাড়ি", "asset", "1200", "ACC_DEP_VEHICLE", { contra: true }),
  a("1240", "Studio fit-out", "স্টুডিও সজ্জা", "asset", "1200", "FITOUT"),
  a("1241", "Accumulated depreciation, fit-out", "পুঞ্জীভূত অবচয়, সজ্জা", "asset", "1200", "ACC_DEP_FITOUT", { contra: true }),
  g("2000", "Liabilities", "দায়", "liability"),
  g("2100", "Current liabilities", "চলতি দায়", "liability", "2000"),
  a("2110", "Trade payables", "বাণিজ্যিক প্রদেয়", "liability", "2100", "AP_CONTROL", { control: true }),
  a("2120", "Goods received not invoiced", "প্রাপ্ত মালের অপরিশোধিত বিল", "liability", "2100", "GRNI", { control: true }),
  a("2130", "Customer advances", "গ্রাহকের অগ্রিম", "liability", "2100", "CUSTOMER_ADVANCE", { control: true }),
  a("2140", "VAT payable (output VAT)", "প্রদেয় মূসক", "liability", "2100", "VAT_OUTPUT", { control: true }),
  a("2150", "VDS payable", "উৎসে কর্তিত মূসক প্রদেয়", "liability", "2100", "VDS_PAYABLE", { control: true }),
  a("2160", "AIT (TDS) payable", "উৎসে কর্তিত আয়কর প্রদেয়", "liability", "2100", "AIT_PAYABLE", { control: true }),
  a("2170", "Salaries payable", "প্রদেয় বেতন", "liability", "2100", "SALARY_PAYABLE"),
  a("2175", "Accrued expenses", "বকেয়া খরচ", "liability", "2100", "ACCRUED_EXP"),
  g("2200", "Non-current liabilities", "দীর্ঘমেয়াদি দায়", "liability", "2000"),
  a("2210", "Term loan, BRAC Bank", "মেয়াদি ঋণ, ব্র্যাক ব্যাংক", "liability", "2200", "TERM_LOAN"),
  g("3000", "Equity", "মালিকানা স্বত্ব", "equity"),
  a("3100", "Share capital", "শেয়ার মূলধন", "equity", "3000", "SHARE_CAPITAL"),
  a("3200", "Retained earnings", "সংরক্ষিত আয়", "equity", "3000", "RETAINED_EARNINGS"),
  g("4000", "Income", "আয়", "income"),
  g("4100", "Service revenue", "সেবা আয়", "income", "4000"),
  a("4110", "Wash services", "ওয়াশ সেবা", "income", "4100", "REV_WASH"),
  a("4120", "Interior services", "ইন্টেরিয়র সেবা", "income", "4100", "REV_INTERIOR"),
  a("4130", "Paint correction", "পেইন্ট কারেকশন", "income", "4100", "REV_PAINT"),
  a("4140", "Protection and coating", "প্রোটেকশন ও কোটিং", "income", "4100", "REV_PROTECTION"),
  a("4150", "Glass and wheel care", "গ্লাস ও হুইল কেয়ার", "income", "4100", "REV_GLASS_WHEEL"),
  a("4160", "Engine bay and restoration", "ইঞ্জিন বে ও রেস্টোরেশন", "income", "4100", "REV_RESTORATION"),
  a("4200", "Product sales", "পণ্য বিক্রয়", "income", "4000", "REV_PRODUCTS"),
  a("4300", "Discounts allowed", "প্রদত্ত ছাড়", "income", "4000", "DISCOUNTS", { contra: true }),
  g("4900", "Other income", "অন্যান্য আয়", "income", "4000"),
  a("4910", "Miscellaneous income", "বিবিধ আয়", "income", "4900", "OTHER_INCOME"),
  a("4920", "Bank interest", "ব্যাংক সুদ", "income", "4900", "INTEREST_INCOME"),
  g("5000", "Cost of sales", "বিক্রয় ব্যয়", "expense"),
  a("5100", "Consumables used in services", "সেবায় ব্যবহৃত ভোগ্যপণ্য", "expense", "5000", "CONSUMABLES_USED"),
  a("5200", "Cost of goods sold", "বিক্রিত পণ্যের ব্যয়", "expense", "5000", "COGS"),
  a("5300", "Inventory losses and adjustments", "মজুদ ক্ষতি ও সমন্বয়", "expense", "5000", "INV_LOSS"),
  a("5400", "Purchase price variance", "ক্রয়মূল্য পার্থক্য", "expense", "5000", "PPV"),
  g("6000", "Operating expenses", "পরিচালন ব্যয়", "expense"),
  a("6100", "Salaries and wages", "বেতন ও মজুরি", "expense", "6000", "SALARIES"),
  a("6110", "Technician incentives", "টেকনিশিয়ান প্রণোদনা", "expense", "6000", "INCENTIVES"),
  a("6200", "Rent", "ভাড়া", "expense", "6000", "RENT"),
  a("6300", "Electricity, water and gas", "বিদ্যুৎ, পানি ও গ্যাস", "expense", "6000", "UTILITIES"),
  a("6400", "Internet and telephone", "ইন্টারনেট ও টেলিফোন", "expense", "6000", "TELECOM"),
  a("6500", "Repairs and maintenance", "মেরামত ও রক্ষণাবেক্ষণ", "expense", "6000", "REPAIRS"),
  a("6600", "Marketing and promotion", "বিপণন ও প্রচার", "expense", "6000", "MARKETING"),
  a("6700", "Bank charges", "ব্যাংক চার্জ", "expense", "6000", "BANK_CHARGES"),
  a("6710", "Card and MFS merchant fees", "কার্ড ও এমএফএস মার্চেন্ট ফি", "expense", "6000", "MERCHANT_FEES"),
  a("6800", "Depreciation", "অবচয়", "expense", "6000", "DEPRECIATION"),
  a("6900", "Printing, stationery and office", "মুদ্রণ, স্টেশনারি ও অফিস", "expense", "6000", "OFFICE"),
  a("6910", "Security services", "নিরাপত্তা সেবা", "expense", "6000", "SECURITY"),
  a("6920", "Conveyance and transport", "যাতায়াত ও পরিবহন", "expense", "6000", "CONVEYANCE"),
  a("6930", "Professional and audit fees", "পেশাদার ও নিরীক্ষা ফি", "expense", "6000", "PROFESSIONAL"),
  a("6940", "Staff welfare and meals", "কর্মী কল্যাণ ও খাবার", "expense", "6000", "WELFARE"),
  g("7000", "Finance costs", "আর্থিক ব্যয়", "expense"),
  a("7100", "Interest on loan", "ঋণের সুদ", "expense", "7000", "INTEREST_EXPENSE"),
]

/** Fixed account row id for a chart code (acc_1150). */
export const accountIdOf = (code: string) => `acc_${code}`

/** Normal side: assets and expenses debit, the rest credit; contra accounts flip. */
export function normalSideOf(entry: Pick<ChartEntry, "type" | "contra">): "debit" | "credit" {
  const debit = entry.type === "asset" || entry.type === "expense"
  return debit !== !!entry.contra ? "debit" : "credit"
}

/** Default posting map: every tag to its seeded account id (FA settings may remap). */
export function defaultPostingMap(): Record<AccountTag, string> {
  const map = {} as Record<AccountTag, string>
  for (const entry of CHART) if (entry.tag) map[entry.tag] = accountIdOf(entry.code)
  return map
}

/** Tags whose lines must carry a party (INV-04). */
export const PARTY_TAGS: readonly AccountTag[] = ["AR_CONTROL", "AP_CONTROL", "CUSTOMER_ADVANCE", "GRNI"]
/** Tags whose lines must carry an item and a location (INV-04; OB, SM and YC exempt). */
export const INVENTORY_TAGS: readonly AccountTag[] = ["INV_CHEMICAL", "INV_CONSUMABLE", "INV_RETAIL", "INV_TRANSIT"]

/** Revenue tag by service category (accounting_rules.md §2). */
export const REVENUE_TAG_BY_CATEGORY = {
  wash: "REV_WASH",
  interior: "REV_INTERIOR",
  paint: "REV_PAINT",
  protection: "REV_PROTECTION",
  glass: "REV_GLASS_WHEEL",
  wheel: "REV_GLASS_WHEEL",
  engine: "REV_RESTORATION",
  restoration: "REV_RESTORATION",
} as const
