import { ChartColumn } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** FRS in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const frsNav: NavItem[] = [
  {
    app: "frs",
    href: "/frs",
    labelKey: "frs.name",
    descriptionKey: "frs.description",
    icon: ChartColumn,
    group: "fms",
    permission: "frs.app.view",
    order: 160,
    sections: [
      { href: "/frs", labelKey: "frs.pages.home" },
      { href: "/frs/trial-balance", labelKey: "frs.pages.trialBalance" },
      { href: "/frs/profit-loss", labelKey: "frs.pages.profitLoss" },
      { href: "/frs/balance-sheet", labelKey: "frs.pages.balanceSheet" },
      { href: "/frs/cash-flow", labelKey: "frs.pages.cashFlow" },
      { href: "/frs/vat", labelKey: "frs.pages.vat" },
      { href: "/frs/withholding", labelKey: "frs.pages.withholding" },
    ],
  },
]
