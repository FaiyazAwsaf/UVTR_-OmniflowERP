import { Gauge } from "lucide-react"

import type { NavItem } from "@/core/security/types"

/** The executive dashboard, in the Workspace group (implementation_plan.md §9). */
export const dashboardNav: NavItem[] = [
  {
    href: "/dashboard",
    labelKey: "dashboard.name",
    icon: Gauge,
    group: "workspace",
    permission: "dashboard.app.view",
    order: 30,
  },
]
