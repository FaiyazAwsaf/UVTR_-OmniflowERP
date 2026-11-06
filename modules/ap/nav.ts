import { ReceiptText } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** AP in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const apNav: NavItem[] = [
  {
    app: "ap",
    href: "/ap",
    labelKey: "ap.name",
    descriptionKey: "ap.description",
    icon: ReceiptText,
    group: "fms",
    permission: "ap.app.view",
    order: 120,
    sections: [
      { href: "/ap", labelKey: "ap.pages.home" },
      { href: "/ap/bills", labelKey: "ap.pages.bills" },
      { href: "/ap/payments", labelKey: "ap.pages.payments" },
      { href: "/ap/aging", labelKey: "ap.pages.aging" },
      { href: "/ap/debit-notes", labelKey: "ap.pages.debitNotes" },
    ],
  },
]
