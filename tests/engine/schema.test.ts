import { afterEach, describe, expect, it } from "vitest"

import { baseFields } from "@/core/db/base"
import { ControlDb } from "@/core/db/control"
import { createDb } from "@/core/db/database"
import type { StockBalanceRow, VehicleRow } from "@/core/db/schema"
import { stockBalanceId, TABLE_NAMES, TABLE_SPECS } from "@/core/db/tables"

const opened: { delete: () => Promise<void> }[] = []
afterEach(async () => {
  while (opened.length) await opened.pop()!.delete()
})

function vehicle(id: string, regNo: string): VehicleRow {
  return {
    ...baseFields(id, 1_000),
    partyId: "pty_1",
    regNo,
    regNoBn: regNo,
    make: "Toyota",
    model: "Axio",
    year: 2019,
    colour: "white",
    vehicleClass: "SD",
    active: true,
  }
}

describe("database schema", () => {
  it("opens the central database with every domain and platform table, and no edge stores", async () => {
    const db = createDb("test-central-open")
    opened.push(db)
    await db.open()
    const names = db.tables.map((t) => t.name)
    for (const name of TABLE_NAMES) expect(names).toContain(name)
    for (const name of ["events", "audit", "counters", "idempotency"]) expect(names).toContain(name)
    expect(names).not.toContain("outbox")
    expect(db.name).toBe("test-central-open")
  })

  it("declares immutability only with known statuses or always", () => {
    for (const name of TABLE_NAMES) {
      const spec = TABLE_SPECS[name]
      if (spec.immutableAfter === undefined) continue
      expect(spec.mutableFields).toBeDefined()
    }
    expect(TABLE_SPECS.journalLines.mutableFields).toEqual(["reconciledStatementLineId"])
    expect(TABLE_SPECS.sessions.audited).toBe(false)
  })

  it("supports unique, compound and nested-path indexes", async () => {
    const db = createDb("test-indexes")
    opened.push(db)
    await db.vehicles.bulkAdd([vehicle("v1", "DHAKA METRO-GA 27-4419"), vehicle("v2", "DHAKA METRO-KA 11-2034")])
    expect((await db.vehicles.where("regNo").equals("DHAKA METRO-KA 11-2034").first())?.id).toBe("v2")
    // The registration index is unique.
    await expect(db.vehicles.add(vehicle("v3", "DHAKA METRO-GA 27-4419"))).rejects.toThrow()

    const balance: StockBalanceRow = {
      ...baseFields(stockBalanceId("itm_a", "loc_gul", "bat_1"), 1_000),
      itemId: "itm_a",
      locationId: "loc_gul",
      batchId: "bat_1",
      qtyBase: 40,
      quarantinedQty: 0,
    }
    await db.stockBalances.add(balance)
    const hits = await db.stockBalances.where("[itemId+locationId]").equals(["itm_a", "loc_gul"]).toArray()
    expect(hits.map((h) => h.id)).toEqual(["sb:itm_a:loc_gul:bat_1"])
  })

  it("opens the control database", async () => {
    const control = new ControlDb("test-control")
    opened.push(control)
    await control.clock.put({ id: "clock", offsetMs: 900_000, updatedAt: 1 })
    expect((await control.clock.get("clock"))?.offsetMs).toBe(900_000)
  })
})
