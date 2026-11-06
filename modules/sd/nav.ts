import { Truck } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** SD in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const sdNav: NavItem[] = [
  {
    app: "sd",
    href: "/sd",
    labelKey: "sd.name",
    descriptionKey: "sd.description",
    icon: Truck,
    group: "sdm",
    permission: "sd.app.view",
    order: 240,
    sections: [
      { href: "/sd", labelKey: "sd.pages.home" },
      { href: "/sd/deliveries", labelKey: "sd.pages.deliveries" },
    ],
  },
]
