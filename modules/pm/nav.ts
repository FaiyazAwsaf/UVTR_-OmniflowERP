import { Package } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** PM in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const pmNav: NavItem[] = [
  {
    app: "pm",
    href: "/pm",
    labelKey: "pm.name",
    descriptionKey: "pm.description",
    icon: Package,
    group: "scm",
    permission: "pm.app.view",
    order: 320,
    sections: [
      { href: "/pm", labelKey: "pm.pages.home" },
      { href: "/pm/categories", labelKey: "pm.pages.categories" },
      { href: "/pm/uom", labelKey: "pm.pages.uom" },
    ],
  },
]
