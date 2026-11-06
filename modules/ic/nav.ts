import { Warehouse } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** IC in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const icNav: NavItem[] = [
  {
    app: "ic",
    href: "/ic",
    labelKey: "ic.name",
    descriptionKey: "ic.description",
    icon: Warehouse,
    group: "scm",
    permission: "ic.app.view",
    order: 350,
    sections: [
      { href: "/ic", labelKey: "ic.pages.home" },
      { href: "/ic/counts", labelKey: "ic.pages.counts" },
      { href: "/ic/reorder", labelKey: "ic.pages.reorder" },
      { href: "/ic/expiry", labelKey: "ic.pages.expiry" },
      { href: "/ic/consumption", labelKey: "ic.pages.consumption" },
    ],
  },
]
