import { ArrowLeftRight } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** ST in the sidebar and on /apps, with its screens as tabs (implementation_plan.md §9). */
export const stNav: NavItem[] = [
  {
    app: "st",
    href: "/st",
    labelKey: "st.name",
    descriptionKey: "st.description",
    icon: ArrowLeftRight,
    group: "scm",
    permission: "st.app.view",
    order: 340,
    sections: [
      { href: "/st", labelKey: "st.pages.home" },
      { href: "/st/transfers", labelKey: "st.pages.transfers" },
      { href: "/st/adjustments", labelKey: "st.pages.adjustments" },
      { href: "/st/issues", labelKey: "st.pages.issues" },
    ],
  },
]
