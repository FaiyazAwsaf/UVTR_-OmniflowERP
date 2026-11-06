import type { frsEn } from "./en"

/** FRS strings, Bangla. Same shape as en.ts. */
export const frsBn: typeof frsEn = {
  frs: {
    name: "আর্থিক প্রতিবেদন",
    description: "আর্থিক বিবরণী, মূসক রেজিস্টার ও কর রিটার্ন",
    pages: {
      home: "প্রতিবেদন হোম",
      trialBalance: "রেওয়ামিল",
      profitLoss: "লাভ-ক্ষতি",
      balanceSheet: "স্থিতিপত্র",
      cashFlow: "নগদ প্রবাহ",
      vat: "মূসক",
      withholding: "উৎসে কর্তিত কর",
    },
    perm: {
      app_view: "আর্থিক প্রতিবেদন খোলা",
      export: "বিবরণী ও রেজিস্টার রপ্তানি",
      vat_submit: "মূসক রিটার্ন দাখিল",
      tax_pay: "মূসক ও উৎসে কর জমা",
    },
    events: {
      VatReturnSubmitted: "{month}-এর মূসক রিটার্ন দাখিল",
      TaxPaid: "কর জমা: {no}, {amount}",
    },
  },
}
