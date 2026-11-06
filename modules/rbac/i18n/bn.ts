import type { rbacEn } from "./en"

/** RBAC strings, Bangla. Same shape as en.ts. */
export const rbacBn: typeof rbacEn = {
  rbac: {
    name: "ভূমিকাভিত্তিক প্রবেশাধিকার নিয়ন্ত্রণ",
    description: "ভূমিকা, অনুমতি ম্যাট্রিক্স, সীমা ও দায়িত্ব পৃথকীকরণ",
    pages: {
      home: "ভূমিকা",
      role: "ভূমিকা",
      assignments: "বরাদ্দ",
      limits: "অনুমোদন সীমা",
      sod: "দায়িত্ব পৃথকীকরণ",
      effective: "কার্যকর অনুমতি",
    },
    perm: {
      app_view: "ভূমিকাভিত্তিক প্রবেশাধিকার খোলা",
      role_edit: "ভূমিকা ও অনুমতি সম্পাদনা",
      assign_edit: "ব্যবহারকারীকে ভূমিকা বরাদ্দ",
      limits_edit: "অনুমোদন সীমা নির্ধারণ",
      sod_edit: "দায়িত্ব পৃথকীকরণ নিয়ম সম্পাদনা",
    },
    events: {
      PermissionGranted: "{role}-কে {permission} দেওয়া হয়েছে",
      PermissionRevoked: "{role} থেকে {permission} প্রত্যাহার",
      RoleAssigned: "{user}-কে {role} বরাদ্দ",
      RoleUnassigned: "{user} থেকে {role} সরানো হয়েছে",
      LimitChanged: "{role}-এর {kind} সীমা পরিবর্তিত",
      SodConflictFlagged: "দায়িত্ব পৃথকীকরণ দ্বন্দ্ব: {rule}",
    },
  },
}
