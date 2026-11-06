import type { pmEn } from "./en"

/** PM strings, Bangla. Same shape as en.ts. */
export const pmBn: typeof pmEn = {
  pm: {
    name: "পণ্য মাস্টার",
    description: "আইটেম, একক, ব্যাচ ও পুনঃঅর্ডার নিয়ম",
    pages: {
      home: "আইটেম",
      item: "আইটেম",
      categories: "শ্রেণি",
      uom: "পরিমাপের একক",
    },
    perm: {
      app_view: "পণ্য মাস্টার খোলা",
      item_create: "আইটেম তৈরি",
      item_edit: "আইটেম, শ্রেণি ও একক সম্পাদনা",
      reorder_edit: "পুনঃঅর্ডার নিয়ম নির্ধারণ",
    },
    events: {
      ItemCreated: "আইটেম {sku} তৈরি",
      ItemUpdated: "আইটেম {sku} হালনাগাদ",
      ReorderRuleChanged: "{sku}-এর পুনঃঅর্ডার নিয়ম পরিবর্তিত",
    },
  },
}
