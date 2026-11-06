import { Landmark } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** CAB in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const cabNav: NavItem[] = [
  {
    app: "cab",
    href: "/cab",
    labelKey: "cab.name",
    descriptionKey: "cab.description",
    icon: Landmark,
    group: "fms",
    permission: "cab.app.view",
    order: 140,
    sections: [
      { href: "/cab", labelKey: "cab.pages.home" },
      { href: "/cab/transfers", labelKey: "cab.pages.transfers" },
      { href: "/cab/cheques", labelKey: "cab.pages.cheques" },
      { href: "/cab/reconciliation", labelKey: "cab.pages.reconciliation" },
      { href: "/cab/petty-cash", labelKey: "cab.pages.pettyCash" },
      { href: "/cab/settlements", labelKey: "cab.pages.settlements" },
    ],
  },
]
