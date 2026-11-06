import type { OmniflowDb } from "@/core/db/database"
import type { Id, PartyRow, VehicleRow } from "@/core/db/schema"
import type { TableName } from "@/core/db/tables"
import type { AppCode } from "@/core/security/types"
import { latinDigits } from "@/lib/i18n/dmy"

import { DOC_PREFIXES, DOC_ROUTES, docHref } from "./doc-routes"

/**
 * The global search behind the command palette and the top-bar field
 * (plan §12 P1.11): parties by name (EN or BN), phone or code; vehicles by
 * registration in Latin or Bangla digits; documents by number in any format
 * of accounting_rules.md §5. Only results the user may open are returned
 * (the target app's view key, at the document's location).
 */

export type Can = (permission: string, locationId?: Id | null) => boolean

export type PartyHit = {
  kind: "party"
  id: Id
  code: string
  nameEn: string
  nameBn: string
  phone: string
  isCustomer: boolean
  isVendor: boolean
  href: string
}

export type VehicleHit = {
  kind: "vehicle"
  id: Id
  regNo: string
  make: string
  model: string
  partyNameEn: string
  partyNameBn: string
  href: string
}

export type DocHit = {
  kind: "doc"
  table: TableName
  id: Id
  docNo: string
  app: AppCode
  status?: string
  partyNameEn?: string
  partyNameBn?: string
  href: string
}

export type SearchResults = { parties: PartyHit[]; vehicles: VehicleHit[]; docs: DocHit[] }

export const EMPTY_RESULTS: SearchResults = { parties: [], vehicles: [], docs: [] }

const LIMIT = { parties: 6, vehicles: 6, docs: 8 }

/** Latin digits, trimmed and single-spaced: what every matcher starts from. */
export function normalizeQuery(query: string): string {
  return latinDigits(query).trim().replace(/\s+/g, " ")
}

/** A registration (or a query for one) without spaces, hyphens or dots, upper case, Latin digits. */
export function regKey(value: string): string {
  return latinDigits(value).toUpperCase().replace(/[\s\-.]/g, "")
}

/** Only the digits (phone matching). */
export function digitsOf(value: string): string {
  return latinDigits(value).replace(/\D/g, "")
}

/**
 * The tables a query may be a document number of, with the number to look
 * up (upper case, spaces read as hyphens: "inv gul 2627" is INV-GUL-2627).
 * A bare prefix without its hyphen ("PO") also counts.
 */
export function docTargets(query: string): { table: TableName; number: string }[] {
  const q = normalizeQuery(query).toUpperCase().replace(/ /g, "-")
  if (q.length < 2) return []
  const out: { table: TableName; number: string }[] = []
  for (const { prefixes, table } of DOC_PREFIXES) {
    for (const prefix of prefixes) {
      if (q.startsWith(prefix)) out.push({ table, number: q })
      else if (q === prefix.slice(0, -1)) out.push({ table, number: prefix })
    }
  }
  return out
}

function textMatch(haystack: string | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle)
}

function partyMatches(party: PartyRow, q: string): boolean {
  const lower = q.toLowerCase()
  if (textMatch(party.nameEn, lower) || textMatch(party.nameBn, q)) return true
  if (party.code.toLowerCase().startsWith(lower)) return true
  const digits = digitsOf(q)
  return digits.length >= 4 && digits.length === q.replace(/[\s\-+]/g, "").length
    ? digitsOf(party.phone).includes(digits)
    : false
}

function vehicleMatches(vehicle: VehicleRow, q: string): boolean {
  const key = regKey(q)
  if (key.length >= 2 && (regKey(vehicle.regNo).includes(key) || regKey(vehicle.regNoBn).includes(key))) {
    return true
  }
  const lower = q.toLowerCase()
  return lower.length >= 3 && (textMatch(vehicle.model, lower) || textMatch(vehicle.make, lower))
}

type AnyDoc = {
  id: Id
  status?: string
  locationId?: Id
  fromLocationId?: Id
  toLocationId?: Id
  partyId?: Id
  vendorId?: Id
} & Record<string, unknown>

function docAllowed(app: AppCode, doc: AnyDoc, can: Can): boolean {
  const key = `${app}.app.view`
  if (doc.locationId) return can(key, doc.locationId)
  if (doc.fromLocationId || doc.toLocationId) {
    return can(key, doc.fromLocationId) || can(key, doc.toLocationId)
  }
  return can(key)
}

async function searchDocs(db: OmniflowDb, query: string, can: Can): Promise<DocHit[]> {
  const found: { hit: DocHit; partyId?: Id }[] = []
  for (const { table, number } of docTargets(query)) {
    // Parties (C-, V-) are matched by code in their own group.
    if (table === "parties") continue
    const route = DOC_ROUTES[table]
    if (!route || !can(`${route.app}.app.view`)) continue
    const rows = (await db
      .table(table)
      .where(route.field)
      .startsWith(number)
      .reverse()
      .limit(LIMIT.docs * 2)
      .toArray()) as AnyDoc[]
    for (const row of rows) {
      if (!docAllowed(route.app, row, can)) continue
      const docNo = String(row[route.field] ?? "")
      found.push({
        hit: {
          kind: "doc",
          table,
          id: row.id,
          docNo,
          app: route.app,
          status: typeof row.status === "string" ? row.status : undefined,
          href: docHref(table, row.id, docNo) ?? route.list,
        },
        partyId: row.partyId ?? row.vendorId,
      })
      if (found.length >= LIMIT.docs) break
    }
    if (found.length >= LIMIT.docs) break
  }
  const ids = [...new Set(found.map((f) => f.partyId).filter((v): v is Id => !!v))]
  const parties = ids.length ? await db.parties.bulkGet(ids) : []
  const byId = new Map(parties.filter((p): p is PartyRow => !!p).map((p) => [p.id, p]))
  return found.map(({ hit, partyId }) => {
    const party = partyId ? byId.get(partyId) : undefined
    return party ? { ...hit, partyNameEn: party.nameEn, partyNameBn: party.nameBn } : hit
  })
}

/**
 * Run the global search. Robust to empty tables (before the seed fills
 * parties and documents) and to queries of any shape.
 */
export async function searchAll(db: OmniflowDb, query: string, can: Can): Promise<SearchResults> {
  const q = normalizeQuery(query)
  if (q.length < 2) return EMPTY_RESULTS
  const canParties = can("par.app.view")

  const [parties, vehicles, docs] = await Promise.all([
    canParties
      ? db.parties
          .filter((p) => partyMatches(p, q))
          .limit(LIMIT.parties)
          .toArray()
      : Promise.resolve([] as PartyRow[]),
    canParties
      ? db.vehicles
          .filter((v) => vehicleMatches(v, q))
          .limit(LIMIT.vehicles)
          .toArray()
      : Promise.resolve([] as VehicleRow[]),
    searchDocs(db, q, can),
  ])

  const owners = vehicles.length
    ? await db.parties.bulkGet([...new Set(vehicles.map((v) => v.partyId))])
    : []
  const ownerById = new Map(owners.filter((p): p is PartyRow => !!p).map((p) => [p.id, p]))

  return {
    parties: parties.map((p) => ({
      kind: "party",
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameBn: p.nameBn,
      phone: p.phone,
      isCustomer: p.isCustomer,
      isVendor: p.isVendor,
      href: `/par/${p.id}`,
    })),
    vehicles: vehicles.map((v) => ({
      kind: "vehicle",
      id: v.id,
      regNo: v.regNo,
      make: v.make,
      model: v.model,
      partyNameEn: ownerById.get(v.partyId)?.nameEn ?? "",
      partyNameBn: ownerById.get(v.partyId)?.nameBn ?? "",
      href: `/par/${v.partyId}`,
    })),
    docs,
  }
}
