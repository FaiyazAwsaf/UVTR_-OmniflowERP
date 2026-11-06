import { Sparkles } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** PC in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const pcNav: NavItem[] = [
  {
    app: "pc",
    href: "/pc",
    labelKey: "pc.name",
    descriptionKey: "pc.description",
    icon: Sparkles,
    group: "sdm",
    permission: "pc.app.view",
    order: 230,
    sections: [
      { href: "/pc", labelKey: "pc.pages.home" },
      { href: "/pc/packages", labelKey: "pc.pages.packages" },
      { href: "/pc/price-lists", labelKey: "pc.pages.priceLists" },
      { href: "/pc/promotions", labelKey: "pc.pages.promotions" },
    ],
  },
]
