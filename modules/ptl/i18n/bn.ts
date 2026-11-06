import type { ptlEn } from "./en"

/** PTL strings, Bangla. Same shape as en.ts. */
export const ptlBn: typeof ptlEn = {
  ptl: {
    name: "ক্রয় লেনদেন (স্থানীয়)",
    description: "রিকুইজিশন, ক্রয় আদেশ ও ফেরত",
    pages: {
      home: "ক্রয় হোম",
      requisitions: "রিকুইজিশন",
      requisition: "রিকুইজিশন",
      pos: "ক্রয় আদেশ",
      po: "ক্রয় আদেশ",
      returns: "ক্রয় ফেরত",
    },
    perm: {
      app_view: "ক্রয় লেনদেন খোলা",
      export: "ক্রয় তালিকা রপ্তানি",
      pr_create: "ক্রয় রিকুইজিশন তৈরি",
      pr_approve: "রিকুইজিশন অনুমোদন",
      po_create: "ক্রয় আদেশ ইস্যু",
      po_approve: "ক্রয় আদেশ অনুমোদন",
      po_cancel: "ক্রয় আদেশ বাতিল",
      return_create: "সরবরাহকারীকে মাল ফেরত",
    },
    events: {
      RequisitionSubmitted: "রিকুইজিশন {no} জমা",
      RequisitionApproved: "রিকুইজিশন {no} অনুমোদিত",
      RequisitionRejected: "রিকুইজিশন {no} প্রত্যাখ্যাত",
      PurchaseOrderIssued: "ক্রয় আদেশ {no} ইস্যু, {amount}",
      PurchaseOrderApproved: "ক্রয় আদেশ {no} অনুমোদিত",
      PurchaseOrderCancelled: "ক্রয় আদেশ {no} বাতিল",
      PurchaseReturned: "মাল ফেরত: {no}",
      DebitNoteIssued: "ডেবিট নোট {no} ইস্যু",
    },
  },
}
