import type { z } from "zod"

import type { OmniflowDb } from "@/core/db/database"
import type { ISODate, Ms, Refs } from "@/core/db/schema"
import type { Actor, CommandDef, Tx } from "@/core/engine/types"

/**
 * What a launcher's setup returns: the records it prepared (saved on the
 * `scenarioRuns` row and handed to `route`), plus display values for the cue
 * card and the route (a registration, a document number, an amount).
 */
export type ScenarioOutcome = {
  refs?: Refs
  params?: Record<string, string | number>
}

/**
 * The toolkit a launcher's setup works with (plan §10). Every write goes
 * through the engine, so setups are validated, permission-checked, audited,
 * synced to other windows and visible in the event stream like any other work.
 *
 * Setups must succeed when run twice in a row: create fresh records, and
 * clear what a previous run left in the way with real commands (re-run rules).
 */
export type ScenarioKit = {
  readonly scenarioId: string
  readonly runId: string
  readonly db: OmniflowDb
  /** Demo-clock time */
  now(): Ms
  /** Dhaka calendar day of `now()` */
  today(): ISODate
  /** The acting identity of a user (by username) in a scenario session */
  actor(username: string): Promise<Actor>
  /**
   * Run a real command as a user (by username), in a "scenario:<runId>"
   * session: the engine still checks the user's status, permissions, limits
   * and scope. Refusals throw (RuleViolation etc.).
   */
  run<S extends z.ZodType, O>(def: CommandDef<S, O>, input: z.input<S>, as: string): Promise<O>
  /**
   * Audited direct writes in one engine commit named `demo.setup.<id>`, ONLY
   * for what no command can do (plan §10: topping up planted stock,
   * superseding a statement). Invariants still apply. Runs as "Demo setup".
   */
  fixture<O>(label: string, write: (tx: Tx) => Promise<O>): Promise<O>
  /** Move the shared demo clock (all windows follow) */
  advanceClock(ms: number): Promise<void>
}

/** A scenario launcher (E1 to E16) or a main-journey jump launcher (J1 to J6). */
export type ScenarioDef = {
  /** Stable id: "J1".."J6", "E1".."E16" */
  id: string
  kind: "scenario" | "jump"
  /** Owning module; its `<module>.name` groups the launcher in the panel */
  module: string
  /** i18n key of the launcher title */
  titleKey: string
  /** i18n key of one line on what it proves (shown under the title) */
  summaryKey?: string
  /** Username this window signs in as (quick demo sign-in) */
  user: string
  /** Prepares fresh data. Omit when the scenario needs no data. */
  setup?: (kit: ScenarioKit) => Promise<ScenarioOutcome | void>
  /** Where the window goes afterwards */
  route: (outcome: ScenarioOutcome) => string
  /** i18n keys of the cue-card steps; they may use `params` placeholders */
  cueKeys: string[]
  /**
   * Optional second pane on the Demo Wall (E13, E15): a user and route for
   * another window in the same story.
   */
  companion?: { user: string; route: (outcome: ScenarioOutcome) => string }
}
