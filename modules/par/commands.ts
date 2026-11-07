import { z } from "zod"

import type { PartyRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { defineCommand } from "@/core/engine/defineCommand"
import { PermissionDenied } from "@/core/engine/errors"
import type { Tx } from "@/core/engine/types"

import {
  ALL_SEGMENTS,
  creditFieldsOf,
  defaultPriceListCode,
  normalizeRegNo,
  regNoToBangla,
  sameCreditFields,
  VEHICLE_CLASS_LIST,
} from "./lib"

/**
 * PAR Party Management commands (plan §6.2): one party master for
 * customers and vendors, their vehicles, and the hold status. Credit fields
 * (limit, customer terms, price list, VDS and AIT flags) need
 * `par.credit.edit`; the same BIN or NID as another party is refused.
 */

const optText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

const address = z.object({
  label: z.string().trim().default(""),
  line: z.string().trim().default(""),
  area: z.string().trim().default(""),
  city: z.string().trim().default("Dhaka"),
})

const contact = z.object({
  name: z.string().trim().min(1),
  designation: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  email: optText,
})

export const partyFields = z
  .object({
    isCustomer: z.boolean(),
    isVendor: z.boolean(),
    type: z.enum(["individual", "company"]),
    nameEn: z.string().trim().min(2),
    nameBn: z.string().trim().default(""),
    segment: z.enum(ALL_SEGMENTS as [PartyRow["segment"], ...PartyRow["segment"][]]),
    phone: z.string().trim().min(5),
    email: optText,
    addresses: z.array(address).default([]),
    contacts: z.array(contact).default([]),
    bin: optText,
    tin: optText,
    nid: optText,
    tradeLicense: optText,
    creditLimitP: z.number().int().min(0).default(0),
    paymentTermsDays: z.number().int().min(0).max(365).default(0),
    priceListId: optText,
    vendorTaxCategory: z.enum(["goods", "services", "rent", "professional", "utility", "exempt"]).optional(),
    deductsVds: z.boolean().default(false),
    deductsAit: z.boolean().default(false),
    smsConsent: z.boolean().default(true),
    notes: optText,
  })
  .refine((p) => p.isCustomer || p.isVendor, { message: "customer or vendor", path: ["isCustomer"] })

export type PartyFieldsInput = z.input<typeof partyFields>

/** The create or edit keys the party's kinds need (customer, vendor or both). */
function requireKindKeys(tx: Tx, p: { isCustomer: boolean; isVendor: boolean }, verb: "create" | "edit") {
  const needed = [p.isCustomer ? `par.customer.${verb}` : null, p.isVendor ? `par.vendor.${verb}` : null].filter(Boolean) as string[]
  for (const key of needed) if (!tx.can(key)) throw new PermissionDenied(tx.command, tx.actor.userId, [key])
}

/** Refuse a BIN or NID another party already uses (plan §6.2). */
async function refuseDuplicateIds(tx: Tx, p: { bin?: string; nid?: string }, selfId?: string) {
  if (p.bin) {
    const same = (await tx.list("parties", "bin", p.bin)).filter((x) => x.id !== selfId)
    if (same.length) tx.reject("DUPLICATE_BIN", { bin: p.bin, party: same[0].nameEn })
  }
  if (p.nid) {
    const same = (await tx.list("parties", "nid", p.nid)).filter((x) => x.id !== selfId)
    if (same.length) tx.reject("DUPLICATE_NID", { nid: p.nid, party: same[0].nameEn })
  }
}

async function defaultPriceList(tx: Tx, segment: PartyRow["segment"]): Promise<string | undefined> {
  const lists = await tx.list("priceLists", "code", defaultPriceListCode(segment))
  return lists.find((l) => l.status === "published")?.id
}

/** `par.createParty`: a customer (C-<6>) or vendor (V-<4>); duplicate warning in the UI, BIN/NID refused here. */
export const createParty = defineCommand({
  name: "par.createParty",
  permission: ["par.customer.create", "par.vendor.create"],
  input: partyFields,
  async run(tx, input) {
    requireKindKeys(tx, input, "create")
    await refuseDuplicateIds(tx, input)
    const credit = tx.can("par.credit.edit")
    const vendorOnly = input.isVendor && !input.isCustomer
    if (!credit) {
      const defaults = {
        creditLimitP: 0,
        priceListId: undefined,
        deductsVds: false,
        deductsAit: false,
        customerTermsDays: 0,
      }
      const asked = creditFieldsOf({ ...input, priceListId: input.priceListId })
      if (!sameCreditFields(asked, defaults)) tx.reject("CREDIT_EDIT_DENIED", {}, { audit: true })
    }
    const priceListId = input.isCustomer ? (input.priceListId ?? (await defaultPriceList(tx, input.segment))) : undefined
    const code = await nextDocNo(tx, input.isCustomer ? "C" : "V")
    const party = tx.insert("parties", {
      code,
      isCustomer: input.isCustomer,
      isVendor: input.isVendor,
      type: input.type,
      nameEn: input.nameEn,
      nameBn: input.nameBn || input.nameEn,
      segment: input.segment,
      phone: input.phone,
      email: input.email,
      addresses: input.addresses.filter((a) => a.line || a.area),
      contacts: input.contacts,
      bin: input.bin,
      tin: input.tin,
      nid: input.nid,
      tradeLicense: input.tradeLicense,
      creditLimitP: input.creditLimitP,
      paymentTermsDays: input.paymentTermsDays || (vendorOnly ? 30 : 0),
      priceListId,
      vendorTaxCategory: input.isVendor ? (input.vendorTaxCategory ?? "goods") : undefined,
      deductsVds: input.deductsVds,
      deductsAit: input.deductsAit,
      status: "active",
      smsConsent: input.smsConsent,
      avatarSeed: code,
      notes: input.notes,
    })
    tx.emit("PartyCreated", {
      refs: { partyId: party.id },
      params: { code, name: party.nameEn },
      locationId: null,
    })
    return { partyId: party.id, code }
  },
})

/** `par.updateParty`: edit with `expectedVersion` (two windows editing get the conflict dialog, E15). */
export const updateParty = defineCommand({
  name: "par.updateParty",
  permission: ["par.customer.edit", "par.vendor.edit"],
  input: z.object({ partyId: z.string(), expectedVersion: z.number().int(), fields: partyFields }),
  async run(tx, input) {
    const party = await tx.get("parties", input.partyId, { expectedVersion: input.expectedVersion })
    const f = input.fields
    requireKindKeys(tx, { isCustomer: party.isCustomer || f.isCustomer, isVendor: party.isVendor || f.isVendor }, "edit")
    await refuseDuplicateIds(tx, f, party.id)
    const next = { ...f, priceListId: f.isCustomer ? (f.priceListId ?? party.priceListId) : undefined }
    if (!tx.can("par.credit.edit") && !sameCreditFields(creditFieldsOf(party), creditFieldsOf(next))) {
      tx.reject("CREDIT_EDIT_DENIED", {}, { audit: true })
    }
    const updated = await tx.update("parties", party.id, {
      isCustomer: f.isCustomer,
      isVendor: f.isVendor,
      type: f.type,
      nameEn: f.nameEn,
      nameBn: f.nameBn || f.nameEn,
      segment: f.segment,
      phone: f.phone,
      email: f.email,
      addresses: f.addresses.filter((a) => a.line || a.area),
      contacts: f.contacts,
      bin: f.bin,
      tin: f.tin,
      nid: f.nid,
      tradeLicense: f.tradeLicense,
      creditLimitP: next.creditLimitP,
      paymentTermsDays: next.paymentTermsDays,
      priceListId: next.priceListId,
      vendorTaxCategory: f.isVendor ? (f.vendorTaxCategory ?? party.vendorTaxCategory ?? "goods") : undefined,
      deductsVds: next.deductsVds,
      deductsAit: next.deductsAit,
      smsConsent: f.smsConsent,
      notes: f.notes,
    })
    tx.emit("PartyUpdated", { refs: { partyId: party.id }, params: { code: party.code }, locationId: null })
    return { partyId: updated.id, version: updated.version }
  },
})

/** `par.setStatus`: on hold or blocked with a reason, or active again (PartyOnHold / PartyReleased). */
export const setPartyStatus = defineCommand({
  name: "par.setStatus",
  permission: "par.party.hold",
  input: z.object({
    partyId: z.string(),
    status: z.enum(["active", "on-hold", "blocked"]),
    reason: z.string().trim().default(""),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const party = await tx.get("parties", input.partyId, { expectedVersion: input.expectedVersion })
    if (party.status === input.status) tx.reject("PARTY_STATUS_SAME", { status: input.status })
    if (input.status !== "active" && !input.reason) tx.reject("REASON_REQUIRED")
    await tx.update("parties", party.id, {
      status: input.status,
      holdReason: input.status === "active" ? undefined : input.reason,
    })
    tx.auditContext({ reason: input.reason || undefined })
    tx.emit(input.status === "active" ? "PartyReleased" : "PartyOnHold", {
      refs: { partyId: party.id },
      params: { code: party.code, name: party.nameEn },
      locationId: null,
    })
    return { status: input.status }
  },
})

const vehicleFields = z.object({
  regNo: z.string().trim().min(4),
  regNoBn: optText,
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  year: z.number().int().min(1950).max(2100),
  colour: z.string().trim().default(""),
  vehicleClass: z.enum(VEHICLE_CLASS_LIST as ["HB", "SD", "SUV", "LSUV", "MPV"]),
  vin: optText,
  notes: optText,
})

async function refuseDuplicateReg(tx: Tx, regNo: string, selfId?: string) {
  const same = (await tx.list("vehicles", "regNo", regNo)).filter((v) => v.id !== selfId)
  if (same.length) tx.reject("DUPLICATE_REGISTRATION", { regNo })
}

/** `par.addVehicle`: a customer's vehicle; the registration is unique (VehicleAdded). */
export const addVehicle = defineCommand({
  name: "par.addVehicle",
  permission: "par.customer.create",
  input: vehicleFields.extend({ partyId: z.string() }),
  async run(tx, input) {
    const party = await tx.get("parties", input.partyId)
    if (!party.isCustomer) tx.reject("NOT_A_CUSTOMER", { party: party.nameEn })
    const regNo = normalizeRegNo(input.regNo)
    await refuseDuplicateReg(tx, regNo)
    const vehicle = tx.insert("vehicles", {
      partyId: party.id,
      regNo,
      regNoBn: input.regNoBn || regNoToBangla(regNo),
      make: input.make,
      model: input.model,
      year: input.year,
      colour: input.colour,
      vehicleClass: input.vehicleClass,
      vin: input.vin,
      notes: input.notes,
      active: true,
    })
    tx.emit("VehicleAdded", {
      refs: { partyId: party.id, vehicleId: vehicle.id },
      params: { regNo, party: party.nameEn },
      locationId: null,
    })
    return { vehicleId: vehicle.id }
  },
})

/** `par.updateVehicle`: edit or retire a vehicle (registration stays unique). */
export const updateVehicle = defineCommand({
  name: "par.updateVehicle",
  permission: "par.customer.edit",
  input: vehicleFields.extend({
    vehicleId: z.string(),
    expectedVersion: z.number().int(),
    active: z.boolean().default(true),
  }),
  async run(tx, input) {
    const vehicle = await tx.get("vehicles", input.vehicleId, { expectedVersion: input.expectedVersion })
    const regNo = normalizeRegNo(input.regNo)
    await refuseDuplicateReg(tx, regNo, vehicle.id)
    await tx.update("vehicles", vehicle.id, {
      regNo,
      regNoBn: regNo === vehicle.regNo ? (input.regNoBn || vehicle.regNoBn) : (input.regNoBn || regNoToBangla(regNo)),
      make: input.make,
      model: input.model,
      year: input.year,
      colour: input.colour,
      vehicleClass: input.vehicleClass,
      vin: input.vin,
      notes: input.notes,
      active: input.active,
    })
    const party = await tx.get("parties", vehicle.partyId)
    tx.emit("PartyUpdated", {
      refs: { partyId: party.id, vehicleId: vehicle.id },
      params: { code: party.code },
      locationId: null,
    })
    return { vehicleId: vehicle.id }
  },
})
