import { BookOpenText } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** FA in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const faNav: NavItem[] = [
  {
    app: "fa",
    href: "/fa",
    labelKey: "fa.name",
    descriptionKey: "fa.description",
    icon: BookOpenText,
    group: "fms",
    permission: "fa.app.view",
    order: 110,
    sections: [
      { href: "/fa", labelKey: "fa.pages.home" },
      { href: "/fa/accounts", labelKey: "fa.pages.accounts" },
      { href: "/fa/journals", labelKey: "fa.pages.journals" },
      { href: "/fa/ledger", labelKey: "fa.pages.ledger" },
      { href: "/fa/periods", labelKey: "fa.pages.periods" },
      { href: "/fa/recurring", labelKey: "fa.pages.recurring" },
      { href: "/fa/settings", labelKey: "fa.pages.settings" },
    ],
  },
]
