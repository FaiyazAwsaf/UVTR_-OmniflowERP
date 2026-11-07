import { rules } from "@/config/rules.config"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { SweepJob } from "@/core/clock/types"

import { markExpiry } from "./commands"

/**
 * `ic.expiryWatch` (plan §3.13): batches with stock that expire within
 * `rules.expiryWarnDays` raise ExpiryAlert once (`batches.expiryAlertAt`);
 * batches past their expiry become unusable (status expired), so FEFO skips
 * them. Idempotent: it commits only when something is due.
 */
export const icJobs: SweepJob[] = [
  {
    id: "ic.expiryWatch",
    async run(ctx) {
      const today = dhakaDate(ctx.now)
      const cutoff = addDaysISO(today, rules.expiryWarnDays)
      const due = await ctx.db.batches.where("expiry").belowOrEqual(cutoff).toArray()
      const alert: string[] = []
      const expire: string[] = []
      for (const batch of due) {
        if (!batch.expiry) continue
        if (batch.status === "ok" && batch.expiry < today) expire.push(batch.id)
        if (batch.expiryAlertAt || batch.status === "expired") continue
        const balances = await ctx.db.stockBalances.where("batchId").equals(batch.id).toArray()
        if (balances.some((b) => b.qtyBase + b.quarantinedQty > 0)) alert.push(batch.id)
      }
      if (alert.length || expire.length) await ctx.commitSystem(markExpiry, { alert, expire })
    },
  },
]
