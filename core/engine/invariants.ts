import { canonicalJson } from "@/core/audit/chain"
import type { BaseRow } from "@/core/db/schema"
import { TABLE_SPECS, type TableName } from "@/core/db/tables"

import { BUSINESS_INVARIANTS } from "./business-invariants"
import { RuleViolation } from "./errors"
import type { Change, Tx } from "./types"

/**
 * Engine-enforced business rules (plan §3.3, INV-01 to INV-13). They run on
 * every commit's buffered changes before anything is written, whichever
 * command made them, so the database can never hold a state that breaks them.
 * Commands still check the same rules early to give precise messages; these
 * are the safety net that makes Consistency hold.
 *
 * Only the main agent edits this registry; a workstream that needs a new
 * invariant asks for it.
 */

export type InvariantContext = {
  tx: Tx
  /** Every buffered change of the commit */
  changes: readonly Change[]
  /** Changes to the invariant's tables only */
  relevant: readonly Change[]
  fail: (code: string, params?: Record<string, string | number>, audit?: boolean) => never
}

export type Invariant = {
  /** Plan rule id, e.g. "INV-02" */
  id: string
  /** Tables whose changes trigger the check */
  tables: readonly TableName[]
  check: (ctx: InvariantContext) => void | Promise<void>
}

/** Fields that changed between two rows, ignoring engine-owned fields. */
export function changedFields(before: BaseRow, after: BaseRow): string[] {
  const ignore = new Set(["version", "updatedAt", "updatedBy"])
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: string[] = []
  for (const key of keys) {
    if (ignore.has(key)) continue
    const a = (before as Record<string, unknown>)[key]
    const b = (after as Record<string, unknown>)[key]
    // Canonical form: key order inside nested objects must not count as a change.
    if (canonicalJson(a ?? null) !== canonicalJson(b ?? null)) out.push(key)
  }
  return out
}

const IMMUTABLE_TABLES = (Object.keys(TABLE_SPECS) as TableName[]).filter(
  (t) => TABLE_SPECS[t].immutableAfter !== undefined
)

/** INV-06: posted documents and journals are immutable except their declared mutable fields. */
const inv06: Invariant = {
  id: "INV-06",
  tables: IMMUTABLE_TABLES,
  check({ relevant, fail }) {
    for (const change of relevant) {
      if (change.kind === "insert" || !change.before) continue
      const spec = TABLE_SPECS[change.table]
      const status = (change.before as unknown as { status?: string }).status
      const frozen =
        spec.immutableAfter === "always" ||
        (status !== undefined && (spec.immutableAfter as readonly string[]).includes(status))
      if (!frozen) continue
      if (change.kind === "delete") {
        fail("IMMUTABLE_DOCUMENT", { table: change.table, id: change.id }, true)
      }
      const allowed = new Set(spec.mutableFields ?? [])
      const blocked = changedFields(change.before, change.after!).filter((f) => !allowed.has(f))
      if (blocked.length) {
        fail(
          "IMMUTABLE_DOCUMENT",
          { table: change.table, id: change.id, field: blocked[0] },
          true
        )
      }
    }
  },
}

const INVARIANTS: Invariant[] = [inv06]
registerInvariants(BUSINESS_INVARIANTS)

/** Add invariants from a core module (ledger, stock, approvals). Idempotent by id. */
export function registerInvariants(list: Invariant[]): void {
  for (const inv of list) {
    const at = INVARIANTS.findIndex((i) => i.id === inv.id)
    if (at >= 0) INVARIANTS[at] = inv
    else INVARIANTS.push(inv)
  }
}

export function invariantIds(): string[] {
  return INVARIANTS.map((i) => i.id)
}

/** Runs every invariant whose tables the commit touched. Throws RuleViolation. */
export async function runInvariants(tx: Tx): Promise<void> {
  const changes = tx.changes()
  if (!changes.length) return
  const touched = new Set(changes.map((c) => c.table))
  const fail = (code: string, params: Record<string, string | number> = {}, audit = false): never => {
    throw new RuleViolation(code, params, audit)
  }
  for (const inv of INVARIANTS) {
    if (!inv.tables.some((t) => touched.has(t))) continue
    const tableSet = new Set<string>(inv.tables)
    const relevant = changes.filter((c) => tableSet.has(c.table))
    await inv.check({ tx, changes, relevant, fail })
  }
}
