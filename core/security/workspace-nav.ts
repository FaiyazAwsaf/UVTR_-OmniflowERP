import { House, Inbox, LayoutGrid, ScrollText } from "lucide-react"

import type { NavItem } from "./types"

/**
 * The sidebar's Workspace group (ui_guidelines.md §3): entries every signed-in
 * user has, plus the audit trail for those who may read it without SAC.
 * The dashboard entry lives in modules/dashboard/nav.ts.
 */
export const WORKSPACE_NAV: NavItem[] = [
  {
    href: "/home",
    labelKey: "shell.workspace.home",
    icon: House,
    group: "workspace",
    permission: "authenticated",
    order: 10,
  },
  {
    href: "/apps",
    labelKey: "shell.workspace.apps",
    icon: LayoutGrid,
    group: "workspace",
    permission: "authenticated",
    order: 20,
  },
  {
    href: "/approvals",
    labelKey: "shell.workspace.approvals",
    icon: Inbox,
    group: "workspace",
    permission: "authenticated",
    order: 40,
  },
  {
    href: "/sac/audit",
    labelKey: "shell.workspace.audit",
    icon: ScrollText,
    group: "workspace",
    permission: "sac.audit.view",
    order: 50,
  },
]
