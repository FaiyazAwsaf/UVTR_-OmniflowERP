import { UsersRound } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** PAR in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const parNav: NavItem[] = [
  {
    app: "par",
    href: "/par",
    labelKey: "par.name",
    descriptionKey: "par.description",
    icon: UsersRound,
    group: "fms",
    permission: "par.app.view",
    order: 150,
    sections: [
      { href: "/par", labelKey: "par.pages.home" },
      { href: "/par/vehicles", labelKey: "par.pages.vehicles" },
    ],
  },
]
