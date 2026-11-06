import { Wallet } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** AR in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const arNav: NavItem[] = [
  {
    app: "ar",
    href: "/ar",
    labelKey: "ar.name",
    descriptionKey: "ar.description",
    icon: Wallet,
    group: "fms",
    permission: "ar.app.view",
    order: 130,
    sections: [
      { href: "/ar", labelKey: "ar.pages.home" },
      { href: "/ar/receipts", labelKey: "ar.pages.receipts" },
      { href: "/ar/refunds", labelKey: "ar.pages.refunds" },
      { href: "/ar/aging", labelKey: "ar.pages.aging" },
      { href: "/ar/credit-control", labelKey: "ar.pages.creditControl" },
    ],
  },
]
