import type { arEn } from "./en"

/** AR strings, Bangla. Same shape as en.ts. */
export const arBn: typeof arEn = {
  ar: {
    name: "প্রাপ্য হিসাব",
    description: "রসিদ, অগ্রিম, ক্রেডিট নিয়ন্ত্রণ ও বয়স বিশ্লেষণ",
    pages: {
      home: "প্রাপ্য হোম",
      receipts: "রসিদ",
      receiptNew: "নতুন রসিদ",
      refunds: "ফেরত",
      aging: "বয়স বিশ্লেষণ",
      creditControl: "ক্রেডিট নিয়ন্ত্রণ",
      statement: "গ্রাহক বিবরণী",
    },
    perm: {
      app_view: "প্রাপ্য হিসাব খোলা",
      export: "প্রাপ্য ও বিবরণী রপ্তানি",
      receipt_create: "গ্রাহক রসিদ রেকর্ড",
      refund_create: "গ্রাহককে টাকা ফেরত",
      credit_override: "ক্রেডিট হোল্ড ও সীমা অতিক্রমের অনুমোদন",
      reminder_send: "পেমেন্ট রিমাইন্ডার পাঠানো",
    },
    events: {
      ReceiptRecorded: "রসিদ {no} রেকর্ড, {amount}",
      AdvanceApplied: "{no}-এ {amount} অগ্রিম সমন্বয়",
      RefundPaid: "ফেরত {no} পরিশোধ, {amount}",
      CreditHoldSet: "{party} ক্রেডিট হোল্ডে",
      CreditHoldReleased: "{party} ক্রেডিট হোল্ড থেকে মুক্ত",
      CreditOverrideApproved: "{party}-এর জন্য ক্রেডিট অনুমোদন",
      ReminderSent: "{party}-কে পেমেন্ট রিমাইন্ডার পাঠানো হয়েছে",
    },
  },
}
