import { z } from "zod"

import type { SweepJob } from "@/core/clock/types"
import { defineCommand } from "@/core/engine/defineCommand"

/** Simulated aggregator delay before a queued SMS reports delivered (plan §3.13). */
const DELIVERY_DELAY_MS = 2_000

const markDelivered = defineCommand({
  name: "comms.markDelivered",
  permission: "system",
  input: z.object({ ids: z.array(z.string()) }),
  async run(tx, input) {
    for (const id of input.ids) {
      const sms = await tx.get("sms", id)
      if (sms.status === "queued" || sms.status === "sent") {
        await tx.update("sms", id, { status: "delivered", deliveredAt: tx.now() })
      }
    }
  },
})

/** `comms.sms`: SMS queued → delivered after about 2 s (simulated). */
export const commsJobs: SweepJob[] = [
  {
    id: "comms.sms",
    async run(ctx) {
      const due = await ctx.db.sms
        .where("status")
        .equals("queued")
        .filter((sms) => ctx.now - sms.queuedAt >= DELIVERY_DELAY_MS)
        .toArray()
      if (due.length) await ctx.commitSystem(markDelivered, { ids: due.map((s) => s.id) })
    },
  },
]
