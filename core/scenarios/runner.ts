import { z } from "zod"

import { now } from "@/core/clock/clock"
import { advanceClock } from "@/core/clock/control"
import { dhakaDate } from "@/core/clock/dates"
import { getCentralDb, type OmniflowDb } from "@/core/db/database"
import { newId } from "@/core/db/ids"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Actor, Tx } from "@/core/engine/types"

import type { ScenarioDef, ScenarioKit, ScenarioOutcome } from "./types"

/** Records that a launcher ran (plan §5.10), with the records it prepared. */
export const recordScenarioRun = defineCommand({
  name: "demo.recordScenarioRun",
  permission: "authenticated",
  input: z.object({
    scenarioId: z.string(),
    refs: z.record(z.string(), z.string()).default({}),
  }),
  async run(tx, input) {
    const row = tx.insert("scenarioRuns", {
      scenarioId: input.scenarioId,
      at: tx.now(),
      userId: tx.actor.userId,
      refs: input.refs,
    })
    tx.emit("ScenarioLaunched", {
      refs: input.refs,
      params: { scenario: input.scenarioId },
    })
    return { runId: row.id }
  },
})

/** The "Demo setup" identity that fixture commits run as. */
const SETUP_ACTOR: Actor = {
  userId: "demo-setup",
  username: "demo-setup",
  name: "Demo setup",
  nameBn: "ডেমো প্রস্তুতি",
  sessionId: null,
  locationId: null,
  locationIds: [],
}

/** A user's actor in a scenario session (reads the live users table). */
export async function scenarioActor(db: OmniflowDb, username: string, runId: string): Promise<Actor> {
  const [user] = await db.users.where("username").equals(username).toArray()
  if (!user) throw new Error(`Unknown user ${username}`)
  return {
    userId: user.id,
    username: user.username,
    name: user.nameEn,
    nameBn: user.nameBn,
    sessionId: `scenario:${runId}`,
    locationId: user.homeLocationId,
    locationIds: user.locationIds,
  }
}

export function createKit(scenario: ScenarioDef, db: OmniflowDb = getCentralDb()): ScenarioKit {
  const runId = newId("run")
  let fixtures = 0
  const kit: ScenarioKit = {
    scenarioId: scenario.id,
    runId,
    db,
    now: () => now(),
    today: () => dhakaDate(now()),
    actor: (username) => scenarioActor(db, username, runId),
    async run(def, input, as) {
      const actor = await scenarioActor(db, as, runId)
      return (await commit(def, input, { db, actor, scenarioSession: true })).result
    },
    async fixture<O>(label: string, write: (tx: Tx) => Promise<O>) {
      fixtures += 1
      const def = defineCommand({
        name: `demo.setup.${scenario.id}`,
        permission: "system",
        input: z.object({ label: z.string(), step: z.number() }),
        run: (tx) => write(tx),
      })
      return (await commit(def, { label, step: fixtures }, { db, actor: SETUP_ACTOR })).result
    },
    advanceClock: (ms) => advanceClock(ms),
  }
  return kit
}

export type ScenarioLaunch = {
  outcome: ScenarioOutcome
  route: string
  companionRoute?: string
}

/**
 * Runs a launcher's setup and records the run: the data side of a launch.
 * The window side (quick sign-in, cue card, navigation) is
 * `useScenarioLauncher` in the shell.
 */
export async function runScenario(
  scenario: ScenarioDef,
  db: OmniflowDb = getCentralDb()
): Promise<ScenarioLaunch> {
  const kit = createKit(scenario, db)
  const outcome = (scenario.setup ? await scenario.setup(kit) : undefined) ?? {}
  const refs = Object.fromEntries(
    Object.entries(outcome.refs ?? {}).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>
  await kit.run(recordScenarioRun, { scenarioId: scenario.id, refs }, scenario.user)
  return {
    outcome,
    route: scenario.route(outcome),
    companionRoute: scenario.companion?.route(outcome),
  }
}
