import { rules } from "@/config/rules.config"
import { dhakaDate } from "@/core/clock/dates"
import type { SweepJob } from "@/core/clock/types"

import { applyCreditHolds } from "./commands"
import { daysPastDue, invoiceOpenP } from "./lib"

/**
 * AR time-driven sweeper jobs (implementation_plan.md §3.13).
 *
 * `ar.creditHold`: a customer with an invoice more than
 * `rules.creditHoldOverdueDays` past its due date goes on hold once
 * (`parties.autoHoldAt`). Idempotent: it only commits when a party is due.
 */
export const arJobs: SweepJob[] = [
  {
    id: "ar.creditHold",
    async run(ctx) {
      const today = dhakaDate(ctx.now)
      const open = await ctx.db.salesInvoices.where("status").anyOf("posted", "partially-paid").toArray()
      const partyIds = new Set<string>()
      for (const inv of open) {
        if (invoiceOpenP(inv) > 0 && daysPastDue(inv.dueDate, today) > rules.creditHoldOverdueDays) partyIds.add(inv.partyId)
      }
      if (!partyIds.size) return
      const parties = await ctx.db.parties.bulkGet([...partyIds])
      const due = parties.filter((p) => p && p.status === "active" && !p.autoHoldAt).map((p) => p!.id)
      if (due.length) await ctx.commitSystem(applyCreditHolds, { partyIds: due })
    },
  },
]
