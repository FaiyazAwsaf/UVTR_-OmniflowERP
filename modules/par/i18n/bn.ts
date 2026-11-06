import type { parEn } from "./en"

/** PAR strings, Bangla. Same shape as en.ts. */
export const parBn: typeof parEn = {
  par: {
    name: "পার্টি ব্যবস্থাপনা",
    description: "গ্রাহক, সরবরাহকারী ও তাদের গাড়ি",
    pages: {
      home: "পার্টি",
      partyNew: "নতুন পার্টি",
      party: "পার্টি ৩৬০",
      vehicles: "গাড়ি",
    },
    perm: {
      app_view: "পার্টি ব্যবস্থাপনা খোলা",
      export: "পার্টি রপ্তানি",
      customer_create: "গ্রাহক ও গাড়ি তৈরি",
      customer_edit: "গ্রাহক ও গাড়ি সম্পাদনা",
      vendor_create: "সরবরাহকারী তৈরি",
      vendor_edit: "সরবরাহকারী সম্পাদনা",
      credit_edit: "ক্রেডিট সীমা, শর্ত ও কর নির্ধারণ",
      party_hold: "পার্টি আটকে রাখা বা ছাড়",
    },
    events: {
      PartyCreated: "পার্টি {code} তৈরি: {name}",
      PartyUpdated: "পার্টি {code} হালনাগাদ",
      PartyOnHold: "পার্টি {code} আটকে রাখা হয়েছে",
      PartyReleased: "পার্টি {code} ছাড়া হয়েছে",
      VehicleAdded: "গাড়ি {regNo} যোগ হয়েছে",
    },
  },
}
