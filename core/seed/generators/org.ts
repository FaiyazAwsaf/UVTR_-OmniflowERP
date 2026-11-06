import { fiscalYearBounds, locations, type LocationCode } from "@/config/brand.config"
import { defaultTaxSettings, rules } from "@/config/rules.config"
import { DEFAULT_SECURITY_POLICY } from "@/core/db/settings"
import type { ISODate } from "@/core/db/schema"
import { hashPassword } from "@/core/security/password"
import { PERMISSIONS } from "@/core/security/registry"
import { SEED_USERS } from "@/core/security/seed-users"
import { APPROVAL_KINDS, roleId, type ApprovalKind, type RoleCode } from "@/core/security/types"

import type { SeedCtx } from "../context"
import { addMonthsISO, dhakaAt, isoAddDays, lastOfMonth } from "../time"

/**
 * Organisation, settings, fiscal calendar and security (seed_data.md §1, §2).
 * Main-agent foundation: WS-Seed builds every other generator on top of it.
 */

export const locationIdOf = (code: LocationCode) => `loc_${code.toLowerCase()}`
export const costCentreIdOf = (code: LocationCode) => `cc_${code.toLowerCase()}`
export const bayIdOf = (code: LocationCode, bay: string) => `bay_${code.toLowerCase()}_${bay.toLowerCase()}`
export const fiscalYearIdOf = (tag: string) => `fy_${tag}`
/** Period id from a calendar month "YYYY-MM" */
export function periodIdOf(month: string): string {
  const { tag } = fiscalYearBounds(`${month}-15`)
  return `per_${tag}_${String(fiscalMonthNo(month)).padStart(2, "0")}`
}
/** Fiscal month number, July = 1 */
export function fiscalMonthNo(month: string): number {
  const m = Number(month.slice(5, 7))
  return m >= 7 ? m - 6 : m + 6
}

export const ROLE_META: Record<RoleCode, { en: string; bn: string; dEn: string; dBn: string }> = {
  OWNER: {
    en: "Owner / Managing Director",
    bn: "মালিক / ব্যবস্থাপনা পরিচালক",
    dEn: "Views everything; approves every kind without limit",
    dBn: "সবকিছু দেখেন; সীমা ছাড়া সব অনুমোদন করেন",
  },
  ACC_MGR: {
    en: "Accounts Manager",
    bn: "হিসাব ব্যবস্থাপক",
    dEn: "Runs the finance apps, approves and closes periods",
    dBn: "আর্থিক অ্যাপ চালান, অনুমোদন ও পিরিয়ড বন্ধ করেন",
  },
  ACCOUNTANT: {
    en: "Accountant",
    bn: "হিসাবরক্ষক",
    dEn: "Vouchers, bills, payments, receipts and reconciliation",
    dBn: "ভাউচার, বিল, পেমেন্ট, রসিদ ও সমন্বয়",
  },
  STUDIO_MGR: {
    en: "Studio Manager",
    bn: "স্টুডিও ব্যবস্থাপক",
    dEn: "Runs the studio: orders, QC, handover and invoices",
    dBn: "স্টুডিও পরিচালনা: অর্ডার, মান যাচাই, হস্তান্তর ও চালান",
  },
  ADVISOR: {
    en: "Service Advisor",
    bn: "সার্ভিস অ্যাডভাইজার",
    dEn: "Quotations, bookings, deposits and handover",
    dBn: "কোটেশন, বুকিং, অগ্রিম ও হস্তান্তর",
  },
  CASHIER: {
    en: "Cashier",
    bn: "ক্যাশিয়ার",
    dEn: "Counter checkout, receipts and the till",
    dBn: "কাউন্টার চেকআউট, রসিদ ও ক্যাশ",
  },
  TECHNICIAN: {
    en: "Technician",
    bn: "টেকনিশিয়ান",
    dEn: "Own tasks and consumables",
    dBn: "নিজের কাজ ও উপকরণ",
  },
  STORE: {
    en: "Store Keeper",
    bn: "স্টোর কিপার",
    dEn: "Goods receipts, transfers, adjustments and counts",
    dBn: "মাল গ্রহণ, স্থানান্তর, সমন্বয় ও গণনা",
  },
  PROCUREMENT: {
    en: "Procurement Officer",
    bn: "ক্রয় কর্মকর্তা",
    dEn: "Requisitions, purchase orders and vendors",
    dBn: "রিকুইজিশন, ক্রয় আদেশ ও সরবরাহকারী",
  },
  SYS_ADMIN: {
    en: "System Administrator",
    bn: "সিস্টেম অ্যাডমিনিস্ট্রেটর",
    dEn: "Users, roles and the audit trail; no business transactions",
    dBn: "ব্যবহারকারী, ভূমিকা ও অডিট ট্রেইল; কোনো ব্যবসায়িক লেনদেন নয়",
  },
  AUDITOR: {
    en: "Auditor (read only)",
    bn: "নিরীক্ষক (শুধু দেখার জন্য)",
    dEn: "Views and exports, never changes anything",
    dBn: "দেখেন ও রপ্তানি করেন, কখনো কিছু পরিবর্তন করেন না",
  },
}

const T = (taka: number) => taka * 100
const U = -1 // unlimited

/** Approval limits (seed_data.md §2.2): poisha, percent for discount-pct, 1 = yes for credit-override. */
export const APPROVAL_LIMITS: Record<RoleCode, Record<ApprovalKind, number>> = {
  OWNER: {
    "discount-pct": 100, journal: U, payment: U, purchase: U,
    "credit-note": U, "stock-adjust": U, "petty-cash": U, "credit-override": 1,
  },
  ACC_MGR: {
    "discount-pct": 15, journal: T(10_00_000), payment: T(5_00_000), purchase: T(5_00_000),
    "credit-note": T(1_00_000), "stock-adjust": T(50_000), "petty-cash": T(20_000), "credit-override": 1,
  },
  ACCOUNTANT: {
    "discount-pct": 0, journal: T(50_000), payment: 0, purchase: 0,
    "credit-note": 0, "stock-adjust": 0, "petty-cash": T(5_000), "credit-override": 0,
  },
  STUDIO_MGR: {
    "discount-pct": 15, journal: 0, payment: 0, purchase: 0,
    "credit-note": T(10_000), "stock-adjust": T(5_000), "petty-cash": T(5_000), "credit-override": 0,
  },
  ADVISOR: {
    "discount-pct": 5, journal: 0, payment: 0, purchase: 0,
    "credit-note": 0, "stock-adjust": 0, "petty-cash": 0, "credit-override": 0,
  },
  CASHIER: {
    "discount-pct": 0, journal: 0, payment: 0, purchase: 0,
    "credit-note": 0, "stock-adjust": 0, "petty-cash": T(1_000), "credit-override": 0,
  },
  TECHNICIAN: zeroLimits(),
  STORE: { ...zeroLimits(), "stock-adjust": T(1_000) },
  PROCUREMENT: { ...zeroLimits(), purchase: T(1_00_000) },
  SYS_ADMIN: zeroLimits(),
  AUDITOR: zeroLimits(),
}

function zeroLimits(): Record<ApprovalKind, number> {
  return Object.fromEntries(APPROVAL_KINDS.map((k) => [k, 0])) as Record<ApprovalKind, number>
}

/** Segregation-of-duties rules (seed_data.md §2.3). */
export const SOD_RULES = [
  ["SOD-01", "fa.journal.create", "fa.journal.approve", "warn",
    "Preparing and approving journal vouchers", "জার্নাল ভাউচার প্রস্তুত ও অনুমোদন"],
  ["SOD-02", "ptl.po.create", "ap.payment.approve", "block",
    "Issuing purchase orders and approving vendor payments", "ক্রয় আদেশ ইস্যু ও সরবরাহকারী পেমেন্ট অনুমোদন"],
  ["SOD-03", "ap.bill.create", "ap.payment.approve", "warn",
    "Recording vendor bills and approving their payment", "সরবরাহকারীর বিল রেকর্ড ও তার পেমেন্ট অনুমোদন"],
  ["SOD-04", "rbac.assign.edit", "*.approve", "block",
    "Assigning roles and approving any business document", "ভূমিকা বরাদ্দ ও যেকোনো ব্যবসায়িক নথি অনুমোদন"],
  ["SOD-05", "st.adjust.create", "st.adjust.approve", "warn",
    "Adjusting stock and approving the adjustment", "মজুদ সমন্বয় ও সেই সমন্বয় অনুমোদন"],
  ["SOD-06", "si.creditnote.create", "si.creditnote.approve", "warn",
    "Raising credit notes and approving them", "ক্রেডিট নোট তৈরি ও অনুমোদন"],
] as const

export const ROLE_CODES_SEEDED: RoleCode[] = Object.keys(ROLE_META) as RoleCode[]

/** Locations, bays, cost centres and settings rows. */
export function seedOrganisation(ctx: SeedCtx): void {
  const at = ctx.now
  for (const loc of locations) {
    ctx.bag.put("costCentres", costCentreIdOf(loc.code), at, {
      code: `CC-${loc.code}`,
      nameEn: loc.name.en,
      nameBn: loc.name.bn,
      locationId: loc.id,
    })
    ctx.bag.put("locations", loc.id, at, {
      code: loc.code,
      nameEn: loc.name.en,
      nameBn: loc.name.bn,
      kind: loc.kind,
      address: loc.address,
      phone: loc.phone,
      isStockLocation: loc.isStockLocation,
      costCentreId: costCentreIdOf(loc.code),
      active: true,
    })
    for (const bay of loc.bays) {
      ctx.bag.put("bays", bayIdOf(loc.code, bay.code), at, {
        locationId: loc.id,
        code: bay.code,
        nameEn: bay.name.en,
        nameBn: bay.name.bn,
        kind: bay.kind,
        active: true,
      })
    }
  }
  ctx.bag.put("settings", "tax", at, { value: structuredClone(defaultTaxSettings) })
  ctx.bag.put("settings", "security", at, { value: { ...DEFAULT_SECURITY_POLICY } })
  ctx.bag.put("settings", "company", at, {
    value: {
      printFooterEn: "Thank you for choosing us. Demo document, not a real tax document.",
      printFooterBn: "আমাদের বেছে নেওয়ার জন্য ধন্যবাদ। ডেমো নথি, প্রকৃত কর নথি নয়।",
    },
  })
}

/**
 * The history's first day (seed_data.md §1): the start of the fiscal year
 * that contains today − 120 days.
 */
export function historyStart(today: ISODate): ISODate {
  return fiscalYearBounds(isoAddDays(today, -120)).startsOn
}

/**
 * Fiscal years and monthly periods from the history start to the end of the
 * current fiscal year. Months before last month are closed (by Farzana on the
 * 7th of the following month); an earlier year is closed only when all its
 * months are (seed_data.md §1, §7.2).
 */
export function seedFiscalCalendar(ctx: SeedCtx): void {
  const start = historyStart(ctx.today)
  const end = fiscalYearBounds(ctx.today).endsOn
  const lastMonthStart = addMonthsISO(ctx.today, -1)
  const years = new Map<string, { startsOn: ISODate; endsOn: ISODate; allClosed: boolean }>()
  for (let m = start; m <= end; m = addMonthsISO(m, 1)) {
    const month = m.slice(0, 7)
    const fy = fiscalYearBounds(m)
    const closed = m < lastMonthStart
    const year = years.get(fy.tag) ?? { startsOn: fy.startsOn, endsOn: fy.endsOn, allClosed: true }
    if (!closed) year.allClosed = false
    years.set(fy.tag, year)
    const closeDay = isoAddDays(lastOfMonth(m), 7)
    ctx.bag.put("periods", periodIdOf(month), ctx.now, {
      fiscalYearId: fiscalYearIdOf(fy.tag),
      code: `${fy.tag}-${String(fiscalMonthNo(month)).padStart(2, "0")}`,
      month,
      startsOn: m,
      endsOn: lastOfMonth(m),
      status: closed ? "closed" : "open",
      ...(closed ? { closedBy: "usr_farzana", closedAt: dhakaAt(closeDay, "11:00") } : {}),
    })
  }
  for (const [tag, year] of years) {
    ctx.bag.put("fiscalYears", fiscalYearIdOf(tag), ctx.now, {
      code: tag,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      status: year.allClosed ? "closed" : "open",
    })
  }
}

/** Roles, their grants from the catalogue, limits, SoD rules and the 21 users. */
export function seedSecurity(ctx: SeedCtx): void {
  const at = ctx.now
  for (const code of ROLE_CODES_SEEDED) {
    const meta = ROLE_META[code]
    ctx.bag.put("roles", roleId(code), at, {
      code,
      nameEn: meta.en,
      nameBn: meta.bn,
      descriptionEn: meta.dEn,
      descriptionBn: meta.dBn,
      isSystem: true,
      active: true,
    })
    for (const kind of APPROVAL_KINDS) {
      ctx.bag.put("approvalLimits", `lim_${code.toLowerCase()}_${kind}`, at, {
        roleId: roleId(code),
        kind,
        value: APPROVAL_LIMITS[code][kind],
      })
    }
  }
  // Grants: exactly the Roles column of the catalogue (seed_data.md §2.1).
  for (const permission of PERMISSIONS) {
    for (const grant of permission.grants) {
      ctx.bag.put(
        "rolePermissions",
        `rp_${grant.role.toLowerCase()}_${permission.key}`,
        at,
        { roleId: roleId(grant.role), permission: permission.key, scope: grant.scope }
      )
    }
  }
  for (const [code, a, b, mode, en, bn] of SOD_RULES) {
    ctx.bag.put("sodRules", `sod_${code.slice(4)}`, at, {
      code,
      permissionA: a,
      permissionB: b,
      mode,
      descriptionEn: en,
      descriptionBn: bn,
      active: true,
    })
  }
  const allLocations = locations.map((l) => l.id)
  for (const user of SEED_USERS) {
    const locationIds =
      user.locations === "all" ? allLocations : user.locations.map((c) => locationIdOf(c))
    ctx.bag.put("users", user.id, at, {
      username: user.username,
      nameEn: user.nameEn,
      nameBn: user.nameBn,
      designationEn: user.designationEn,
      designationBn: user.designationBn,
      email: `${user.username}@automania.example`,
      phone: user.phone,
      employeeNo: user.employeeNo,
      homeLocationId: locationIdOf(user.home),
      locationIds,
      status: user.lockedAtSeed ? "locked" : "active",
      passwordHash: hashPassword(user.username, rules.demoPassword),
      passwordSetAt: ctx.now - 30 * 86_400_000,
      mustChangePassword: false,
      mfaEnabled: !!user.mfaEnabled,
      failedAttempts: user.lockedAtSeed ? rules.lockoutThreshold : 0,
      avatarSeed: user.username,
      sex: user.sex,
    })
    ctx.bag.put("userRoles", `ur_${user.username}_${user.role.toLowerCase()}`, at, {
      userId: user.id,
      roleId: roleId(user.role),
      grantedBy: "system",
      grantedAt: at,
    })
  }
}
