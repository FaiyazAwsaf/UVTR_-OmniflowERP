import type { sdEn } from "./en"

/** SD strings, Bangla. Same shape as en.ts. */
export const sdBn: typeof sdEn = {
  sd: {
    name: "বিক্রয় ডেলিভারি",
    description: "গাড়ি হস্তান্তর, গেট পাস ও পণ্য ডেলিভারি",
    pages: {
      home: "অপেক্ষমাণ ডেলিভারি",
      handover: "গাড়ি হস্তান্তর",
      deliveries: "ডেলিভারির ইতিহাস",
    },
    perm: {
      app_view: "বিক্রয় ডেলিভারি খোলা",
      delivery_handover: "গাড়ি হস্তান্তর",
      delivery_goods: "পণ্য ডেলিভারি",
    },
    events: {
      VehicleHandedOver: "গাড়ি হস্তান্তর: {no}",
      GoodsDelivered: "পণ্য ডেলিভারি: {no}",
    },
  },
}
