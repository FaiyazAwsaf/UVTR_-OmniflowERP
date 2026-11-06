import { rules } from "@/config/rules.config"
import type { SweepJob } from "@/core/clock/types"

import { timeoutMfs } from "./commands"

/**
 * SI sweeper jobs (plan §3.13). `si.mfsTimeout`: a pending bKash or Nagad
 * receipt older than rules.mfsPendingTimeoutMin demo minutes times out;
 * nothing posts and its reservation is released (idempotent: only pending
 * receipts are picked up).
 */
export const siJobs: SweepJob[] = [
  {
    id: "si.mfsTimeout",
    async run(ctx) {
      const limitMs = rules.mfsPendingTimeoutMin * 60_000
      const due = await ctx.db.receipts
        .where("status")
        .equals("pending")
        .filter((r) => (r.method === "bkash" || r.method === "nagad") && ctx.now - r.at >= limitMs)
        .toArray()
      if (due.length) await ctx.commitSystem(timeoutMfs, { receiptIds: due.map((r) => r.id) })
    },
  },
]
