import Dexie, { type Table } from "dexie"

import type { ClockRow, DemoMetaRow } from "./schema"

export const CONTROL_DB_NAME = "omniflow-control"

/**
 * Demo controls shared by every window: the demo clock offset and seed
 * metadata (plan §3.2). No domain data lives here.
 */
export class ControlDb extends Dexie {
  clock!: Table<ClockRow, string>
  demoMeta!: Table<DemoMetaRow, string>

  constructor(name: string = CONTROL_DB_NAME) {
    super(name, { chromeTransactionDurability: "strict" })
    this.version(1).stores({
      clock: "id",
      demoMeta: "id",
    })
  }
}

let control: ControlDb | null = null

export function getControlDb(): ControlDb {
  if (!control) control = new ControlDb()
  return control
}

/** Test hook: point the control DB at a fresh name. */
export function setControlDbForTests(db: ControlDb): void {
  control = db
}
