import type { EventCatalog } from "@/core/events/types"

/** Comms emits no domain events (SMS rows are visible in the outbox). */
export const commsEvents: EventCatalog = {}
