import type { grnEn } from "./en"

/** GRN strings, Bangla. Same shape as en.ts. */
export const grnBn: typeof grnEn = {
  grn: {
    name: "পণ্য গ্রহণ নোট",
    description: "মান যাচাই ও কোয়ারেন্টাইনসহ ক্রয় আদেশের মাল গ্রহণ",
    pages: {
      home: "অপেক্ষমাণ মাল",
      receive: "মাল গ্রহণ",
      grn: "পণ্য গ্রহণ নোট",
      quarantine: "কোয়ারেন্টাইন",
    },
    perm: {
      app_view: "পণ্য গ্রহণ নোট খোলা",
      receive_create: "মাল গ্রহণ",
      quarantine_decide: "কোয়ারেন্টাইনের লট গ্রহণ বা ফেরত",
    },
    events: {
      GoodsReceived: "জিআরএন {no}: {accepted} গৃহীত",
      LotQuarantined: "{no}-এ লট কোয়ারেন্টাইনে",
      QuarantineAccepted: "কোয়ারেন্টাইনের লট গৃহীত",
      QuarantineReturned: "কোয়ারেন্টাইনের লট ফেরত",
    },
  },
}
