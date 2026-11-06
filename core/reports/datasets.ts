import type { DatasetDef, DatasetField, DatasetFieldType } from "./types"

/**
 * The reporting datasets (plan §3.19.1), registered by the main agent. Each
 * app fills its loader in modules/<app>/datasets.ts (keyed by the code
 * below) returning rows whose keys are these field keys. Field labels are
 * `reports.f.<key>` in core i18n; dataset names `reports.datasets.<code>`.
 */

const f = (
  key: string,
  type: DatasetFieldType,
  opts: Partial<Omit<DatasetField, "key" | "type" | "labelKey">> = {}
): DatasetField => ({
  key,
  type,
  labelKey: `reports.f.${key}`,
  groupable: type === "text" || type === "enum" || type === "date",
  filterable: true,
  ...opts,
})

const d = (code: string, app: string, fields: DatasetField[], dateField?: string): DatasetDef => ({
  code,
  app,
  labelKey: `reports.datasets.${code.replace(".", "_")}`,
  fields,
  dateField,
})

export const DATASETS: DatasetDef[] = [
  d(
    "fa.journalLines",
    "fa",
    [
      f("date", "date"),
      f("period", "text"),
      f("voucherType", "enum", { enumKeys: "reports.enum.voucherType" }),
      f("journalNo", "text", { linkField: "journalHref" }),
      f("accountCode", "text"),
      f("accountName", "text"),
      f("accountType", "enum", { enumKeys: "reports.enum.accountType" }),
      f("party", "text"),
      f("location", "text"),
      f("costCentre", "text"),
      f("debitP", "money"),
      f("creditP", "money"),
      f("sourceApp", "text"),
      f("sourceDocNo", "text", { linkField: "sourceHref" }),
    ],
    "date"
  ),
  d("fa.accountBalances", "fa", [
    f("accountCode", "text"),
    f("accountName", "text"),
    f("accountType", "enum", { enumKeys: "reports.enum.accountType" }),
    f("period", "text"),
    f("openingP", "money"),
    f("debitP", "money"),
    f("creditP", "money"),
    f("closingP", "money"),
  ]),
  d(
    "si.invoiceLines",
    "si",
    [
      f("date", "date"),
      f("invoiceNo", "text", { linkField: "invoiceHref" }),
      f("location", "text"),
      f("party", "text"),
      f("segment", "enum", { enumKeys: "reports.enum.segment" }),
      f("service", "text"),
      f("category", "enum", { enumKeys: "reports.enum.category" }),
      f("vehicleClass", "enum", { enumKeys: "reports.enum.vehicleClass" }),
      f("qty", "number"),
      f("grossP", "money"),
      f("discountP", "money"),
      f("netP", "money"),
      f("vatP", "money"),
      f("advisor", "text"),
    ],
    "date"
  ),
  d(
    "si.invoices",
    "si",
    [
      f("date", "date"),
      f("invoiceNo", "text", { linkField: "invoiceHref" }),
      f("kind", "enum", { enumKeys: "reports.enum.invoiceKind" }),
      f("party", "text"),
      f("location", "text"),
      f("totalP", "money"),
      f("paidP", "money"),
      f("dueP", "money"),
      f("status", "enum", { enumKeys: "reports.enum.status" }),
      f("daysPastDue", "number"),
    ],
    "date"
  ),
  d(
    "stl.orders",
    "stl",
    [
      f("bookedOn", "date"),
      f("orderNo", "text", { linkField: "orderHref" }),
      f("promisedAt", "date"),
      f("deliveredAt", "date"),
      f("location", "text"),
      f("party", "text"),
      f("vehicleClass", "enum", { enumKeys: "reports.enum.vehicleClass" }),
      f("kind", "enum", { enumKeys: "reports.enum.orderKind" }),
      f("status", "enum", { enumKeys: "reports.enum.status" }),
      f("totalP", "money"),
      f("turnaroundHours", "number"),
      f("late", "enum", { enumKeys: "reports.enum.yesNo" }),
      f("advisor", "text"),
    ],
    "bookedOn"
  ),
  d(
    "stl.tasks",
    "stl",
    [
      f("date", "date"),
      f("technician", "text"),
      f("service", "text"),
      f("bay", "text"),
      f("location", "text"),
      f("minutes", "number"),
      f("startedAt", "text"),
      f("finishedAt", "text"),
    ],
    "date"
  ),
  d(
    "stl.consumption",
    "stl",
    [
      f("date", "date"),
      f("orderNo", "text", { linkField: "orderHref" }),
      f("service", "text"),
      f("item", "text"),
      f("location", "text"),
      f("technician", "text"),
      f("standardQty", "number"),
      f("actualQty", "number"),
      f("varianceQty", "number"),
      f("varianceValueP", "money"),
    ],
    "date"
  ),
  d("ar.openItems", "ar", [
    f("party", "text", { linkField: "partyHref" }),
    f("invoiceNo", "text", { linkField: "invoiceHref" }),
    f("location", "text"),
    f("dueDate", "date"),
    f("daysPastDue", "number"),
    f("bucket", "enum", { enumKeys: "reports.enum.bucket" }),
    f("outstandingP", "money"),
  ]),
  d(
    "ar.receipts",
    "ar",
    [
      f("date", "date"),
      f("receiptNo", "text"),
      f("party", "text"),
      f("method", "enum", { enumKeys: "reports.enum.method" }),
      f("amountP", "money"),
      f("vdsP", "money"),
      f("aitP", "money"),
      f("location", "text"),
    ],
    "date"
  ),
  d("ap.openItems", "ap", [
    f("vendor", "text", { linkField: "partyHref" }),
    f("billNo", "text", { linkField: "billHref" }),
    f("dueDate", "date"),
    f("daysPastDue", "number"),
    f("bucket", "enum", { enumKeys: "reports.enum.bucket" }),
    f("outstandingP", "money"),
  ]),
  d(
    "ap.bills",
    "ap",
    [
      f("date", "date"),
      f("billNo", "text", { linkField: "billHref" }),
      f("vendor", "text"),
      f("kind", "enum", { enumKeys: "reports.enum.billKind" }),
      f("netP", "money"),
      f("vatP", "money"),
      f("totalP", "money"),
      f("matchStatus", "enum", { enumKeys: "reports.enum.matchStatus" }),
      f("hasMushak63", "enum", { enumKeys: "reports.enum.yesNo" }),
    ],
    "date"
  ),
  d(
    "ap.payments",
    "ap",
    [
      f("date", "date"),
      f("paymentNo", "text"),
      f("vendor", "text"),
      f("method", "enum", { enumKeys: "reports.enum.method" }),
      f("grossP", "money"),
      f("aitP", "money"),
      f("vdsP", "money"),
      f("netP", "money"),
    ],
    "date"
  ),
  d(
    "cab.bookLines",
    "cab",
    [
      f("account", "text"),
      f("accountKind", "enum", { enumKeys: "reports.enum.cashKind" }),
      f("date", "date"),
      f("reference", "text"),
      f("receivedP", "money"),
      f("paidP", "money"),
      f("runningP", "money"),
    ],
    "date"
  ),
  d("cab.cheques", "cab", [
    f("direction", "enum", { enumKeys: "reports.enum.direction" }),
    f("party", "text"),
    f("chequeNo", "text"),
    f("amountP", "money"),
    f("chequeDate", "date"),
    f("status", "enum", { enumKeys: "reports.enum.status" }),
  ]),
  d(
    "ptl.poLines",
    "ptl",
    [
      f("orderDate", "date"),
      f("poNo", "text", { linkField: "poHref" }),
      f("vendor", "text"),
      f("item", "text"),
      f("ordered", "number"),
      f("received", "number"),
      f("rejected", "number"),
      f("pending", "number"),
      f("valueP", "money"),
      f("status", "enum", { enumKeys: "reports.enum.status" }),
      f("expectedDate", "date"),
    ],
    "orderDate"
  ),
  d(
    "grn.lines",
    "grn",
    [
      f("date", "date"),
      f("grnNo", "text", { linkField: "grnHref" }),
      f("poNo", "text"),
      f("vendor", "text"),
      f("item", "text"),
      f("accepted", "number"),
      f("rejected", "number"),
      f("reason", "enum", { enumKeys: "reports.enum.rejectReason" }),
      f("valueP", "money"),
    ],
    "date"
  ),
  d("ic.stock", "ic", [
    f("item", "text", { linkField: "itemHref" }),
    f("category", "text"),
    f("kind", "enum", { enumKeys: "reports.enum.itemKind" }),
    f("location", "text"),
    f("qty", "number"),
    f("valueP", "money"),
    f("avgCostP", "money"),
    f("minQty", "number"),
    f("status", "enum", { enumKeys: "reports.enum.stockStatus" }),
    f("nearestExpiry", "date"),
  ]),
  d(
    "ic.moves",
    "ic",
    [
      f("date", "date"),
      f("item", "text"),
      f("location", "text"),
      f("type", "enum", { enumKeys: "reports.enum.moveType" }),
      f("qty", "number"),
      f("valueP", "money"),
      f("docNo", "text"),
    ],
    "date"
  ),
  d("st.transfers", "st", [
    f("transferNo", "text", { linkField: "transferHref" }),
    f("from", "text"),
    f("to", "text"),
    f("item", "text"),
    f("sent", "number"),
    f("received", "number"),
    f("shortfall", "number"),
    f("status", "enum", { enumKeys: "reports.enum.status" }),
  ]),
  d(
    "sac.logins",
    "sac",
    [f("date", "date"), f("user", "text"), f("result", "enum", { enumKeys: "reports.enum.loginResult" }), f("method", "text")],
    "date"
  ),
  d(
    "sac.audit",
    "sac",
    [f("date", "date"), f("user", "text"), f("app", "text"), f("action", "text"), f("entity", "text"), f("docNo", "text")],
    "date"
  ),
  d("rbac.access", "rbac", [
    f("user", "text"),
    f("role", "text"),
    f("permission", "text"),
    f("column", "enum", { enumKeys: "reports.enum.column" }),
    f("scope", "enum", { enumKeys: "reports.enum.scope" }),
  ]),
]

export const DATASET_BY_CODE: ReadonlyMap<string, DatasetDef> = new Map(DATASETS.map((ds) => [ds.code, ds]))
