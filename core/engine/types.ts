import type { z } from "zod"

import type { OmniflowDb } from "@/core/db/database"
import type {
  ActorRef,
  BaseField,
  BaseRow,
  EventRow,
  FiscalYearRow,
  ISODate,
  Id,
  Ms,
  Origin,
  PeriodRow,
  Refs,
} from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"
import type { ApprovalKind, CommandPermission, Scope } from "@/core/security/types"

/**
 * Who is committing (plan §3.3): the window's signed-in user, a scenario
 * session, or the system (sweeper, seed, the sign-in flow).
 */
export type Actor = {
  userId: Id
  username: string
  name: string
  nameBn: string
  /** The window's sessions row, "scenario:<runId>", or null for the system */
  sessionId: string | null
  /** Current location (new documents take it) */
  locationId: Id | null
  /** Every location the user may work at */
  locationIds: Id[]
}

export const SYSTEM_ACTOR: Actor = {
  userId: "system",
  username: "system",
  name: "System",
  nameBn: "সিস্টেম",
  sessionId: null,
  locationId: null,
  locationIds: [],
}

export function isSystemActor(actor: Pick<Actor, "userId">): boolean {
  return actor.userId === "system" || actor.userId === "demo-setup"
}

/**
 * The actor's effective security, read live from the database at the start
 * of each commit (plan §3.3 change 3) and by the `usePermissions` hook.
 */
export type SecurityContext = {
  /** Best scope per granted key ("all" wins over "own-location") */
  grants: ReadonlyMap<string, Scope>
  /** Highest limit across the user's roles; Infinity for unlimited, 0 for none */
  limits: Readonly<Record<ApprovalKind, number>>
  roleIds: readonly Id[]
  roleCodes: readonly string[]
  /** True for the system actor: every key, unlimited */
  all: boolean
}

/** Insert input: domain fields; `id` optional (generated when absent). */
export type NewRow<T extends TableName> = Omit<Row<T>, BaseField> & {
  id?: Id
}

/** Update input: any subset of domain fields. */
export type Patch<T extends TableName> = Partial<Omit<Row<T>, BaseField>>

/** A value an index can be matched against (compound indexes take arrays). */
export type IndexValue = string | number | boolean | (string | number)[]

export type EmitOptions = {
  refs?: Refs
  /** Values for the event's i18n summary */
  params?: Record<string, string | number>
  /** Defaults to the actor's current location */
  locationId?: Id | null
  /** Event schema version (default 1) */
  v?: number
}

/** One buffered change in a transaction. */
export type Change = {
  table: TableName
  id: Id
  kind: "insert" | "update" | "delete"
  /** Committed row before this transaction (update and delete) */
  before?: BaseRow
  /** Row after this transaction (insert and update) */
  after?: BaseRow
}

export type FiscalInfo = {
  date: ISODate
  /** "2627" */
  tag: string
  year: FiscalYearRow | undefined
  period: PeriodRow | undefined
}

/**
 * The transaction a command runs in (plan §3.3). Reads see committed data plus
 * this transaction's own buffered writes; writes are buffered and applied
 * atomically only if the command, and every invariant, succeeds.
 *
 * Inside `run()`, await only `tx.*` calls: no fetch, timers or crypto.subtle.
 */
export interface Tx {
  readonly commitId: Id
  readonly actor: Actor
  /** Read-only use: for indexed queries beyond `list()` (committed data only) */
  readonly db: OmniflowDb
  readonly origin: Origin
  /** The running command's name and declared permission */
  readonly command: string
  readonly permission: CommandPermission

  /** Demo-clock time, fixed for the whole transaction. */
  now(): Ms
  /** Dhaka calendar day of `now()`. */
  today(): ISODate

  /** Row by id, or throws NotFoundError. `expectedVersion` throws ConflictError when stale. */
  get<T extends TableName>(table: T, id: Id, opts?: { expectedVersion?: number }): Promise<Row<T>>
  /** Row by id, or undefined. */
  find<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined>
  /** Rows whose `index` equals `value` (e.g. "partyId", "[itemId+locationId]"). */
  list<T extends TableName>(table: T, index: string, value: IndexValue): Promise<Row<T>[]>
  /** Every row of a table (small tables only). */
  all<T extends TableName>(table: T): Promise<Row<T>[]>

  /** Buffer an insert; returns the complete row (base fields filled). */
  insert<T extends TableName>(table: T, row: NewRow<T>): Row<T>
  /** Buffer an update; returns the updated row. */
  update<T extends TableName>(
    table: T,
    id: Id,
    patch: Patch<T>,
    opts?: { expectedVersion?: number }
  ): Promise<Row<T>>
  /** Insert or replace a row with a known id (stock tables, settings). */
  upsert<T extends TableName>(table: T, row: NewRow<T> & { id: Id }): Promise<Row<T>>
  /** Buffer a delete (only tables marked deletable). */
  remove<T extends TableName>(table: T, id: Id): Promise<void>

  /** Record a domain event (label and consumers come from the catalog). */
  emit(type: string, opts?: EmitOptions): void
  /** Refuse the whole commit with a rule code. */
  reject(code: string, params?: Record<string, string | number>, opts?: { audit?: boolean }): never
  /** Next integer for a counter key (see core/docs/numbering.ts). */
  nextNumber(key: string): Promise<number>
  /** Reason and approver recorded on this commit's audit rows. */
  auditContext(ctx: { reason?: string; approvedBy?: Id }): void
  /** The buffered changes so far (used by invariants). */
  changes(): readonly Change[]

  /* ---- security (plan §3.3 change 5) ---- */

  /** The actor holds `permission` (at `locationId` when given). */
  can(permission: string, locationId?: Id | null): boolean
  /**
   * Refuses with OUT_OF_SCOPE when the command's permission is granted to the
   * actor only for their own location(s) and `locationId` is not one of them.
   */
  requireLocation(locationId: Id | null | undefined): void
  /** The actor's approval limit for a kind: Infinity unlimited, 0 none. */
  limit(kind: ApprovalKind): number
  /** The actor's effective security for this commit. */
  readonly security: SecurityContext
  /** Fiscal year and period of a day (default today). */
  fiscal(date?: ISODate): Promise<FiscalInfo>
}

export type CommandDef<S extends z.ZodType, O> = {
  /** Namespaced name, e.g. "si.issueInvoice" */
  name: string
  /** A key from the catalogue (§3.9), any of several, "authenticated" or "system" */
  permission: CommandPermission
  input: S
  run: (tx: Tx, input: z.output<S>) => Promise<O>
}

export type CommitResult<O> = {
  result: O
  commitId: Id
  events: EventRow[]
  /** True when the idempotency key matched an earlier commit */
  deduplicated: boolean
}

export type CommitContext = {
  db: OmniflowDb
  actor: Actor
  /**
   * Set only by the scenario runner (and tests): the actor's session is a
   * "scenario:<runId>" session with no sessions row. User status,
   * permissions, limits and scope are still checked.
   */
  scenarioSession?: boolean
}

export type { ActorRef }
