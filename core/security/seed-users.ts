import type { LocationCode } from "@/config/brand.config"

import type { RoleCode } from "./types"

/**
 * The 21 seeded users (seed_data.md §2), as static data for the launcher, the
 * Demo Wall and the seed. Every name is synthetic. Live data (status, roles,
 * locations) always comes from the `users` table; this list is only the
 * starting point and the launcher's directory.
 */
export type SeedUser = {
  /** Fixed row id, e.g. usr_mahbub */
  id: string
  username: string
  nameEn: string
  nameBn: string
  role: RoleCode
  designationEn: string
  designationBn: string
  home: LocationCode
  /** Every location the user works at ("all" = every location) */
  locations: LocationCode[] | "all"
  sex: "M" | "F"
  employeeNo: string
  phone: string
  /** Where the launcher signs the window in to (§8) */
  landing: string
  mfaEnabled?: boolean
  /** Planted state: locked by 5 failed sign-ins yesterday */
  lockedAtSeed?: boolean
  /** One-line note shown on the launcher card */
  noteEn?: string
  noteBn?: string
}

const u = (
  id: string,
  nameEn: string,
  nameBn: string,
  role: RoleCode,
  home: LocationCode,
  locations: LocationCode[] | "all",
  sex: "M" | "F",
  n: number,
  extra: Partial<SeedUser> = {}
): SeedUser => ({
  id: `usr_${id}`,
  username: id,
  nameEn,
  nameBn,
  role,
  designationEn: ROLE_DESIGNATION[role].en,
  designationBn: ROLE_DESIGNATION[role].bn,
  home,
  locations,
  sex,
  employeeNo: `AM-${String(1000 + n)}`,
  // Synthetic numbers: 01XXX-XXXXXX
  phone: `01${["7", "8", "9", "5", "6"][n % 5]}${String(10 + n).slice(-2)}-${String(510_000 + n * 1_373)}`,
  landing: ROLE_LANDING[role],
  ...extra,
})

export const ROLE_LANDING: Record<RoleCode, string> = {
  OWNER: "/dashboard",
  ACC_MGR: "/home",
  ACCOUNTANT: "/fa",
  STUDIO_MGR: "/stl",
  ADVISOR: "/stl/board",
  CASHIER: "/si/counter",
  TECHNICIAN: "/stl/my-jobs",
  STORE: "/ic",
  PROCUREMENT: "/ptl",
  SYS_ADMIN: "/sac",
  AUDITOR: "/frs",
}

export const ROLE_DESIGNATION: Record<RoleCode, { en: string; bn: string }> = {
  OWNER: { en: "Managing Director", bn: "ব্যবস্থাপনা পরিচালক" },
  ACC_MGR: { en: "Accounts Manager", bn: "হিসাব ব্যবস্থাপক" },
  ACCOUNTANT: { en: "Accountant", bn: "হিসাবরক্ষক" },
  STUDIO_MGR: { en: "Studio Manager", bn: "স্টুডিও ব্যবস্থাপক" },
  ADVISOR: { en: "Service Advisor", bn: "সার্ভিস অ্যাডভাইজার" },
  CASHIER: { en: "Cashier", bn: "ক্যাশিয়ার" },
  TECHNICIAN: { en: "Technician", bn: "টেকনিশিয়ান" },
  STORE: { en: "Store Keeper", bn: "স্টোর কিপার" },
  PROCUREMENT: { en: "Procurement Officer", bn: "ক্রয় কর্মকর্তা" },
  SYS_ADMIN: { en: "System Administrator", bn: "সিস্টেম অ্যাডমিনিস্ট্রেটর" },
  AUDITOR: { en: "Auditor (read only)", bn: "নিরীক্ষক (শুধু দেখার জন্য)" },
}

export const SEED_USERS: SeedUser[] = [
  u("rashed", "Rashed Chowdhury", "রাশেদ চৌধুরী", "OWNER", "HQ", "all", "M", 1),
  u("farzana", "Farzana Haque", "ফারজানা হক", "ACC_MGR", "HQ", "all", "F", 2, {
    noteEn: "Closes periods",
    noteBn: "পিরিয়ড বন্ধ করেন",
  }),
  u("mahbub", "Mahbub Alam", "মাহবুব আলম", "ACCOUNTANT", "HQ", "all", "M", 3, {
    noteEn: "Vouchers, bills, payments, reconciliation",
    noteBn: "ভাউচার, বিল, পেমেন্ট, সমন্বয়",
  }),
  u("shahriar", "Shahriar Kabir", "শাহরিয়ার কবির", "STUDIO_MGR", "GUL", ["GUL"], "M", 4),
  u("arif", "Arif Mahmud", "আরিফ মাহমুদ", "STUDIO_MGR", "UTT", ["UTT"], "M", 5),
  u("nayeem", "Nayeem Islam", "নাঈম ইসলাম", "ADVISOR", "GUL", ["GUL"], "M", 6),
  u("shuvo", "Shuvo Das", "শুভ দাস", "ADVISOR", "UTT", ["UTT"], "M", 7, {
    noteEn: "The lockout scenario's user",
    noteBn: "লকআউট দৃশ্যের ব্যবহারকারী",
  }),
  u("tania", "Tania Akter", "তানিয়া আক্তার", "CASHIER", "GUL", ["GUL"], "F", 8),
  u("sabbir", "Sabbir Hossain", "সাব্বির হোসেন", "CASHIER", "UTT", ["UTT"], "M", 9),
  u("rakib", "Rakib Hasan", "রাকিব হাসান", "TECHNICIAN", "GUL", ["GUL"], "M", 10, {
    noteEn: "Coating specialist",
    noteBn: "কোটিং বিশেষজ্ঞ",
  }),
  u("sajib", "Sajib Ahmed", "সজীব আহমেদ", "TECHNICIAN", "GUL", ["GUL"], "M", 11),
  u("monir", "Monir Hossain", "মনির হোসেন", "TECHNICIAN", "GUL", ["GUL"], "M", 12),
  u("faruk", "Faruk Mia", "ফারুক মিয়া", "TECHNICIAN", "GUL", ["GUL"], "M", 13),
  u("sohel", "Sohel Rana", "সোহেল রানা", "TECHNICIAN", "GUL", ["GUL"], "M", 14),
  u("jewel", "Jewel Rana", "জুয়েল রানা", "TECHNICIAN", "UTT", ["UTT"], "M", 15),
  u("polash", "Polash Sarkar", "পলাশ সরকার", "TECHNICIAN", "UTT", ["UTT"], "M", 16, {
    lockedAtSeed: true,
    noteEn: "Locked: 5 failed sign-ins yesterday",
    noteBn: "লক: গতকাল ৫ বার ভুল পাসওয়ার্ড",
  }),
  u("kamrul", "Kamrul Islam", "কামরুল ইসলাম", "TECHNICIAN", "UTT", ["UTT"], "M", 17),
  u("habib", "Habib Ullah", "হাবিব উল্লাহ", "STORE", "CST", ["CST", "GUL", "UTT"], "M", 18),
  u("nusrat", "Nusrat Jahan", "নুসরাত জাহান", "PROCUREMENT", "HQ", "all", "F", 19),
  u("tahmid", "Tahmid Hasan", "তাহমিদ হাসান", "SYS_ADMIN", "HQ", ["HQ"], "M", 20, {
    mfaEnabled: true,
    noteEn: "MFA on (code 123456)",
    noteBn: "এমএফএ চালু (কোড 123456)",
  }),
  u("shamima", "Shamima Nasrin", "শামীমা নাসরিন", "AUDITOR", "HQ", "all", "F", 21, {
    noteEn: "External, read only",
    noteBn: "বহিরাগত, শুধু দেখার জন্য",
  }),
]

export function findSeedUser(idOrUsername: string): SeedUser | undefined {
  return SEED_USERS.find((s) => s.id === idOrUsername || s.username === idOrUsername)
}

/** The launcher's role order (§8) */
export const ROLE_ORDER: RoleCode[] = [
  "OWNER",
  "ACC_MGR",
  "ACCOUNTANT",
  "STUDIO_MGR",
  "ADVISOR",
  "CASHIER",
  "TECHNICIAN",
  "STORE",
  "PROCUREMENT",
  "SYS_ADMIN",
  "AUDITOR",
]
