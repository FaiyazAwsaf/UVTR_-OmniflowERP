import type { SweepJob } from "@/core/clock/types"

import { sendDueSchedules } from "./commands"

/**
 * IRT time-driven sweeper jobs (implementation_plan.md §3.13): `irt.schedules`
 * "sends" every due report schedule (an `emails` row and ReportEmailed,
 * simulated). Idempotent: a sent schedule moves its next due time forward in
 * the same commit, so a second sweep finds nothing due.
 */
export const irtJobs: SweepJob[] = [
  {
    id: "irt.schedules",
    async run(ctx) {
      const due = await ctx.db.reportSchedules
        .where("nextDueAt")
        .belowOrEqual(ctx.now)
        .filter((s) => s.active)
        .toArray()
      if (due.length) await ctx.commitSystem(sendDueSchedules, { ids: due.map((s) => s.id) })
    },
  },
]
