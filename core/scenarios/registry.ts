import type { ScenarioDef } from "@/core/scenarios/types"
import { faScenarios } from "@/modules/fa/scenarios"
import { apScenarios } from "@/modules/ap/scenarios"
import { arScenarios } from "@/modules/ar/scenarios"
import { cabScenarios } from "@/modules/cab/scenarios"
import { parScenarios } from "@/modules/par/scenarios"
import { frsScenarios } from "@/modules/frs/scenarios"
import { stlScenarios } from "@/modules/stl/scenarios"
import { siScenarios } from "@/modules/si/scenarios"
import { pcScenarios } from "@/modules/pc/scenarios"
import { sdScenarios } from "@/modules/sd/scenarios"
import { ptlScenarios } from "@/modules/ptl/scenarios"
import { pmScenarios } from "@/modules/pm/scenarios"
import { grnScenarios } from "@/modules/grn/scenarios"
import { stScenarios } from "@/modules/st/scenarios"
import { icScenarios } from "@/modules/ic/scenarios"
import { irtScenarios } from "@/modules/irt/scenarios"
import { sacScenarios } from "@/modules/sac/scenarios"
import { rbacScenarios } from "@/modules/rbac/scenarios"
import { dashboardScenarios } from "@/modules/dashboard/scenarios"
import { demoScenarios } from "@/modules/demo/scenarios"
import { commsScenarios } from "@/modules/comms/scenarios"

/** Every scenario launcher (implementation_plan.md §10). Only the main agent edits this file. */
export const SCENARIOS: ScenarioDef[] = [
  ...faScenarios,
  ...apScenarios,
  ...arScenarios,
  ...cabScenarios,
  ...parScenarios,
  ...frsScenarios,
  ...stlScenarios,
  ...siScenarios,
  ...pcScenarios,
  ...sdScenarios,
  ...ptlScenarios,
  ...pmScenarios,
  ...grnScenarios,
  ...stScenarios,
  ...icScenarios,
  ...irtScenarios,
  ...sacScenarios,
  ...rbacScenarios,
  ...dashboardScenarios,
  ...demoScenarios,
  ...commsScenarios,
]
