import type { pcEn } from "./en"

/** PC strings, Bangla. Same shape as en.ts. */
export const pcBn: typeof pcEn = {
  pc: {
    name: "পণ্য কনফিগারেশন",
    description: "সেবা, শ্রেণিভিত্তিক মূল্য, রেসিপি, প্যাকেজ ও মূল্য তালিকা",
    pages: {
      home: "ক্যাটালগ",
      service: "সেবা",
      packages: "প্যাকেজ",
      priceLists: "মূল্য তালিকা",
      promotions: "প্রচার অফার",
    },
    perm: {
      app_view: "পণ্য কনফিগারেশন খোলা",
      catalog_edit: "সেবা, রেসিপি, প্যাকেজ ও প্রচার সম্পাদনা",
      pricelist_publish: "মূল্য তালিকা প্রকাশ",
    },
    events: {
      ServiceUpdated: "সেবা {code} হালনাগাদ",
      RecipeUpdated: "{code}-এর রেসিপি হালনাগাদ",
      PriceListPublished: "মূল্য তালিকা {code} প্রকাশিত",
      PromotionSaved: "প্রচার অফার {code} সংরক্ষিত",
    },
  },
}
