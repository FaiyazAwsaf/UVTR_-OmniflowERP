import { coreEn } from "./core/en"
import { reportsEn } from "./core/reports.en"
import { sharedEn } from "./core/shared.en"
import { faEn } from "@/modules/fa/i18n/en"
import { apEn } from "@/modules/ap/i18n/en"
import { arEn } from "@/modules/ar/i18n/en"
import { cabEn } from "@/modules/cab/i18n/en"
import { parEn } from "@/modules/par/i18n/en"
import { frsEn } from "@/modules/frs/i18n/en"
import { stlEn } from "@/modules/stl/i18n/en"
import { siEn } from "@/modules/si/i18n/en"
import { pcEn } from "@/modules/pc/i18n/en"
import { sdEn } from "@/modules/sd/i18n/en"
import { ptlEn } from "@/modules/ptl/i18n/en"
import { pmEn } from "@/modules/pm/i18n/en"
import { grnEn } from "@/modules/grn/i18n/en"
import { stEn } from "@/modules/st/i18n/en"
import { icEn } from "@/modules/ic/i18n/en"
import { irtEn } from "@/modules/irt/i18n/en"
import { sacEn } from "@/modules/sac/i18n/en"
import { rbacEn } from "@/modules/rbac/i18n/en"
import { dashboardEn } from "@/modules/dashboard/i18n/en"
import { demoEn } from "@/modules/demo/i18n/en"
import { commsEn } from "@/modules/comms/i18n/en"

/**
 * The English dictionary, composed from namespaces: the shared core plus
 * one namespace per module (implementation_plan.md §3.15).
 */
export const en = {
  ...coreEn,
  ...reportsEn,
  ...sharedEn,
  ...faEn,
  ...apEn,
  ...arEn,
  ...cabEn,
  ...parEn,
  ...frsEn,
  ...stlEn,
  ...siEn,
  ...pcEn,
  ...sdEn,
  ...ptlEn,
  ...pmEn,
  ...grnEn,
  ...stEn,
  ...icEn,
  ...irtEn,
  ...sacEn,
  ...rbacEn,
  ...dashboardEn,
  ...demoEn,
  ...commsEn,
}

export type Dictionary = typeof en
