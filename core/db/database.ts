import Dexie, { type Table } from "dexie"

import type { AuditRow, CounterRow, EventRow, IdempotencyRow } from "./schema"
import {
  PLATFORM_STORES,
  TABLE_NAMES,
  TABLE_SPECS,
  type TableName,
  type TableRows,
} from "./tables"

/**
 * Bump when TABLE_SPECS or the platform stores change. The demo re-seeds on
 * reset, so no data migration is needed: an upgrade clears and re-seeds.
 */
export const SCHEMA_VERSION = 1

export const CENTRAL_DB_NAME = "omniflow-central"

export type DomainTables = {
  [T in TableName]: Table<TableRows[T], string>
}

function stores(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of TABLE_NAMES) out[name] = TABLE_SPECS[name].indexes
  Object.assign(out, PLATFORM_STORES)
  return out
}

// Declaration merging: Dexie creates one property per declared table, so the
// domain tables are typed as instance properties (db.parties, db.journals, ...).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export interface OmniflowDb extends DomainTables {}

/** The one data database (plan §3.2, D4: no edge stores). */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class OmniflowDb extends Dexie {
  events!: Table<EventRow, number>
  audit!: Table<AuditRow, number>
  counters!: Table<CounterRow, string>
  idempotency!: Table<IdempotencyRow, string>

  constructor(name: string = CENTRAL_DB_NAME) {
    // Strict durability: a commit is on disk before IndexedDB reports success.
    super(name, { chromeTransactionDurability: "strict" })
    this.version(SCHEMA_VERSION).stores(stores())
  }

  /** Typed access to a domain table by name. */
  t<T extends TableName>(name: T): Table<TableRows[T], string> {
    return this.table(name) as unknown as Table<TableRows[T], string>
  }
}

const instances = new Map<string, OmniflowDb>()

/** The shared central database (one connection per window). */
export function getCentralDb(): OmniflowDb {
  let db = instances.get(CENTRAL_DB_NAME)
  if (!db) {
    db = new OmniflowDb(CENTRAL_DB_NAME)
    instances.set(CENTRAL_DB_NAME, db)
  }
  return db
}

/** Test hook: a database with its own name (fake-indexeddb per test). */
export function createDb(name: string): OmniflowDb {
  return new OmniflowDb(name)
}

/** Close and forget a cached connection (before deleting its database). */
export function forgetDb(name: string): void {
  const db = instances.get(name)
  if (db) {
    db.close()
    instances.delete(name)
  }
}

/** Empty every table of a database in one transaction (demo reset). */
export async function clearDatabase(db: OmniflowDb): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}
