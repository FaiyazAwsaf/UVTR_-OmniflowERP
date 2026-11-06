import { PackageCheck } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** GRN in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const grnNav: NavItem[] = [
  {
    app: "grn",
    href: "/grn",
    labelKey: "grn.name",
    descriptionKey: "grn.description",
    icon: PackageCheck,
    group: "scm",
    permission: "grn.app.view",
    order: 330,
    sections: [
      { href: "/grn", labelKey: "grn.pages.home" },
      { href: "/grn/quarantine", labelKey: "grn.pages.quarantine" },
    ],
  },
]
