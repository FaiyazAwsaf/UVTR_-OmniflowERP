import { coreBn } from "./core/bn"
import { faBn } from "@/modules/fa/i18n/bn"
import { apBn } from "@/modules/ap/i18n/bn"
import { arBn } from "@/modules/ar/i18n/bn"
import { cabBn } from "@/modules/cab/i18n/bn"
import { parBn } from "@/modules/par/i18n/bn"
import { frsBn } from "@/modules/frs/i18n/bn"
import { stlBn } from "@/modules/stl/i18n/bn"
import { siBn } from "@/modules/si/i18n/bn"
import { pcBn } from "@/modules/pc/i18n/bn"
import { sdBn } from "@/modules/sd/i18n/bn"
import { ptlBn } from "@/modules/ptl/i18n/bn"
import { pmBn } from "@/modules/pm/i18n/bn"
import { grnBn } from "@/modules/grn/i18n/bn"
import { stBn } from "@/modules/st/i18n/bn"
import { icBn } from "@/modules/ic/i18n/bn"
import { irtBn } from "@/modules/irt/i18n/bn"
import { sacBn } from "@/modules/sac/i18n/bn"
import { rbacBn } from "@/modules/rbac/i18n/bn"
import { dashboardBn } from "@/modules/dashboard/i18n/bn"
import { demoBn } from "@/modules/demo/i18n/bn"
import { commsBn } from "@/modules/comms/i18n/bn"
import type { Dictionary } from "./en"

/**
 * The Bangla dictionary, composed from namespaces: the shared core plus
 * one namespace per module (implementation_plan.md §3.15). It must match the English shape exactly.
 */
export const bn: Dictionary = {
  ...coreBn,
  ...faBn,
  ...apBn,
  ...arBn,
  ...cabBn,
  ...parBn,
  ...frsBn,
  ...stlBn,
  ...siBn,
  ...pcBn,
  ...sdBn,
  ...ptlBn,
  ...pmBn,
  ...grnBn,
  ...stBn,
  ...icBn,
  ...irtBn,
  ...sacBn,
  ...rbacBn,
  ...dashboardBn,
  ...demoBn,
  ...commsBn,
}
