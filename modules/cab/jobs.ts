import { rules } from "@/config/rules.config"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { SweepJob } from "@/core/clock/types"

import { markPdcNotices } from "./commands"

/**
 * CAB time-driven sweeper jobs (implementation_plan.md §3.13).
 *
 * `cab.pdcDue`: post-dated cheques in hand that fall due within
 * `rules.pdcWarnDays` raise ONE notice to the users who handle cheques
 * (`cheques.dueNoticeAt`). Idempotent.
 */
export const cabJobs: SweepJob[] = [
  {
    id: "cab.pdcDue",
    async run(ctx) {
      const today = dhakaDate(ctx.now)
      const horizon = addDaysISO(today, rules.pdcWarnDays)
      const due = await ctx.db.cheques
        .where("status")
        .equals("in-hand")
        .filter((c) => c.direction === "received" && c.isPdc && !c.dueNoticeAt && c.chequeDate <= horizon)
        .toArray()
      if (due.length) await ctx.commitSystem(markPdcNotices, { chequeIds: due.map((c) => c.id) })
    },
  },
]
