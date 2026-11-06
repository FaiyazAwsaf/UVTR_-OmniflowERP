import type { faEn } from "./en"

/** FA strings, Bangla. Same shape as en.ts. */
export const faBn: typeof faEn = {
  fa: {
    name: "মূল হিসাবরক্ষণ",
    description: "হিসাবের তালিকা, ভাউচার, খতিয়ান ও পিরিয়ড বন্ধ",
    pages: {
      home: "হিসাব হোম",
      accounts: "হিসাবের তালিকা",
      journals: "ভাউচার",
      journalNew: "নতুন জার্নাল ভাউচার",
      journal: "ভাউচার",
      ledger: "খতিয়ান",
      periods: "পিরিয়ড",
      recurring: "পুনরাবৃত্ত জার্নাল",
      settings: "সেটিংস",
    },
    perm: {
      app_view: "মূল হিসাবরক্ষণ খোলা",
      export: "হিসাবের তালিকা রপ্তানি",
      account_edit: "হিসাবের তালিকা সম্পাদনা",
      journal_create: "জার্নাল ভাউচার প্রস্তুত",
      journal_approve: "জার্নাল ভাউচার অনুমোদন",
      journal_reverse: "ভাউচার রিভার্স",
      period_close: "পিরিয়ড বন্ধ",
      period_reopen: "পিরিয়ড পুনরায় খোলা",
      recurring_run: "পুনরাবৃত্ত জার্নাল পোস্ট",
      settings_configure: "পোস্টিং ম্যাপ, কস্ট সেন্টার ও কর কনফিগার",
    },
    events: {
      JournalPosted: "ভাউচার {no} পোস্ট",
      JournalSubmitted: "ভাউচার {no} অনুমোদনের জন্য জমা",
      JournalApproved: "ভাউচার {no} অনুমোদিত",
      JournalReversed: "ভাউচার {no} রিভার্স",
      JournalDiscarded: "ভাউচার {no} বাতিল",
      PeriodClosed: "পিরিয়ড {period} বন্ধ",
      PeriodReopened: "পিরিয়ড {period} পুনরায় খোলা",
      RecurringPosted: "{period}-এর পুনরাবৃত্ত জার্নাল পোস্ট",
    },
  },
}
