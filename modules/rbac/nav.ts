import { KeyRound } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** RBAC in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const rbacNav: NavItem[] = [
  {
    app: "rbac",
    href: "/rbac",
    labelKey: "rbac.name",
    descriptionKey: "rbac.description",
    icon: KeyRound,
    group: "csc",
    permission: "rbac.app.view",
    order: 430,
    sections: [
      { href: "/rbac", labelKey: "rbac.pages.home" },
      { href: "/rbac/assignments", labelKey: "rbac.pages.assignments" },
      { href: "/rbac/limits", labelKey: "rbac.pages.limits" },
      { href: "/rbac/sod", labelKey: "rbac.pages.sod" },
      { href: "/rbac/effective", labelKey: "rbac.pages.effective" },
    ],
  },
]
