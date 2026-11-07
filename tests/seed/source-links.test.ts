import { describe, expect, it } from "vitest"

import { DOC_ROUTE_TYPES, docHref } from "@/components/shared/doc-routes"
import type { TableName } from "@/core/db/tables"

import { built, rows } from "./helpers"

/**
 * Checkpoint 2 ("every posting shows in FA with its source link"): every
 * voucher that names a source document links to a screen, and that document
 * exists. Seeded summary vouchers (opening balances, daily summaries) carry
 * no source and open as vouchers.
 */
describe("voucher source links", () => {
  for (const scale of ["full", "small"] as const) {
    it(`every seeded voucher's source has a route and a record (${scale})`, () => {
      const { bag } = built(scale)
      const journals = rows(bag, "journals")
      const noRoute = new Set<string>()
      const missing: string[] = []
      const ids = new Map<string, Set<string>>()
      const has = (table: string, id: string) => {
        if (!ids.has(table)) ids.set(table, new Set(bag.all(table as TableName).map((r) => r.id)))
        return ids.get(table)!.has(id)
      }
      for (const j of journals) {
        if (!j.source || j.source.docType === "journals") continue
        if (!docHref(j.source.docType, j.source.docId)) {
          noRoute.add(j.source.docType)
          continue
        }
        if (!has(j.source.docType, j.source.docId)) missing.push(`${j.journalNo} -> ${j.source.docType}/${j.source.docId}`)
      }
      expect([...noRoute], `routes exist for ${DOC_ROUTE_TYPES.length} types`).toEqual([])
      expect(missing.slice(0, 10)).toEqual([])
      expect(journals.filter((j) => j.source).length).toBeGreaterThan(0)
    })
  }
})
