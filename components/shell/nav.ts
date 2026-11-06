import { NAV_ITEMS } from "@/core/security/registry"
import type { NavItem } from "@/core/security/types"

export type NavGroup = { group: NavItem["group"]; items: NavItem[] }

const GROUP_ORDER: NavItem["group"][] = ["workspace", "fms", "sdm", "scm", "csc"]

/** The sidebar entries a user may open (filtered live by `can`). */
export function navFor(can: (permission: string) => boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => can(item.permission))
}

/** Entries grouped under Workspace and the four suites, in suite order. */
export function groupNav(items: NavItem[]): NavGroup[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group).sort((a, b) => a.order - b.order),
  })).filter((g) => g.items.length)
}

/** i18n key of a group heading. */
export function groupLabelKey(group: NavItem["group"]): string {
  return group === "workspace" ? "shell.workspace.group" : `suites.${group}.code`
}

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The entry that owns a pathname: the longest matching href. */
export function activeHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null
  for (const item of items) {
    if (matches(pathname, item.href) && (!best || item.href.length > best.length)) {
      best = item.href
    }
  }
  return best
}
