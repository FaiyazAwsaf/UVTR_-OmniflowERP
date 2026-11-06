import type { sacEn } from "./en"

/** SAC strings, Bangla. Same shape as en.ts. */
export const sacBn: typeof sacEn = {
  sac: {
    name: "ব্যবহারকারী নিরাপত্তা",
    description: "ব্যবহারকারী, সেশন, নীতিমালা ও অডিট ট্রেইল",
    pages: {
      home: "ব্যবহারকারী",
      user: "ব্যবহারকারী",
      sessions: "সক্রিয় সেশন",
      loginHistory: "লগইন ইতিহাস",
      policy: "নিরাপত্তা নীতিমালা",
      audit: "অডিট ট্রেইল",
    },
    perm: {
      app_view: "ব্যবহারকারী নিরাপত্তা খোলা",
      audit_view: "অডিট ট্রেইল দেখা",
      user_create: "ব্যবহারকারী তৈরি",
      user_edit: "ব্যবহারকারী সম্পাদনা, আনলক ও রিসেট",
      session_end: "সেশন শেষ করা",
      policy_configure: "নিরাপত্তা নীতিমালা কনফিগার",
    },
    events: {
      SignedIn: "{user} সাইন ইন করেছেন",
      SignInFailed: "{user}-এর সাইন ইন ব্যর্থ",
      UserLocked: "{user} লক করা হয়েছে",
      UserUnlocked: "{user} আনলক করা হয়েছে",
      SignedOut: "{user} সাইন আউট করেছেন",
      SessionEnded: "{user}-এর সেশন শেষ",
      UserCreated: "ব্যবহারকারী {user} তৈরি",
      UserUpdated: "ব্যবহারকারী {user} হালনাগাদ",
      PasswordReset: "{user}-এর পাসওয়ার্ড রিসেট",
      PasswordChanged: "{user} পাসওয়ার্ড পরিবর্তন করেছেন",
      PolicyChanged: "নিরাপত্তা নীতিমালা পরিবর্তিত",
    },
  },
}
