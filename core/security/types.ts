import type { LucideIcon } from "lucide-react"

/**
 * Security vocabulary (implementation_plan.md §3.8, §3.9). Roles are data in
 * the `roles` table; the codes below are the seeded system roles.
 */

export const ROLE_CODES = [
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
] as const

export type RoleCode = (typeof ROLE_CODES)[number]

/** Row id of a seeded system role, e.g. role_acc_mgr. */
export function roleId(code: RoleCode): string {
  return `role_${code.toLowerCase()}`
}

/** `all` locations, or only the user's own location(s). */
export type Scope = "all" | "own-location"

/** The eight columns of the RBAC permission matrix (§3.9). */
export const PERMISSION_COLUMNS = [
  "view",
  "create",
  "edit",
  "approve",
  "post",
  "cancel",
  "export",
  "configure",
] as const

export type PermissionColumn = (typeof PERMISSION_COLUMNS)[number]

/** A seeded default grant of a key to a role. */
export type Grant = { role: RoleCode; scope: Scope }

/** One permission key of the catalogue (modules/<app>/permissions.ts). */
export type PermissionDef = {
  /** `<app>.<resource>.<verb>`, e.g. "si.invoice.issue" */
  key: string
  /** i18n key of the label in the RBAC matrix and the effective checker */
  labelKey: string
  column: PermissionColumn
  grants: Grant[]
}

/** What a command declares (§3.3): a key, any of several, any user, or system only. */
export type CommandPermission = string | readonly string[] | "authenticated" | "system"

/** Approval kinds (§3.7) */
export const APPROVAL_KINDS = [
  "discount-pct",
  "journal",
  "payment",
  "purchase",
  "credit-note",
  "stock-adjust",
  "petty-cash",
  "credit-override",
] as const

export type ApprovalKind = (typeof APPROVAL_KINDS)[number]

/** App codes of the SME package (objective §2) plus the cross-app areas. */
export const APP_CODES = [
  "fa",
  "ap",
  "ar",
  "cab",
  "par",
  "frs",
  "stl",
  "si",
  "pc",
  "sd",
  "ptl",
  "pm",
  "grn",
  "st",
  "ic",
  "irt",
  "sac",
  "rbac",
] as const

export type AppCode = (typeof APP_CODES)[number]

export type SuiteCode = "fms" | "sdm" | "scm" | "csc"

export const SUITES: { code: SuiteCode; apps: AppCode[] }[] = [
  { code: "fms", apps: ["fa", "ap", "ar", "cab", "par", "frs"] },
  { code: "sdm", apps: ["stl", "si", "pc", "sd"] },
  { code: "scm", apps: ["ptl", "pm", "grn", "st", "ic"] },
  { code: "csc", apps: ["irt", "sac", "rbac"] },
]

export function suiteOf(app: AppCode): SuiteCode {
  return SUITES.find((s) => s.apps.includes(app))!.code
}

/** A screen inside an app (the app's own tabs, §9). */
export type AppSection = {
  href: string
  /** i18n key, resolved with `tk()` */
  labelKey: string
  /** Key needed to see the tab; defaults to the app's view key */
  permission?: string
}

/**
 * One sidebar entry. Each module declares its own in modules/<m>/nav.ts.
 * Apps carry their code (shown as the chip) and suite; the workspace entries
 * (home, dashboard, approvals) carry neither.
 */
export type NavItem = {
  href: string
  /** i18n key, resolved with `tk()` */
  labelKey: string
  /** i18n key of a one-line description (app tiles on /apps) */
  descriptionKey?: string
  icon: LucideIcon
  /** "workspace" or a suite */
  group: "workspace" | SuiteCode
  /** The key needed to see it; "authenticated" for any signed-in user */
  permission: string
  app?: AppCode
  /** Sort order inside the group (lower first) */
  order: number
  /** The app's screens (tabs) */
  sections?: AppSection[]
}
