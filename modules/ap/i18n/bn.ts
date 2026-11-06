import type { apEn } from "./en"

/** AP strings, Bangla. Same shape as en.ts. */
export const apBn: typeof apEn = {
  ap: {
    name: "প্রদেয় হিসাব",
    description: "সরবরাহকারীর বিল, ত্রিমুখী মিলান, পেমেন্ট ও উৎসে কর্তন",
    pages: {
      home: "প্রদেয় হোম",
      bills: "বিল",
      billNew: "নতুন বিল",
      bill: "বিল",
      payments: "পেমেন্ট",
      paymentNew: "নতুন পেমেন্ট",
      payment: "পেমেন্ট",
      aging: "বয়স বিশ্লেষণ",
      debitNotes: "ডেবিট নোট",
    },
    perm: {
      app_view: "প্রদেয় হিসাব খোলা",
      export: "প্রদেয় তালিকা রপ্তানি",
      bill_create: "সরবরাহকারীর বিল রেকর্ড",
      bill_approve: "আটকে থাকা বিল ছাড়",
      payment_create: "সরবরাহকারী পেমেন্ট প্রস্তুত",
      payment_approve: "সরবরাহকারী পেমেন্ট অনুমোদন",
    },
    events: {
      BillRecorded: "বিল {no} রেকর্ড, {amount}",
      BillOnHold: "বিল {no} আটকে: মিলান ব্যর্থ",
      BillReleased: "বিল {no} ছাড়া হয়েছে",
      PaymentSubmitted: "পেমেন্ট {no} অনুমোদনের জন্য জমা",
      VendorPaid: "সরবরাহকারীকে পরিশোধ: {no}, {amount}",
    },
  },
}
