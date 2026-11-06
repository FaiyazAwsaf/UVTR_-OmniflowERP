import type { SweepJob } from "@/core/clock/types"
import { securityJobs } from "@/core/security/signin"
import { faJobs } from "@/modules/fa/jobs"
import { apJobs } from "@/modules/ap/jobs"
import { arJobs } from "@/modules/ar/jobs"
import { cabJobs } from "@/modules/cab/jobs"
import { parJobs } from "@/modules/par/jobs"
import { frsJobs } from "@/modules/frs/jobs"
import { stlJobs } from "@/modules/stl/jobs"
import { siJobs } from "@/modules/si/jobs"
import { pcJobs } from "@/modules/pc/jobs"
import { sdJobs } from "@/modules/sd/jobs"
import { ptlJobs } from "@/modules/ptl/jobs"
import { pmJobs } from "@/modules/pm/jobs"
import { grnJobs } from "@/modules/grn/jobs"
import { stJobs } from "@/modules/st/jobs"
import { icJobs } from "@/modules/ic/jobs"
import { irtJobs } from "@/modules/irt/jobs"
import { sacJobs } from "@/modules/sac/jobs"
import { rbacJobs } from "@/modules/rbac/jobs"
import { dashboardJobs } from "@/modules/dashboard/jobs"
import { demoJobs } from "@/modules/demo/jobs"
import { commsJobs } from "@/modules/comms/jobs"

/** Every module's sweep jobs (implementation_plan.md §3.13). Only the main agent edits this file. */
export const SWEEP_JOBS: SweepJob[] = [
  ...securityJobs,
  ...faJobs,
  ...apJobs,
  ...arJobs,
  ...cabJobs,
  ...parJobs,
  ...frsJobs,
  ...stlJobs,
  ...siJobs,
  ...pcJobs,
  ...sdJobs,
  ...ptlJobs,
  ...pmJobs,
  ...grnJobs,
  ...stJobs,
  ...icJobs,
  ...irtJobs,
  ...sacJobs,
  ...rbacJobs,
  ...dashboardJobs,
  ...demoJobs,
  ...commsJobs,
]
