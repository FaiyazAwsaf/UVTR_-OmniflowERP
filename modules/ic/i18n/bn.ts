import type { icEn } from "./en"

/** IC strings, Bangla. Same shape as en.ts. */
export const icBn: typeof icEn = {
  ic: {
    name: "মজুদ নিয়ন্ত্রণ",
    description: "অবস্থানভিত্তিক মজুদ, গণনা, পুনঃঅর্ডার ও মেয়াদ",
    pages: {
      home: "অবস্থানভিত্তিক মজুদ",
      stockCard: "স্টক কার্ড",
      counts: "মজুদ গণনা",
      count: "মজুদ গণনা",
      reorder: "পুনঃঅর্ডার",
      expiry: "মেয়াদ পর্যবেক্ষণ",
      consumption: "ব্যবহারের পার্থক্য",
    },
    perm: {
      app_view: "মজুদ নিয়ন্ত্রণ খোলা",
      export: "মজুদ রিপোর্ট রপ্তানি",
      count_create: "মজুদ গণনা",
      count_approve: "গণনার পার্থক্য অনুমোদন",
    },
    events: {
      StockBelowReorder: "{location}-এ {sku} পুনঃঅর্ডার সীমার নিচে",
      CountOpened: "গণনা {no} শুরু",
      CountPosted: "গণনা {no} পোস্ট",
      ExpiryAlert: "{sku}-এর ব্যাচ {batch}-এর মেয়াদ শেষ {date}",
    },
  },
}
