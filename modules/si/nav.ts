import { FileText } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** SI in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const siNav: NavItem[] = [
  {
    app: "si",
    href: "/si",
    labelKey: "si.name",
    descriptionKey: "si.description",
    icon: FileText,
    group: "sdm",
    permission: "si.app.view",
    order: 220,
    sections: [
      { href: "/si", labelKey: "si.pages.home" },
      { href: "/si/counter", labelKey: "si.pages.counter", permission: "si.counter.checkout" },
      { href: "/si/new", labelKey: "si.pages.invoiceNew", permission: "si.invoice.issue" },
      { href: "/si/credit-notes", labelKey: "si.pages.creditNotes" },
    ],
  },
]
