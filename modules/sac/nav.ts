import { ShieldCheck } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** SAC in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const sacNav: NavItem[] = [
  {
    app: "sac",
    href: "/sac",
    labelKey: "sac.name",
    descriptionKey: "sac.description",
    icon: ShieldCheck,
    group: "csc",
    permission: "sac.app.view",
    order: 420,
    sections: [
      { href: "/sac", labelKey: "sac.pages.home" },
      { href: "/sac/sessions", labelKey: "sac.pages.sessions" },
      { href: "/sac/login-history", labelKey: "sac.pages.loginHistory" },
      { href: "/sac/policy", labelKey: "sac.pages.policy" },
      { href: "/sac/audit", labelKey: "sac.pages.audit", permission: "sac.audit.view" },
    ],
  },
]
