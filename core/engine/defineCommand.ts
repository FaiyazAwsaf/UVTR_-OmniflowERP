import type { z } from "zod"

import type { CommandDef } from "./types"

/**
 * Declare a command. Keeps the input schema, the permission key and the run
 * function together and fully typed:
 *
 *   export const issueInvoice = defineCommand({
 *     name: "si.issueInvoice",
 *     permission: "si.invoice.issue",
 *     input: z.object({ orderIds: z.array(z.string()), idempotencyKey: z.string() }),
 *     async run(tx, input) { ... },
 *   })
 */
export function defineCommand<S extends z.ZodType, O>(def: CommandDef<S, O>): CommandDef<S, O> {
  return def
}
