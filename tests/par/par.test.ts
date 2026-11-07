import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { OmniflowDb } from "@/core/db/database"
import { ConflictError, PermissionDenied, RuleViolation } from "@/core/engine/errors"
import type { Actor } from "@/core/engine/types"
import { findLikelyDuplicates } from "@/core/search/fuzzy"
import { addVehicle, createParty, setPartyStatus, updateParty, updateVehicle } from "@/modules/par/commands"
import { normalizeRegNo, regNoToBangla, regSearchKey } from "@/modules/par/lib"

import { finDb, run, T } from "../ar/fin-helpers"
import { signedIn } from "../helpers/foundation"

let db: OmniflowDb
let nayeem: Actor
let farzana: Actor
beforeEach(async () => {
  db = await finDb("par")
  nayeem = await signedIn(db, "nayeem")
  farzana = await signedIn(db, "farzana")
})
afterEach(async () => {
  await db.delete()
})

const customer = (over: Record<string, unknown> = {}) => ({
  isCustomer: true,
  isVendor: false,
  type: "individual" as const,
  nameEn: "Rumana Akter",
  segment: "retail" as const,
  phone: "01712-345678",
  ...over,
})

describe("par.createParty", () => {
  it("creates a customer with the next C- code and emits PartyCreated", async () => {
    const r = await run(db, createParty, customer(), nayeem)
    expect(r.code).toMatch(/^C-\d{6}$/)
    const party = await db.parties.get(r.partyId)
    expect(party).toMatchObject({ nameEn: "Rumana Akter", nameBn: "Rumana Akter", status: "active", creditLimitP: 0 })
    const events = await db.events.where("type").equals("PartyCreated").toArray()
    expect(events.at(-1)?.refs.partyId).toBe(r.partyId)
  })

  it("refuses credit fields without par.credit.edit, allows them for the accounts manager", async () => {
    await expect(run(db, createParty, customer({ creditLimitP: T(50_000) }), nayeem)).rejects.toMatchObject({ code: "CREDIT_EDIT_DENIED" })
    const r = await run(db, createParty, customer({ nameEn: "Fleet Co", type: "company", segment: "fleet", creditLimitP: T(50_000), paymentTermsDays: 30, deductsVds: true }), farzana)
    expect(await db.parties.get(r.partyId)).toMatchObject({ creditLimitP: T(50_000), paymentTermsDays: 30, deductsVds: true })
  })

  it("needs par.vendor.create for a vendor (an advisor is denied, procurement creates V- codes)", async () => {
    const vendor = { isCustomer: false, isVendor: true, type: "company" as const, nameEn: "Gloss Supplies", segment: "supplier" as const, phone: "02-9999999", vendorTaxCategory: "goods" as const }
    await expect(run(db, createParty, vendor, nayeem)).rejects.toBeInstanceOf(PermissionDenied)
    const nusrat = await signedIn(db, "nusrat")
    const r = await run(db, createParty, { ...vendor, paymentTermsDays: 15 }, nusrat)
    expect(r.code).toMatch(/^V-\d{4}$/)
    expect(await db.parties.get(r.partyId)).toMatchObject({ vendorTaxCategory: "goods", paymentTermsDays: 15 })
  })

  it("refuses the same BIN or NID as another party (rule codes)", async () => {
    await run(db, createParty, customer({ nid: "1990123456789" }), nayeem)
    await expect(run(db, createParty, customer({ nameEn: "Someone Else", phone: "01811-000000", nid: "1990123456789" }), nayeem)).rejects.toMatchObject({ code: "DUPLICATE_NID" })
    await expect(run(db, createParty, customer({ nameEn: "Dup Bin", type: "company", bin: "000999111-0101" }), nayeem)).rejects.toMatchObject({ code: "DUPLICATE_BIN" })
  })

  it("flags a likely duplicate by name and phone (warning only)", async () => {
    await run(db, createParty, customer(), nayeem)
    const parties = await db.parties.toArray()
    const dups = findLikelyDuplicates({ nameEn: "Rumana Aktar", phone: "01712 345678" }, parties)
    expect(dups[0]?.reasons).toContain("phone")
  })
})

describe("par.updateParty", () => {
  it("saves with the version and refuses a stale edit (E15 conflict)", async () => {
    const { partyId } = await run(db, createParty, customer(), nayeem)
    const v1 = (await db.parties.get(partyId))!
    const fields = { ...customer(), phone: "01712-000111" }
    await run(db, updateParty, { partyId, expectedVersion: v1.version, fields }, farzana)
    await expect(run(db, updateParty, { partyId, expectedVersion: v1.version, fields: { ...fields, phone: "01712-000222" } }, nayeem)).rejects.toBeInstanceOf(ConflictError)
    expect((await db.parties.get(partyId))?.phone).toBe("01712-000111")
  })

  it("refuses a credit change without the credit permission", async () => {
    const { partyId } = await run(db, createParty, customer(), nayeem)
    const p = (await db.parties.get(partyId))!
    await expect(run(db, updateParty, { partyId, expectedVersion: p.version, fields: { ...customer(), creditLimitP: T(10_000) } }, nayeem)).rejects.toMatchObject({
      code: "CREDIT_EDIT_DENIED",
    })
  })
})

describe("par.setStatus", () => {
  it("holds and releases with a reason; denied without par.party.hold", async () => {
    const mahbub = await signedIn(db, "mahbub")
    await expect(run(db, setPartyStatus, { partyId: "pty_fleet", status: "on-hold", reason: "Overdue" }, mahbub)).rejects.toBeInstanceOf(PermissionDenied)
    await expect(run(db, setPartyStatus, { partyId: "pty_fleet", status: "on-hold", reason: "" }, farzana)).rejects.toBeInstanceOf(RuleViolation)
    await run(db, setPartyStatus, { partyId: "pty_fleet", status: "on-hold", reason: "Cheques bouncing" }, farzana)
    expect(await db.parties.get("pty_fleet")).toMatchObject({ status: "on-hold", holdReason: "Cheques bouncing" })
    await run(db, setPartyStatus, { partyId: "pty_fleet", status: "active", reason: "" }, farzana)
    expect((await db.parties.get("pty_fleet"))?.status).toBe("active")
    const types = (await db.events.toArray()).map((e) => e.type)
    expect(types).toContain("PartyOnHold")
    expect(types).toContain("PartyReleased")
  })
})

describe("vehicles", () => {
  it("adds a vehicle with a unique registration and its Bangla form", async () => {
    const { partyId } = await run(db, createParty, customer(), nayeem)
    const input = { partyId, regNo: "dhaka metro-gha 15-9001", make: "Toyota", model: "C-HR", year: 2021, colour: "White", vehicleClass: "SUV" as const }
    const r = await run(db, addVehicle, input, nayeem)
    expect(await db.vehicles.get(r.vehicleId)).toMatchObject({ regNo: "DHAKA METRO-GHA 15-9001", regNoBn: "ঢাকা মেট্রো-ঘ ১৫-৯০০১" })
    await expect(run(db, addVehicle, { ...input, regNo: "DHAKA METRO-GHA 15-9001" }, nayeem)).rejects.toMatchObject({ code: "DUPLICATE_REGISTRATION" })
    const v = (await db.vehicles.get(r.vehicleId))!
    await run(db, updateVehicle, { ...input, vehicleId: v.id, expectedVersion: v.version, colour: "Pearl white" }, nayeem)
    expect((await db.vehicles.get(r.vehicleId))?.colour).toBe("Pearl white")
    const rakib = await signedIn(db, "rakib")
    await expect(run(db, addVehicle, { ...input, regNo: "DHAKA METRO-GA 11-1111" }, rakib)).rejects.toBeInstanceOf(PermissionDenied)
  })

  it("normalises and searches registrations in Latin or Bangla digits", () => {
    expect(normalizeRegNo("  dhaka  metro - ga 27-৪৪১৯ ")).toBe("DHAKA METRO-GA 27-4419")
    expect(regNoToBangla("CHATTA METRO-KA 12-3456")).toBe("চট্ট মেট্রো-ক ১২-৩৪৫৬")
    expect(regSearchKey("১৫-৭৭৩১")).toBe(regSearchKey("15 7731"))
  })
})
