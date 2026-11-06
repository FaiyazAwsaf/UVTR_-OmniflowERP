import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"

/**
 * Mark the signed-in user's in-app notifications read (all, or the given
 * ids). Any signed-in user, and only their own rows.
 */
export const markNotificationsRead = defineCommand({
  name: "notifications.markRead",
  permission: "authenticated",
  input: z.object({ ids: z.array(z.string()).optional() }),
  async run(tx, input) {
    const mine = await tx.list("notifications", "userId", tx.actor.userId)
    let count = 0
    for (const n of mine) {
      if (n.read || (input.ids && !input.ids.includes(n.id))) continue
      await tx.update("notifications", n.id, { read: true })
      count += 1
    }
    return { count }
  },
})
