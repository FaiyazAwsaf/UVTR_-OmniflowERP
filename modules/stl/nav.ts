import { CarFront } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** STL in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const stlNav: NavItem[] = [
  {
    app: "stl",
    href: "/stl",
    labelKey: "stl.name",
    descriptionKey: "stl.description",
    icon: CarFront,
    group: "sdm",
    permission: "stl.app.view",
    order: 210,
    sections: [
      { href: "/stl", labelKey: "stl.pages.home" },
      { href: "/stl/board", labelKey: "stl.pages.board" },
      { href: "/stl/quotations", labelKey: "stl.pages.quotations" },
      { href: "/stl/orders", labelKey: "stl.pages.orders" },
      { href: "/stl/my-jobs", labelKey: "stl.pages.myJobs", permission: "stl.job.work" },
    ],
  },
]
