import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { OmniflowDb } from "@/core/db/database"
import { DATASETS } from "@/core/reports/datasets"
import { runReport } from "@/core/reports/runner"
import { siDatasetLoaders } from "@/modules/si/datasets"
import { stlDatasetLoaders } from "@/modules/stl/datasets"

import { seededDb } from "./helpers"

/**
 * The SDM report datasets on the small seed: every registered field is
 * present on the rows, figures are numbers, and each row links back to its
 * document (IRT drill-down).
 */

let db: OmniflowDb
beforeAll(async () => {
  db = await seededDb("datasets")
}, 120_000)
afterAll(async () => {
  await db.delete()
})

const loaders = { ...stlDatasetLoaders, ...siDatasetLoaders }

describe("SDM datasets", () => {
  for (const code of ["stl.orders", "stl.tasks", "stl.consumption", "si.invoiceLines", "si.invoices"]) {
    it(`${code} loads rows with every registered field`, async () => {
      const def = DATASETS.find((d) => d.code === code)!
      const rows = await loaders[code](db, {})
      expect(rows.length).toBeGreaterThan(0)
      for (const field of def.fields) expect(rows[0], field.key).toHaveProperty(field.key)
      for (const field of def.fields.filter((f) => f.type === "money")) expect(typeof rows[0][field.key]).toBe("number")
      const link = def.fields.find((f) => f.linkField)?.linkField
      if (link) expect(String(rows[0][link])).toMatch(/^\/(si|stl)\//)
    })
  }

  it("revenue by category and studio (IRT-16) adds up to the invoice lines' gross", async () => {
    const result = await runReport(db, {
      dataset: "si.invoiceLines",
      columns: ["category", "location", "grossP"],
      filters: [],
      groupBy: ["category", "location"],
      totals: ["grossP"],
    } as never, {})
    const rows = await siDatasetLoaders["si.invoiceLines"](db, {})
    expect(result.totals.grossP).toBe(rows.reduce((s, r) => s + Number(r.grossP), 0))
  })

  it("consumption variance is zero where the actual equals the recipe", async () => {
    const rows = await stlDatasetLoaders["stl.consumption"](db, {})
    const recipeOnly = rows.filter((r) => r.standardQty === r.actualQty)
    expect(recipeOnly.length).toBeGreaterThan(0)
    expect(recipeOnly.every((r) => r.varianceValueP === 0)).toBe(true)
  })
})
