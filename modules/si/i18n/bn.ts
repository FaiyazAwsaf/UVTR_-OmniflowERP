import type { siEn } from "./en"

/** SI strings, Bangla. Same shape as en.ts. */
export const siBn: typeof siEn = {
  si: {
    name: "বিক্রয় চালান",
    description: "মূসক ৬.৩ চালান, কাউন্টার চেকআউট ও ক্রেডিট নোট",
    pages: {
      home: "চালান",
      counter: "কাউন্টার",
      invoiceNew: "নতুন চালান",
      invoice: "চালান",
      creditNotes: "ক্রেডিট নোট",
    },
    perm: {
      app_view: "বিক্রয় চালান খোলা",
      export: "চালান ও রেজিস্টার রপ্তানি",
      invoice_issue: "কর চালান ইস্যু",
      counter_checkout: "কাউন্টারে চেকআউট",
      creditnote_create: "ক্রেডিট নোট তৈরি",
      creditnote_approve: "ক্রেডিট নোট অনুমোদন",
    },
    events: {
      InvoiceIssued: "চালান {no} ইস্যু, {amount}",
      ConsolidatedInvoiceIssued: "একত্রিত চালান {no} ইস্যু, {amount}",
      CounterPaid: "{no}-এ কাউন্টারে {amount} পরিশোধ",
      PaymentPending: "{no}-এ {method} পেমেন্ট অপেক্ষমাণ",
      PaymentConfirmed: "{no}-এ {method} পেমেন্ট নিশ্চিত",
      PaymentTimedOut: "{no}-এ {method} পেমেন্টের সময় শেষ",
      CreditNoteIssued: "ক্রেডিট নোট {no} ইস্যু, {amount}",
    },
    tender: {
      card: "কার্ড",
    },
    sim: {
      cardTitle: "কার্ড টার্মিনাল",
      cardBody: "স্টুডিওর টার্মিনালে কার্ড ট্যাপ বা প্রবেশ করান।",
      cardLast4: "কার্ডের শেষ ৪ অঙ্ক",
      cardHint: "০০০২ দিয়ে শেষ হওয়া কার্ড প্রত্যাখ্যাত হয় (ডেমোর জন্য)।",
      approveCard: "টার্মিনালে অনুমোদন",
      declined: "কার্ড ইস্যুকারী প্রত্যাখ্যান করেছে। অন্য কার্ড বা মাধ্যম চেষ্টা করুন।",
      pushTitle: "{brand} পেমেন্ট অনুরোধ",
      pushBody: "{brand} ওয়ালেট {phone}-এ পেমেন্ট অনুরোধ পাঠানো হয়েছে। {minutes} ডেমো মিনিট পর মেয়াদ শেষ হবে।",
      waiting: "গ্রাহকের ফোনে অনুমোদনের অপেক্ষায়",
      customerApproved: "গ্রাহক অনুমোদন করেছেন",
    },
  },
}
