import type { cabEn } from "./en"

/** CAB strings, Bangla. Same shape as en.ts. */
export const cabBn: typeof cabEn = {
  cab: {
    name: "নগদ ও ব্যাংক ব্যবস্থাপনা",
    description: "ক্যাশ, ব্যাংক, ওয়ালেট, চেক ও সমন্বয়",
    pages: {
      home: "নগদ অবস্থান",
      book: "নগদ ও ব্যাংক বই",
      transfers: "স্থানান্তর",
      cheques: "চেক",
      reconciliation: "সমন্বয়",
      pettyCash: "খুচরা নগদ",
      settlements: "নিষ্পত্তি",
    },
    perm: {
      app_view: "নগদ ও ব্যাংক খোলা",
      export: "নগদ ও ব্যাংক বই রপ্তানি",
      transfer_create: "অর্থ স্থানান্তর ও ক্যাশ জমা",
      settlement_create: "কার্ড ও এমএফএস নিষ্পত্তি রেকর্ড",
      cheque_update: "চেক জমা, ক্লিয়ার ও বাউন্স",
      reconcile: "ব্যাংক বিবরণী সমন্বয়",
      pettycash_create: "খুচরা নগদ খরচ ও পূরণ",
      pettycash_approve: "খুচরা নগদ ভাউচার অনুমোদন",
      account_configure: "নগদ ও ব্যাংক হিসাব কনফিগার",
    },
    events: {
      FundsTransferred: "স্থানান্তর {no}, {amount}",
      SettlementRecorded: "নিষ্পত্তি {no}, {amount}",
      ChequeDeposited: "চেক {no} জমা",
      ChequeCleared: "চেক {no} ক্লিয়ার",
      ChequeBounced: "চেক {no} বাউন্স",
      StatementImported: "বিবরণী আমদানি: {account}",
      StatementLineMatched: "বিবরণীর লাইন মিলেছে",
      ReconciliationCompleted: "সমন্বয় সম্পন্ন: {account}",
      PettyCashSpent: "খুচরা নগদ {no}, {amount}",
    },
  },
}
