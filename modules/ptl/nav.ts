import { ShoppingCart } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** PTL in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const ptlNav: NavItem[] = [
  {
    app: "ptl",
    href: "/ptl",
    labelKey: "ptl.name",
    descriptionKey: "ptl.description",
    icon: ShoppingCart,
    group: "scm",
    permission: "ptl.app.view",
    order: 310,
    sections: [
      { href: "/ptl", labelKey: "ptl.pages.home" },
      { href: "/ptl/requisitions", labelKey: "ptl.pages.requisitions" },
      { href: "/ptl/po", labelKey: "ptl.pages.pos" },
      { href: "/ptl/returns", labelKey: "ptl.pages.returns" },
    ],
  },
]
