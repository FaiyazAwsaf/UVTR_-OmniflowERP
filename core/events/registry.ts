import type { EventCatalog } from "@/core/events/types"
import { faEvents } from "@/modules/fa/events"
import { apEvents } from "@/modules/ap/events"
import { arEvents } from "@/modules/ar/events"
import { cabEvents } from "@/modules/cab/events"
import { parEvents } from "@/modules/par/events"
import { frsEvents } from "@/modules/frs/events"
import { stlEvents } from "@/modules/stl/events"
import { siEvents } from "@/modules/si/events"
import { pcEvents } from "@/modules/pc/events"
import { sdEvents } from "@/modules/sd/events"
import { ptlEvents } from "@/modules/ptl/events"
import { pmEvents } from "@/modules/pm/events"
import { grnEvents } from "@/modules/grn/events"
import { stEvents } from "@/modules/st/events"
import { icEvents } from "@/modules/ic/events"
import { irtEvents } from "@/modules/irt/events"
import { sacEvents } from "@/modules/sac/events"
import { rbacEvents } from "@/modules/rbac/events"
import { dashboardEvents } from "@/modules/dashboard/events"
import { demoEvents } from "@/modules/demo/events"
import { commsEvents } from "@/modules/comms/events"

/** The merged event catalog (implementation_plan.md §3.10). Only the main agent edits this file. */
export const EVENT_CATALOG: EventCatalog = {
  ...faEvents,
  ...apEvents,
  ...arEvents,
  ...cabEvents,
  ...parEvents,
  ...frsEvents,
  ...stlEvents,
  ...siEvents,
  ...pcEvents,
  ...sdEvents,
  ...ptlEvents,
  ...pmEvents,
  ...grnEvents,
  ...stEvents,
  ...icEvents,
  ...irtEvents,
  ...sacEvents,
  ...rbacEvents,
  ...dashboardEvents,
  ...demoEvents,
  ...commsEvents,
}
