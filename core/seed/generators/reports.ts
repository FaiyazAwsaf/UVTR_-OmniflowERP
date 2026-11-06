import type { ReportDefinitionRow } from "@/core/db/schema"

import { USR } from "../content/seed-refs"
import { isoAddDays } from "../time"
import type { World } from "../engine/world"

/**
 * The 33 IRT system reports (plan §3.19.2): dataset reports with their
 * columns, grouping, totals and default range, and the FRS statements
 * listed in the catalogue with a link to their screen. Codes IRT-01 to
 * IRT-33 (distinct from the posting rules R1 to R28).
 */

/** Replaced at seeding by today + 90 days (the expiry window). */
const EXPIRY_WINDOW = "expiry-window"

type Def = Pick<ReportDefinitionRow, "code" | "nameEn" | "nameBn" | "suite" | "app" | "columns" | "totals"> &
  Partial<Pick<ReportDefinitionRow, "dataset" | "frsRoute" | "groupBy" | "sort" | "chart" | "dateRange" | "filters" | "descriptionEn" | "descriptionBn">>

const frs = (code: string, nameEn: string, nameBn: string, frsRoute: string, descriptionEn: string, descriptionBn: string): Def => ({
  code, nameEn, nameBn, suite: "fms", app: "frs", frsRoute, columns: [], totals: [], descriptionEn, descriptionBn,
})

export const SYSTEM_REPORTS: Def[] = [
  { code: "IRT-01", nameEn: "General ledger detail", nameBn: "সাধারণ খতিয়ানের বিস্তারিত", suite: "fms", app: "fa", dataset: "fa.journalLines",
    columns: ["date", "journalNo", "voucherType", "accountCode", "accountName", "party", "location", "debitP", "creditP", "sourceDocNo"], totals: ["debitP", "creditP"],
    sort: { field: "date", dir: "asc" }, dateRange: { field: "date", preset: "mtd" } },
  frs("IRT-02", "Trial balance", "রেওয়ামিল", "/frs/trial-balance", "Every account with opening, debits, credits and closing balance.", "প্রতিটি হিসাবের প্রারম্ভিক, ডেবিট, ক্রেডিট ও সমাপনী জের।"),
  frs("IRT-03", "Profit and loss by studio", "স্টুডিও অনুযায়ী লাভ-ক্ষতি", "/frs/profit-loss", "Revenue, gross profit and operating profit by studio.", "স্টুডিও অনুযায়ী আয়, মোট লাভ ও পরিচালন লাভ।"),
  frs("IRT-04", "Balance sheet", "স্থিতিপত্র", "/frs/balance-sheet", "Assets, liabilities and equity at a date.", "একটি তারিখে সম্পদ, দায় ও মালিকানা স্বত্ব।"),
  frs("IRT-05", "Cash flow", "নগদ প্রবাহ", "/frs/cash-flow", "Indirect cash flow with the check against cash and bank.", "নগদ ও ব্যাংকের সাথে মিলিয়ে পরোক্ষ নগদ প্রবাহ।"),
  { code: "IRT-06", nameEn: "Customer aging", nameBn: "গ্রাহক বকেয়ার বয়স", suite: "fms", app: "ar", dataset: "ar.openItems",
    columns: ["party", "invoiceNo", "dueDate", "daysPastDue", "bucket", "outstandingP"], groupBy: ["party", "bucket"], totals: ["outstandingP"], sort: { field: "daysPastDue", dir: "desc" } },
  { code: "IRT-07", nameEn: "Receipts register", nameBn: "প্রাপ্তি রেজিস্টার", suite: "fms", app: "ar", dataset: "ar.receipts",
    columns: ["date", "receiptNo", "party", "method", "amountP", "vdsP", "aitP", "location"], groupBy: ["date", "method"], totals: ["amountP", "vdsP", "aitP"], dateRange: { field: "date", preset: "mtd" } },
  { code: "IRT-08", nameEn: "Vendor aging", nameBn: "সরবরাহকারী বকেয়ার বয়স", suite: "fms", app: "ap", dataset: "ap.openItems",
    columns: ["vendor", "billNo", "dueDate", "daysPastDue", "bucket", "outstandingP"], groupBy: ["vendor", "bucket"], totals: ["outstandingP"], sort: { field: "daysPastDue", dir: "desc" } },
  { code: "IRT-09", nameEn: "Payments register with withholding", nameBn: "উৎসে কর্তনসহ পরিশোধ রেজিস্টার", suite: "fms", app: "ap", dataset: "ap.payments",
    columns: ["date", "paymentNo", "vendor", "method", "grossP", "aitP", "vdsP", "netP"], totals: ["grossP", "aitP", "vdsP", "netP"], dateRange: { field: "date", preset: "mtd" } },
  frs("IRT-10", "Purchase register (Mushak 6.1)", "ক্রয় রেজিস্টার (মূসক ৬.১)", "/frs/vat", "Purchases and input VAT by month.", "মাস অনুযায়ী ক্রয় ও উপকরণ কর।"),
  frs("IRT-11", "Sales register (Mushak 6.2)", "বিক্রয় রেজিস্টার (মূসক ৬.২)", "/frs/vat", "Sales and output VAT by month.", "মাস অনুযায়ী বিক্রয় ও উৎপাদ কর।"),
  { code: "IRT-12", nameEn: "Cash book", nameBn: "নগদ বই", suite: "fms", app: "cab", dataset: "cab.bookLines",
    columns: ["account", "date", "reference", "receivedP", "paidP", "runningP"], filters: [{ field: "accountKind", op: "in", value: ["cash-till", "petty-cash"] }], totals: ["receivedP", "paidP"], dateRange: { field: "date", preset: "mtd" } },
  { code: "IRT-13", nameEn: "Bank book", nameBn: "ব্যাংক বই", suite: "fms", app: "cab", dataset: "cab.bookLines",
    columns: ["account", "date", "reference", "receivedP", "paidP", "runningP"], filters: [{ field: "accountKind", op: "eq", value: "bank" }], totals: ["receivedP", "paidP"], dateRange: { field: "date", preset: "mtd" } },
  { code: "IRT-14", nameEn: "Cheque register", nameBn: "চেক রেজিস্টার", suite: "fms", app: "cab", dataset: "cab.cheques",
    columns: ["direction", "party", "chequeNo", "amountP", "chequeDate", "status"], totals: ["amountP"], sort: { field: "chequeDate", dir: "desc" } },
  frs("IRT-15", "VAT return summary (Mushak 9.1)", "মূসক রিটার্ন সারসংক্ষেপ (মূসক ৯.১)", "/frs/vat", "Output VAT, credits, carry-forward and the net payable by month.", "মাস অনুযায়ী উৎপাদ কর, রেয়াত, জের ও প্রদেয় নিট কর।"),
  { code: "IRT-16", nameEn: "Revenue by service category and studio", nameBn: "সেবার ধরন ও স্টুডিও অনুযায়ী আয়", suite: "sdm", app: "si", dataset: "si.invoiceLines",
    columns: ["category", "location", "qty", "grossP", "discountP", "netP"], groupBy: ["category", "location"], totals: ["qty", "grossP", "discountP", "netP"],
    chart: { kind: "bar", x: "category", y: "netP", series: "location" }, dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-17", nameEn: "Sales by advisor", nameBn: "অ্যাডভাইজার অনুযায়ী বিক্রয়", suite: "sdm", app: "si", dataset: "si.invoiceLines",
    columns: ["advisor", "location", "qty", "netP", "vatP"], groupBy: ["advisor"], totals: ["qty", "netP", "vatP"], dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-18", nameEn: "Top services", nameBn: "শীর্ষ সেবা", suite: "sdm", app: "si", dataset: "si.invoiceLines",
    columns: ["service", "category", "qty", "netP"], groupBy: ["service"], totals: ["qty", "netP"], sort: { field: "netP", dir: "desc" }, dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-19", nameEn: "Job turnaround and late jobs", nameBn: "কাজ সম্পন্নের সময় ও দেরির কাজ", suite: "sdm", app: "stl", dataset: "stl.orders",
    columns: ["bookedOn", "orderNo", "location", "vehicleClass", "status", "turnaroundHours", "late", "advisor"], groupBy: ["location", "late"], totals: ["turnaroundHours"], dateRange: { field: "bookedOn", lastDays: 30 } },
  { code: "IRT-20", nameEn: "Technician productivity", nameBn: "টেকনিশিয়ানের উৎপাদনশীলতা", suite: "sdm", app: "stl", dataset: "stl.tasks",
    columns: ["technician", "location", "service", "minutes"], groupBy: ["technician"], totals: ["minutes"], dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-21", nameEn: "Bay utilisation", nameBn: "বে ব্যবহার", suite: "sdm", app: "stl", dataset: "stl.tasks",
    columns: ["bay", "date", "location", "minutes"], groupBy: ["bay", "date"], totals: ["minutes"], dateRange: { field: "date", lastDays: 7 } },
  { code: "IRT-22", nameEn: "Discounts given", nameBn: "প্রদত্ত ছাড়", suite: "sdm", app: "si", dataset: "si.invoiceLines",
    columns: ["date", "invoiceNo", "advisor", "service", "grossP", "discountP"], filters: [{ field: "discountP", op: "gte", value: 1 }], groupBy: ["advisor"], totals: ["grossP", "discountP"], dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-23", nameEn: "Stock valuation", nameBn: "মজুদের মূল্যায়ন", suite: "scm", app: "ic", dataset: "ic.stock",
    columns: ["location", "category", "item", "qty", "avgCostP", "valueP"], groupBy: ["location", "category"], totals: ["valueP"] },
  { code: "IRT-24", nameEn: "Stock movement", nameBn: "মজুদের গতিবিধি", suite: "scm", app: "ic", dataset: "ic.moves",
    columns: ["date", "item", "location", "type", "qty", "valueP", "docNo"], totals: ["valueP"], dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-25", nameEn: "Reorder report", nameBn: "পুনঃক্রয় প্রতিবেদন", suite: "scm", app: "ic", dataset: "ic.stock",
    columns: ["location", "item", "qty", "minQty", "status"], filters: [{ field: "status", op: "in", value: ["low", "out"] }], groupBy: ["location"], totals: [] },
  { code: "IRT-26", nameEn: "Expiry report", nameBn: "মেয়াদোত্তীর্ণের প্রতিবেদন", suite: "scm", app: "ic", dataset: "ic.stock",
    columns: ["location", "item", "qty", "nearestExpiry"], filters: [{ field: "nearestExpiry", op: "lte", value: EXPIRY_WINDOW }], sort: { field: "nearestExpiry", dir: "asc" }, totals: [] },
  { code: "IRT-27", nameEn: "PO status", nameBn: "ক্রয় আদেশের অবস্থা", suite: "scm", app: "ptl", dataset: "ptl.poLines",
    columns: ["orderDate", "poNo", "vendor", "item", "ordered", "received", "rejected", "pending", "valueP", "status"], groupBy: ["vendor"], totals: ["valueP"], dateRange: { field: "orderDate", lastDays: 60 } },
  { code: "IRT-28", nameEn: "GRN register with rejections", nameBn: "প্রত্যাখ্যানসহ জিআরএন রেজিস্টার", suite: "scm", app: "grn", dataset: "grn.lines",
    columns: ["date", "grnNo", "poNo", "vendor", "item", "accepted", "rejected", "reason", "valueP"], totals: ["valueP"], dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-29", nameEn: "Consumption variance by service", nameBn: "সেবা অনুযায়ী উপকরণ ব্যবহারের পার্থক্য", suite: "scm", app: "stl", dataset: "stl.consumption",
    columns: ["service", "item", "standardQty", "actualQty", "varianceQty", "varianceValueP"], groupBy: ["service"], totals: ["varianceValueP"], dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-30", nameEn: "Transfer register", nameBn: "স্থানান্তর রেজিস্টার", suite: "scm", app: "st", dataset: "st.transfers",
    columns: ["transferNo", "from", "to", "item", "sent", "received", "shortfall", "status"], totals: ["sent", "received", "shortfall"] },
  { code: "IRT-31", nameEn: "Login history", nameBn: "লগইন ইতিহাস", suite: "csc", app: "sac", dataset: "sac.logins",
    columns: ["date", "user", "result", "method"], groupBy: ["user"], totals: [], dateRange: { field: "date", lastDays: 30 } },
  { code: "IRT-32", nameEn: "User access review", nameBn: "ব্যবহারকারীর প্রবেশাধিকার পর্যালোচনা", suite: "csc", app: "rbac", dataset: "rbac.access",
    columns: ["user", "role", "permission", "column", "scope"], groupBy: ["user"], totals: [] },
  { code: "IRT-33", nameEn: "Audit trail export", nameBn: "অডিট ট্রেইল রপ্তানি", suite: "csc", app: "sac", dataset: "sac.audit",
    columns: ["date", "user", "app", "action", "entity", "docNo"], totals: [], dateRange: { field: "date", lastDays: 7 } },
]

export function seedReports(w: World): void {
  const at = w.at(w.cal.F, "08:00")
  for (const d of SYSTEM_REPORTS) {
    w.ctx.bag.put("reportDefinitions", `rpt_${d.code.toLowerCase().replace("-", "_")}`, at, {
      code: d.code,
      nameEn: d.nameEn,
      nameBn: d.nameBn,
      suite: d.suite,
      app: d.app,
      dataset: d.dataset,
      frsRoute: d.frsRoute,
      columns: d.columns,
      filters: (d.filters ?? []).map((f) => (f.value === EXPIRY_WINDOW ? { ...f, value: isoAddDays(w.cal.today, 90) } : f)),
      dateRange: d.dateRange,
      groupBy: d.groupBy,
      sort: d.sort,
      totals: d.totals,
      chart: d.chart,
      isSystem: true,
      ownerId: USR.rashed,
      shared: true,
      descriptionEn: d.descriptionEn,
      descriptionBn: d.descriptionBn,
    }, USR.rashed)
  }
}
