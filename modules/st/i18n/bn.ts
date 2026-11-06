import type { stEn } from "./en"

/** ST strings, Bangla. Same shape as en.ts. */
export const stBn: typeof stEn = {
  st: {
    name: "মজুদ লেনদেন",
    description: "স্থানান্তর, ইস্যু ও মজুদ সমন্বয়",
    pages: {
      home: "মজুদ লেনদেন",
      transfers: "স্থানান্তর",
      transfer: "স্থানান্তর",
      adjustments: "সমন্বয়",
      issues: "ইস্যু",
    },
    perm: {
      app_view: "মজুদ লেনদেন খোলা",
      transfer_request: "স্থানান্তরের অনুরোধ",
      transfer_dispatch: "স্থানান্তর প্রেরণ",
      transfer_receive: "স্থানান্তর গ্রহণ",
      adjust_create: "মজুদ সমন্বয় ও অভ্যন্তরীণ ব্যবহার রেকর্ড",
      adjust_approve: "মজুদ সমন্বয় অনুমোদন",
    },
    events: {
      TransferRequested: "স্থানান্তর {no}-এর অনুরোধ",
      TransferDispatched: "স্থানান্তর {no} প্রেরিত",
      TransferReceived: "স্থানান্তর {no} গৃহীত",
      StockIssued: "মজুদ ইস্যু: {no}",
      AdjustmentSubmitted: "সমন্বয় {no} জমা",
      AdjustmentPosted: "সমন্বয় {no} পোস্ট",
    },
  },
}
