import Dexie, { type Table } from "dexie"
import type { z } from "zod"

import { chainAudit, GENESIS_HASH, type UnchainedAudit } from "@/core/audit/chain"
import { now } from "@/core/clock/clock"
import type { OmniflowDb } from "@/core/db/database"
import { newId } from "@/core/db/ids"
import type { ActorRef, AuditRow, BaseRow, EventRow, Id, Ms } from "@/core/db/schema"
import { TABLE_SPECS, type TableName } from "@/core/db/tables"
import { publish } from "@/core/events/bus"
import { EVENT_CATALOG } from "@/core/events/registry"
import { resolveSecurity, SYSTEM_SECURITY } from "@/core/security/resolve"

import {
  ConflictError,
  NotFoundError,
  PermissionDenied,
  RuleViolation,
  ValidationError,
} from "./errors"
import { changedFields, runInvariants } from "./invariants"
import { commitLockName, withLock } from "./locks"
import { TxImpl } from "./tx"
import {
  isSystemActor,
  type Actor,
  type Change,
  type CommandDef,
  type CommitContext,
  type CommitResult,
  type SecurityContext,
  type Tx,
} from "./types"

/* ================================================================== *
 * Helpers
 * ================================================================== */

export function toActorRef(actor: Actor | ActorRef): ActorRef {
  const { userId, username, name, sessionId, locationId } = actor
  return { userId, username, name, sessionId, locationId }
}

/** The app a command belongs to: the prefix of its name ("si.checkout" → "si"). */
export function appOfCommand(command: string): string {
  return command.split(".")[0] ?? command
}

const BASE_KEYS = new Set(["id", "version", "createdAt", "updatedAt", "createdBy", "updatedBy", "origin"])

function domainFields(row: BaseRow): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (!BASE_KEYS.has(key)) out[key] = value
  }
  return out
}

function pick(row: BaseRow, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) out[field] = (row as Record<string, unknown>)[field]
  return out
}

function docNoOf(table: TableName, row: BaseRow | undefined): string | undefined {
  const field = TABLE_SPECS[table].docNoField
  if (!field || !row) return undefined
  const value = (row as Record<string, unknown>)[field]
  return typeof value === "string" && value ? value : undefined
}

/** Audit rows for a set of changes (before chaining). Unaudited tables are skipped. */
export function auditRowsFor(
  changes: readonly Change[],
  meta: {
    commitId: Id
    command: string
    at: Ms
    actor: ActorRef
    reason?: string
    approvedBy?: Id
  }
): UnchainedAudit[] {
  const rows: UnchainedAudit[] = []
  for (const change of changes) {
    if (TABLE_SPECS[change.table].audited === false) continue
    const common = {
      commitId: meta.commitId,
      command: meta.command,
      app: appOfCommand(meta.command),
      at: meta.at,
      actor: meta.actor,
      entity: change.table,
      entityId: change.id,
      docNo: docNoOf(change.table, change.after ?? change.before),
      reason: meta.reason,
      approvedBy: meta.approvedBy,
      origin: "central" as const,
    }
    if (change.kind === "insert" && change.after) {
      rows.push({ ...common, action: "insert", after: domainFields(change.after) })
    } else if (change.kind === "update" && change.before && change.after) {
      const fields = changedFields(change.before, change.after)
      if (!fields.length) continue
      rows.push({
        ...common,
        action: "update",
        before: pick(change.before, fields),
        after: pick(change.after, fields),
      })
    } else if (change.kind === "delete" && change.before) {
      rows.push({ ...common, action: "delete", before: domainFields(change.before) })
    }
  }
  return rows
}

type WriteMeta = {
  command: string
  actor: ActorRef
  idempotency?: { key: string; result: unknown }
}

/**
 * Apply one transaction's buffered changes, events, audit rows, counters and
 * idempotency record in ONE IndexedDB transaction. Must be called while
 * holding the commit lock.
 */
export async function writeCommit(db: OmniflowDb, tx: TxImpl, meta: WriteMeta): Promise<EventRow[]> {
  const changes = tx.changes()
  const at = tx.now()

  const lastEvent = await db.events.orderBy("seq").last()
  let seq = lastEvent?.seq ?? 0
  const events: EventRow[] = []
  for (const pending of tx.pendingEvents) {
    const def = EVENT_CATALOG[pending.type]
    const opts = pending.opts
    seq += 1
    events.push({
      seq,
      id: newId("ev"),
      type: pending.type,
      v: opts.v ?? 1,
      at,
      realAt: Date.now(),
      actor: meta.actor,
      locationId: opts.locationId !== undefined ? opts.locationId : meta.actor.locationId,
      app: def?.module ?? appOfCommand(meta.command),
      refs: opts.refs ?? {},
      summaryKey: def?.labelKey ?? `events.${pending.type}`,
      params: opts.params ?? {},
      consumers: def?.consumers ?? [],
      commitId: tx.commitId,
      command: meta.command,
      origin: "central",
    })
  }

  const lastAudit = await db.audit.orderBy("seq").last()
  const audit: AuditRow[] = chainAudit(
    auditRowsFor(changes, {
      commitId: tx.commitId,
      command: meta.command,
      at,
      actor: meta.actor,
      reason: tx.auditCtx.reason,
      approvedBy: tx.auditCtx.approvedBy,
    }),
    { seq: lastAudit?.seq ?? 0, hash: lastAudit?.hash ?? GENESIS_HASH }
  )

  const byTable = new Map<TableName, Change[]>()
  for (const change of changes) {
    const list = byTable.get(change.table) ?? []
    list.push(change)
    byTable.set(change.table, list)
  }

  const counters = [...tx.counters()].map(([id, value]) => ({ id, value }))
  const tables: Table[] = [...byTable.keys()].map((name) => db.t(name) as Table)
  tables.push(db.events, db.audit, db.counters)
  if (meta.idempotency) tables.push(db.idempotency)

  await db.transaction("rw", tables, async () => {
    for (const [name, list] of byTable) {
      const table = db.t(name)
      const puts = list.filter((c) => c.kind !== "delete").map((c) => c.after!)
      const deletes = list.filter((c) => c.kind === "delete").map((c) => c.id)
      if (puts.length) await table.bulkPut(puts as never[])
      if (deletes.length) await table.bulkDelete(deletes)
    }
    if (events.length) await db.events.bulkAdd(events)
    if (audit.length) await db.audit.bulkAdd(audit)
    if (counters.length) await db.counters.bulkPut(counters)
    if (meta.idempotency) {
      await db.idempotency.put({
        key: meta.idempotency.key,
        commitId: tx.commitId,
        command: meta.command,
        result: meta.idempotency.result,
        at,
      })
    }
  })
  return events
}

/** Insert-time guard: explicit ids must not collide with committed rows. */
async function checkNewIds(tx: TxImpl): Promise<void> {
  const byTable = new Map<TableName, Id[]>()
  for (const change of tx.changes()) {
    if (change.kind !== "insert") continue
    const ids = byTable.get(change.table) ?? []
    ids.push(change.id)
    byTable.set(change.table, ids)
  }
  for (const [table, ids] of byTable) {
    const existing = await tx.db.t(table).bulkGet(ids)
    const clash = existing.findIndex((row) => row !== undefined)
    if (clash >= 0) throw new RuleViolation("DUPLICATE_ID", { table, id: ids[clash] })
  }
}

function translateStorageError(error: unknown): unknown {
  if (error instanceof Dexie.ConstraintError || (error as Error)?.name === "ConstraintError") {
    return new RuleViolation("UNIQUE_CONSTRAINT", {
      detail: (error as Error).message?.slice(0, 120) ?? "",
    })
  }
  const inner = (error as { inner?: unknown } | null)?.inner
  if (error instanceof Dexie.AbortError && inner) {
    return translateStorageError(inner)
  }
  return error
}

export function publishCommit(
  db: OmniflowDb,
  command: string,
  actor: ActorRef,
  commitId: Id,
  events: EventRow[]
): void {
  publish({
    kind: "commit",
    db: db.name,
    commitId,
    command,
    userId: actor.userId,
    locationId: actor.locationId,
    events: events.map((e) => ({
      seq: e.seq,
      type: e.type,
      summaryKey: e.summaryKey,
      params: e.params,
      refs: e.refs,
      app: e.app,
    })),
  })
}

/* ================================================================== *
 * Blocked attempts (audited rejections)
 * ================================================================== */

/**
 * Records a refused attempt as its own tiny commit: one "blocked" audit row
 * and a RuleViolationBlocked (or PermissionDeniedBlocked) event. The refused
 * command itself wrote nothing.
 */
export async function recordBlocked(
  db: OmniflowDb,
  actor: Actor | ActorRef,
  command: string,
  code: string,
  params: Record<string, string | number>
): Promise<void> {
  const actorRef = toActorRef(actor)
  const commitId = newId("cm")
  const type = code === "PERMISSION_DENIED" ? "PermissionDeniedBlocked" : "RuleViolationBlocked"
  const events = await withLock(commitLockName(db.name), async () => {
    const at = now()
    const lastAudit = await db.audit.orderBy("seq").last()
    const lastEvent = await db.events.orderBy("seq").last()
    const [row] = chainAudit(
      [
        {
          commitId,
          command,
          app: appOfCommand(command),
          at,
          actor: actorRef,
          action: "blocked",
          entity: "command",
          entityId: command,
          after: params,
          code,
          origin: "central",
        },
      ],
      { seq: lastAudit?.seq ?? 0, hash: lastAudit?.hash ?? GENESIS_HASH }
    )
    const def = EVENT_CATALOG[type]
    const event: EventRow = {
      seq: (lastEvent?.seq ?? 0) + 1,
      id: newId("ev"),
      type,
      v: 1,
      at,
      realAt: Date.now(),
      actor: actorRef,
      locationId: actorRef.locationId,
      app: appOfCommand(command),
      refs: {},
      summaryKey: def?.labelKey ?? `events.${type}`,
      params: { code, command, ...params },
      consumers: def?.consumers ?? [],
      commitId,
      command,
      origin: "central",
    }
    await db.transaction("rw", [db.audit, db.events], async () => {
      await db.audit.add(row)
      await db.events.add(event)
    })
    return [event]
  })
  publishCommit(db, command, actorRef, commitId, events)
}

/* ================================================================== *
 * Live security (plan §3.3 changes 1 to 4)
 * ================================================================== */

function requiredKeys(permission: CommandDef<z.ZodType, unknown>["permission"]): string[] {
  if (permission === "authenticated" || permission === "system") return []
  return typeof permission === "string" ? [permission] : [...permission]
}

/**
 * Reads the actor's user, session, roles, grants and limits from the database
 * and refuses disabled or locked users, ended sessions and missing
 * permissions. Runs inside the commit lock so an RBAC change in another
 * window applies to the very next commit.
 */
async function authorize(
  db: OmniflowDb,
  def: CommandDef<z.ZodType, unknown>,
  ctx: CommitContext
): Promise<SecurityContext> {
  const { actor } = ctx
  if (isSystemActor(actor)) return SYSTEM_SECURITY
  if (def.permission === "system") {
    throw new PermissionDenied(def.name, actor.userId, ["system"])
  }
  const user = await db.users.get(actor.userId)
  if (!user) throw new RuleViolation("USER_UNKNOWN", { user: actor.username }, true)
  if (user.status === "disabled") throw new RuleViolation("USER_DISABLED", { user: user.username }, true)
  if (user.status === "locked") throw new RuleViolation("USER_LOCKED", { user: user.username }, true)

  const sessionId = actor.sessionId
  if (ctx.scenarioSession) {
    if (!sessionId?.startsWith("scenario:")) {
      throw new RuleViolation("SESSION_ENDED", { user: user.username }, true)
    }
  } else {
    const session = sessionId ? await db.sessions.get(sessionId) : undefined
    if (!session || session.endedAt !== undefined || session.userId !== user.id) {
      throw new RuleViolation("SESSION_ENDED", { user: user.username }, true)
    }
  }

  const security = await resolveSecurity(db, user.id)
  const keys = requiredKeys(def.permission)
  if (keys.length && !keys.some((key) => security.grants.has(key))) {
    throw new PermissionDenied(def.name, user.id, keys)
  }
  return security
}

/* ================================================================== *
 * commit()
 * ================================================================== */

function idempotencyKeyOf(input: unknown): string | undefined {
  if (input && typeof input === "object" && "idempotencyKey" in input) {
    const key = (input as { idempotencyKey?: unknown }).idempotencyKey
    return typeof key === "string" && key ? key : undefined
  }
  return undefined
}

/**
 * Run a command as one ACID transaction (plan §3.3): validate, take the
 * cross-window commit lock, check the user and the permission live, dedupe by
 * idempotency key, run against a buffered transaction, enforce invariants,
 * then write everything in one IndexedDB transaction and notify other windows.
 */
export async function commit<S extends z.ZodType, O>(
  def: CommandDef<S, O>,
  input: z.input<S>,
  ctx: CommitContext
): Promise<CommitResult<O>> {
  const { db, actor } = ctx

  const parsed = def.input.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(
      def.name,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    )
  }
  const data = parsed.data as z.output<S>

  const key = idempotencyKeyOf(data)
  let outcome: CommitResult<O>
  try {
    outcome = await withLock(commitLockName(db.name), async () => {
      const security = await authorize(db, def as CommandDef<z.ZodType, unknown>, ctx)
      if (key) {
        const prior = await db.idempotency.get(key)
        if (prior) {
          return {
            result: prior.result as O,
            commitId: prior.commitId,
            events: [],
            deduplicated: true,
          }
        }
      }
      const tx = new TxImpl(db, actor, newId("cm"), now(), def.name, def.permission, security)
      const result = await def.run(tx as Tx, data)
      await checkNewIds(tx)
      await runInvariants(tx)
      const events = await writeCommit(db, tx, {
        command: def.name,
        actor: toActorRef(actor),
        idempotency: key ? { key, result } : undefined,
      })
      return { result, commitId: tx.commitId, events, deduplicated: false }
    })
  } catch (error) {
    const translated = translateStorageError(error)
    if (translated instanceof PermissionDenied) {
      await recordBlocked(db, actor, def.name, "PERMISSION_DENIED", {
        permission: translated.permissions.join(", "),
      })
    } else if (translated instanceof RuleViolation && translated.audit) {
      await recordBlocked(db, actor, def.name, translated.code, translated.params)
    }
    throw translated
  }

  if (!outcome.deduplicated) {
    publishCommit(db, def.name, toActorRef(actor), outcome.commitId, outcome.events)
  }
  return outcome
}

/**
 * Engine-level activity stamp for a session (plan §3.8): a platform-table
 * write with no audit row, no version bump and no bus notice.
 */
export async function touchSession(db: OmniflowDb, sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { lastActivityRealAt: Date.now() })
}

export { ConflictError, NotFoundError, PermissionDenied, RuleViolation, ValidationError }
