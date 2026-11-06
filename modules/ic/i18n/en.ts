/** IC strings, English. Every key also lives in bn.ts. */
export const icEn = {
  ic: {
    name: "Inventory Control",
    description: "Stock by location, counts, reorder and expiry",
    pages: {
      home: "Stock by location",
      stockCard: "Stock card",
      counts: "Stock counts",
      count: "Stock count",
      reorder: "Reorder",
      expiry: "Expiry watch",
      consumption: "Consumption variance",
    },
    perm: {
      app_view: "Open Inventory Control",
      export: "Export stock reports",
      count_create: "Run stock counts",
      count_approve: "Approve count variances",
    },
    events: {
      StockBelowReorder: "{sku} below reorder level at {location}",
      CountOpened: "Count {no} opened",
      CountPosted: "Count {no} posted",
      ExpiryAlert: "Batch {batch} of {sku} expires on {date}",
    },
  },
}
