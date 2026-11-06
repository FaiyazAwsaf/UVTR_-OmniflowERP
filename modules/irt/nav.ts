import { FileSpreadsheet } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** IRT in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const irtNav: NavItem[] = [
  {
    app: "irt",
    href: "/irt",
    labelKey: "irt.name",
    descriptionKey: "irt.description",
    icon: FileSpreadsheet,
    group: "csc",
    permission: "irt.app.view",
    order: 410,
    sections: [
      { href: "/irt", labelKey: "irt.pages.home" },
      { href: "/irt/builder", labelKey: "irt.pages.builder", permission: "irt.builder.create" },
      { href: "/irt/schedules", labelKey: "irt.pages.schedules" },
      { href: "/irt/history", labelKey: "irt.pages.history" },
    ],
  },
]
