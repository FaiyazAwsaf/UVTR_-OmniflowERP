import type { NavItem, PermissionDef } from "@/core/security/types"
import { faNav } from "@/modules/fa/nav"
import { faPermissions } from "@/modules/fa/permissions"
import { apNav } from "@/modules/ap/nav"
import { apPermissions } from "@/modules/ap/permissions"
import { arNav } from "@/modules/ar/nav"
import { arPermissions } from "@/modules/ar/permissions"
import { cabNav } from "@/modules/cab/nav"
import { cabPermissions } from "@/modules/cab/permissions"
import { parNav } from "@/modules/par/nav"
import { parPermissions } from "@/modules/par/permissions"
import { frsNav } from "@/modules/frs/nav"
import { frsPermissions } from "@/modules/frs/permissions"
import { stlNav } from "@/modules/stl/nav"
import { stlPermissions } from "@/modules/stl/permissions"
import { siNav } from "@/modules/si/nav"
import { siPermissions } from "@/modules/si/permissions"
import { pcNav } from "@/modules/pc/nav"
import { pcPermissions } from "@/modules/pc/permissions"
import { sdNav } from "@/modules/sd/nav"
import { sdPermissions } from "@/modules/sd/permissions"
import { ptlNav } from "@/modules/ptl/nav"
import { ptlPermissions } from "@/modules/ptl/permissions"
import { pmNav } from "@/modules/pm/nav"
import { pmPermissions } from "@/modules/pm/permissions"
import { grnNav } from "@/modules/grn/nav"
import { grnPermissions } from "@/modules/grn/permissions"
import { stNav } from "@/modules/st/nav"
import { stPermissions } from "@/modules/st/permissions"
import { icNav } from "@/modules/ic/nav"
import { icPermissions } from "@/modules/ic/permissions"
import { irtNav } from "@/modules/irt/nav"
import { irtPermissions } from "@/modules/irt/permissions"
import { sacNav } from "@/modules/sac/nav"
import { sacPermissions } from "@/modules/sac/permissions"
import { rbacNav } from "@/modules/rbac/nav"
import { rbacPermissions } from "@/modules/rbac/permissions"
import { dashboardNav } from "@/modules/dashboard/nav"
import { dashboardPermissions } from "@/modules/dashboard/permissions"

import { WORKSPACE_NAV } from "./workspace-nav"

/**
 * The permission catalogue (implementation_plan.md §3.9) and the sidebar,
 * merged from every module. Only the main agent edits this file.
 */
export const PERMISSIONS: PermissionDef[] = [
  ...faPermissions,
  ...apPermissions,
  ...arPermissions,
  ...cabPermissions,
  ...parPermissions,
  ...frsPermissions,
  ...stlPermissions,
  ...siPermissions,
  ...pcPermissions,
  ...sdPermissions,
  ...ptlPermissions,
  ...pmPermissions,
  ...grnPermissions,
  ...stPermissions,
  ...icPermissions,
  ...irtPermissions,
  ...sacPermissions,
  ...rbacPermissions,
  ...dashboardPermissions,
]

export const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDef> = new Map(
  PERMISSIONS.map((p) => [p.key, p])
)

export const NAV_ITEMS: NavItem[] = [
  ...WORKSPACE_NAV,
  ...faNav,
  ...apNav,
  ...arNav,
  ...cabNav,
  ...parNav,
  ...frsNav,
  ...stlNav,
  ...siNav,
  ...pcNav,
  ...sdNav,
  ...ptlNav,
  ...pmNav,
  ...grnNav,
  ...stNav,
  ...icNav,
  ...irtNav,
  ...sacNav,
  ...rbacNav,
  ...dashboardNav,
].sort((a, b) => a.order - b.order)

/** The 18 apps of the SME package, in suite order. */
export const APP_NAV: NavItem[] = NAV_ITEMS.filter((item) => item.app)
