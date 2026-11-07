import { rules } from "@/config/rules.config"
import { chainAudit, GENESIS_HASH } from "@/core/audit/chain"
import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { getControlDb } from "@/core/db/control"
import {
  clearDatabase,
  getCentralDb,
  type OmniflowDb,
} from "@/core/db/database"
import { newId } from "@/core/db/ids"
import type { EventRow } from "@/core/db/schema"
import { toActorRef } from "@/core/engine/commit"
import { commitLockName, withLock } from "@/core/engine/locks"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { publish } from "@/core/events/bus"
import { EVENT_CATALOG } from "@/core/events/registry"
import { seedDatabase } from "@/core/seed"
import type { SeedSummary } from "@/core/seed/types"

/** Bump when the seed changes shape, so stale browsers re-seed on load. */
export const SEED_VERSION = 3
const SEED_LOCK = "of:seed"

/** The genesis audit row and the DemoReset event (plan §7). */
export async function writeGenesis(
  db: OmniflowDb,
  summary: SeedSummary
): Promise<void> {
  const at = now()
  const commitId = newId("cm")
  const actor = toActorRef(SYSTEM_ACTOR)
  const [genesis] = chainAudit(
    [
      {
        commitId,
        command: "demo.reset",
        app: "demo",
        at,
        actor,
        action: "system",
        entity: "demo",
        entityId: "seed",
        after: { seedVersion: SEED_VERSION, counts: summary.counts },
        origin: "central",
      },
    ],
    { seq: 0, hash: GENESIS_HASH }
  )
  const def = EVENT_CATALOG.DemoReset
  const event: EventRow = {
    seq: 1,
    id: newId("ev"),
    type: "DemoReset",
    v: 1,
    at,
    realAt: Date.now(),
    actor,
    locationId: null,
    app: "demo",
    refs: {},
    summaryKey: def?.labelKey ?? "events.DemoReset",
    params: {},
    consumers: def?.consumers ?? [],
    commitId,
    command: "demo.reset",
    origin: "central",
  }
  await db.transaction("rw", [db.audit, db.events], async () => {
    await db.audit.add(genesis)
    await db.events.add(event)
  })
}

/** Reset without taking the seed lock (callers hold it). */
async function resetUnlocked(): Promise<SeedSummary> {
  const central = getCentralDb()
  const control = getControlDb()
  return withLock(commitLockName(central.name), async () => {
    const started = performance.now()
    await clearDatabase(central)
    // Anchor the demo clock to opening time today (rules.openingTime, 10:30 Dhaka).
    const wall = Date.now()
    const offsetMs = atDhaka(dhakaDate(wall), rules.openingTime) - wall
    await control.clock.put({ id: "clock", offsetMs, updatedAt: wall })
    applyClockOffset(offsetMs)
    const at = now()
    const summary = await seedDatabase(central, {
      now: at,
      today: dhakaDate(at),
    })
    await writeGenesis(central, summary)
    await control.demoMeta.put({
      id: "meta",
      seedVersion: SEED_VERSION,
      seededAt: Date.now(),
      seedDate: dhakaDate(at),
      scale: "full",
      seedMs: Math.round(performance.now() - started),
    })
    return summary
  })
}

/**
 * One-click demo reset: wipes the store, sets the demo clock to opening time
 * today, re-seeds for that moment and tells every window to reload.
 */
export async function resetDemo(): Promise<SeedSummary> {
  const summary = await withLock(SEED_LOCK, resetUnlocked)
  publish({ kind: "reset" })
  return summary
}

/**
 * First load: seed if this browser has no data yet, or if the seed version is
 * stale. Safe to call from every window at once. Returns true if it seeded.
 */
export async function ensureSeeded(): Promise<boolean> {
  return withLock(SEED_LOCK, async () => {
    const control = getControlDb()
    const meta = await control.demoMeta.get("meta")
    const central = getCentralDb()
    const hasData = (await central.users.count()) > 0
    if (meta && meta.seedVersion === SEED_VERSION && hasData) return false
    await resetUnlocked()
    return true
  })
}
