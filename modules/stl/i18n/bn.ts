import type { stlEn } from "./en"

/** STL strings, Bangla. Same shape as en.ts. */
export const stlBn: typeof stlEn = {
  stl: {
    name: "বিক্রয় লেনদেন চক্র",
    description: "কোটেশন, বুকিং, জব বোর্ড ও মান যাচাই",
    pages: {
      home: "স্টুডিও হোম",
      board: "জব বোর্ড",
      quotations: "কোটেশন",
      quotationNew: "নতুন কোটেশন",
      quotation: "কোটেশন",
      orders: "অর্ডার",
      orderNew: "নতুন বুকিং",
      order: "অর্ডার",
      myJobs: "আমার কাজ",
    },
    perm: {
      app_view: "বিক্রয় লেনদেন চক্র খোলা",
      export: "বিক্রয় তালিকা রপ্তানি",
      quote_create: "কোটেশন প্রস্তুত ও পাঠানো",
      order_create: "অর্ডার বুকিং ও অগ্রিম গ্রহণ",
      order_edit: "অর্ডার সময়সূচি ও হালনাগাদ",
      order_cancel: "অর্ডার বাতিল",
      discount_approve: "ছাড় অনুমোদন",
      job_work: "কাজ শুরু ও শেষ, উপকরণ ব্যবহার রেকর্ড",
      qc_check: "মান যাচাই",
    },
    events: {
      QuotationSaved: "কোটেশন {no} সংরক্ষিত",
      QuotationSent: "কোটেশন {no} পাঠানো হয়েছে",
      QuotationAccepted: "কোটেশন {no} গৃহীত",
      OrderBooked: "অর্ডার {no} বুক হয়েছে",
      DepositReceived: "{no}-এ {amount} অগ্রিম গ্রহণ",
      JobScheduled: "অর্ডার {no} বে {bay}-তে নির্ধারিত",
      TaskStarted: "{no}-এ কাজ শুরু",
      TaskFinished: "{no}-এ কাজ শেষ",
      ConsumablesIssued: "{no}-এ উপকরণ ইস্যু",
      QcPassed: "{no}-এ মান যাচাই উত্তীর্ণ",
      QcFailed: "{no}-এ মান যাচাই অনুত্তীর্ণ",
      OrderReady: "অর্ডার {no} প্রস্তুত",
      OrderCancelled: "অর্ডার {no} বাতিল",
      DiscountApproved: "{pct}% ছাড় অনুমোদিত",
    },
  },
}
