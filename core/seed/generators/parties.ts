import type { BaseRow, PartyRow, VehicleClass } from "@/core/db/schema"
import type { Rng } from "@/lib/mock/rng"

import { CLASS_SHARES } from "../content/catalogue"
import { bnDigits } from "../content/bn"
import {
  DHAKA_AREAS,
  FEMALE_GIVEN_OLDER,
  FEMALE_GIVEN_YOUNGER,
  FEMALE_SURNAMES_OLDER,
  FEMALE_SURNAMES_YOUNGER,
  HINDU_FEMALE_GIVEN,
  HINDU_MALE_GIVEN,
  HINDU_SURNAMES,
  MALE_GIVEN_OLDER,
  MALE_GIVEN_YOUNGER,
  MALE_SURNAMES,
  UL_SURNAMES,
  UR_SURNAME,
  type NamePart,
} from "../content/names"
import { COLOURS, CREDIT_CUSTOMERS, MODELS, SERIES, SERIES_BN, VENDORS } from "../content/parties"
import { PL, PTY, USR, VEH } from "../content/seed-refs"
import type { World } from "../engine/world"

/**
 * PAR (seed_data.md §5): the walk-in customer, the story's named customers,
 * about 400 retail customers with about 480 vehicles (40 in the small
 * profile), the ten credit customers with their fleets or dealer stock cars,
 * and the 14 vendors. Names are synthetic; makes and models are real;
 * registrations are invented.
 */

export type PoolVehicle = { id: string; cls: VehicleClass }
export type PoolCustomer = { partyId: string; nameEn: string; vehicles: PoolVehicle[]; area: string }

export type PartiesOut = {
  retail: PoolCustomer[]
  /** Vehicles per credit customer */
  fleets: Map<string, PoolVehicle[]>
  partyName: Map<string, string>
}

const regSeen = new Set<string>()

function regNo(rng: Rng, cls: VehicleClass): { en: string; bn: string } {
  for (;;) {
    const city = rng.bool(0.05) ? ["CHATTA METRO", "চট্ট মেট্রো"] : ["DHAKA METRO", "ঢাকা মেট্রো"]
    const series = rng.pick(SERIES[cls])
    const a = String(rng.int(11, 39))
    const b = String(rng.int(1000, 9999))
    const en = `${city[0]}-${series} ${a}-${b}`
    if (regSeen.has(en)) continue
    regSeen.add(en)
    return { en, bn: `${city[1]}-${SERIES_BN[series]} ${bnDigits(a)}-${bnDigits(b)}` }
  }
}

function phone(rng: Rng): string {
  const op = rng.pick(["13", "14", "15", "16", "17", "18", "19"])
  return `01${op}${rng.int(10, 99)}-${String(rng.int(100000, 999999))}`
}

/** A synthetic Bangladeshi name in English and Bangla. */
export function personName(rng: Rng): { en: string; bn: string; sex: "M" | "F" } {
  const female = rng.bool(0.32)
  if (rng.bool(1 / 15)) {
    const sur = rng.pick(HINDU_SURNAMES)
    const given = rng.pick(female ? HINDU_FEMALE_GIVEN : HINDU_MALE_GIVEN)
    return { en: `${given[0]} ${sur[0]}`, bn: `${given[1]} ${sur[1]}`, sex: female ? "F" : "M" }
  }
  if (female) {
    const older = rng.bool(0.4)
    const given = rng.pick(older ? FEMALE_GIVEN_OLDER : FEMALE_GIVEN_YOUNGER)
    const sur = rng.pick(older ? FEMALE_SURNAMES_OLDER : FEMALE_SURNAMES_YOUNGER)
    return { en: `${given[0]} ${sur[0]}`, bn: `${given[1]} ${sur[1]}`, sex: "F" }
  }
  if (rng.bool(0.45)) {
    const [gEn, gBn, kind] = rng.pick(MALE_GIVEN_OLDER)
    const sur: NamePart = kind === "ur" ? UR_SURNAME : kind === "ul" ? rng.pick(UL_SURNAMES) : rng.pick(MALE_SURNAMES)
    return { en: `${gEn} ${sur[0]}`, bn: `${gBn} ${sur[1]}`, sex: "M" }
  }
  const given = rng.pick(MALE_GIVEN_YOUNGER)
  const sur = rng.pick(MALE_SURNAMES)
  return { en: `${given[0]} ${sur[0]}`, bn: `${given[1]} ${sur[1]}`, sex: "M" }
}

export function seedParties(w: World): PartiesOut {
  regSeen.clear()
  const { bag } = w.ctx
  const rng = w.rng("parties")
  const at0 = w.at(w.cal.F, "08:00")
  const partyName = new Map<string, string>()

  const customer = (id: string, at: number, data: Omit<PartyRow, keyof BaseRow | "code">, by: string = USR.mahbub) => {
    const row = bag.put("parties", id, at, { ...data, code: "" }, by)
    w.number(data.isVendor && !data.isCustomer ? "V" : "C", {}, at, (no) => {
      row.code = no
    })
    partyName.set(id, data.nameEn)
    return row
  }
  const base = {
    isCustomer: true,
    isVendor: false,
    deductsVds: false,
    deductsAit: false,
    status: "active" as const,
    creditLimitP: 0,
    paymentTermsDays: 0,
    contacts: [],
  }
  const vehicle = (id: string, partyId: string, cls: VehicleClass, at: number, opts: { make?: string; model?: string; reg?: { en: string; bn: string }; colour?: string; vin?: string; year?: number } = {}) => {
    const [make, model] = opts.make && opts.model ? [opts.make, opts.model] : rng.pick(MODELS[cls])
    const reg = opts.reg ?? regNo(rng, cls)
    bag.put("vehicles", id, at, {
      partyId,
      regNo: reg.en,
      regNoBn: reg.bn,
      make,
      model,
      year: opts.year ?? rng.int(2012, 2024),
      colour: opts.colour ?? rng.pick(COLOURS),
      vehicleClass: cls,
      vin: opts.vin,
      active: true,
    }, USR.nayeem)
  }

  // Walk-in customer (counter sales of retail goods without a named customer).
  customer(PTY.walkIn, at0 - 60_000, {
    ...base,
    type: "individual",
    nameEn: "Walk-in customer",
    nameBn: "ওয়াক-ইন গ্রাহক",
    segment: "walk-in",
    phone: "",
    addresses: [],
    priceListId: PL.retail,
    smsConsent: false,
    avatarSeed: "walk-in",
  })

  // Credit customers and their fleets (dealers' stock cars carry NEW-<chassis tail>).
  const fleets = new Map<string, PoolVehicle[]>()
  CREDIT_CUSTOMERS.forEach((c, i) => {
    const at = at0 - 50_000 + i
    customer(c.id, at, {
      ...base,
      type: "company",
      nameEn: c.nameEn,
      nameBn: c.nameBn,
      segment: c.segment,
      phone: phone(rng),
      email: `accounts@${c.nameEn.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
      addresses: [{ label: "Office", line: `House ${rng.int(2, 88)}, Road ${rng.int(1, 40)}`, area: c.area, city: "Dhaka" }],
      contacts: c.contacts.map(([name, designation]) => ({ name, designation, phone: phone(rng) })),
      bin: `00${rng.int(1000000, 9999999)}-0${rng.int(101, 109)}`,
      tin: String(rng.int(100000000000, 999999999999)),
      tradeLicense: `TRAD/DNCC/${rng.int(10000, 99999)}/${rng.int(2015, 2023)}`,
      creditLimitP: c.creditLimit * 100,
      paymentTermsDays: c.terms,
      priceListId: c.priceListId,
      deductsVds: c.deductsVds,
      deductsAit: c.deductsAit,
      smsConsent: true,
      avatarSeed: c.id,
    }, USR.farzana)
    const list: PoolVehicle[] = []
    const count = w.cal.small ? Math.min(c.vehicles, 12) : c.vehicles
    for (let k = 0; k < count; k++) {
      const cls = rng.weighted(c.classes)
      const id = `veh_${c.id.slice(4)}_${String(k + 1).padStart(2, "0")}`
      if (c.segment === "dealer") {
        const tail = `${rng.pick(["5", "6", "7"])}${rng.int(100000, 999999)}`
        vehicle(id, c.id, cls, at, { reg: { en: `NEW-${tail}`, bn: `NEW-${tail}` }, vin: `JT${rng.int(10, 99)}K${rng.int(100, 999)}${tail}`, year: 2025 })
      } else {
        vehicle(id, c.id, cls, at)
      }
      list.push({ id, cls })
    }
    fleets.set(c.id, list)
  })

  // The story's returning customer (J1 to J6) and the E1 sedan customer at Uttara.
  customer(PTY.shahedKabir, at0 - 40_000, {
    ...base,
    type: "individual",
    nameEn: "Shahed Kabir",
    nameBn: "শাহেদ কবির",
    segment: "retail",
    phone: "01819-447731",
    addresses: [{ label: "Home", line: "House 9, Road 27", area: "Banani", city: "Dhaka" }],
    priceListId: PL.retail,
    smsConsent: true,
    avatarSeed: "shahed-kabir",
  }, USR.nayeem)
  vehicle(VEH.corollaCross7731, PTY.shahedKabir, "SUV", at0 - 40_000, {
    make: "Toyota",
    model: "Corolla Cross",
    colour: "Pearl white",
    year: 2022,
    reg: { en: "DHAKA METRO-GHA 15-7731", bn: "ঢাকা মেট্রো-ঘ ১৫-৭৭৩১" },
  })
  regSeen.add("DHAKA METRO-GHA 15-7731")
  customer(PTY.e1Customer, at0 - 30_000, {
    ...base,
    type: "individual",
    nameEn: "Nafis Hasan",
    nameBn: "নাফিস হাসান",
    segment: "retail",
    phone: "01712-608154",
    addresses: [{ label: "Home", line: "House 31, Road 6", area: "Uttara Sector 7", city: "Dhaka" }],
    priceListId: PL.retail,
    smsConsent: true,
    avatarSeed: "e1-customer",
  }, USR.shuvo)
  vehicle(VEH.e1Allion, PTY.e1Customer, "SD", at0 - 30_000, { make: "Toyota", model: "Allion", colour: "Silver", year: 2019 })

  // Retail customers: about 400 (40 small), most with one vehicle, some two or three.
  // (Shahed Kabir is not in the pool: his two past orders are planted.)
  const retail: PoolCustomer[] = []
  const count = w.cal.small ? 40 : 400
  const span = Math.max(1, (w.cal.now - at0) / 86_400_000)
  for (let i = 0; i < count; i++) {
    const name = personName(rng)
    const id = w.ctx.seq("pty")
    const area = rng.pick(DHAKA_AREAS)
    const at = at0 + Math.floor((i / count) * span * 0.9) * 86_400_000
    customer(id, at, {
      ...base,
      type: "individual",
      nameEn: name.en,
      nameBn: name.bn,
      segment: "retail",
      phone: phone(rng),
      addresses: [{ label: "Home", line: `House ${rng.int(1, 120)}, Road ${rng.int(1, 30)}`, area, city: "Dhaka" }],
      priceListId: PL.retail,
      smsConsent: rng.bool(0.85),
      avatarSeed: id,
    }, rng.pick([USR.nayeem, USR.shuvo, USR.tania, USR.sabbir]))
    const nVeh = rng.weighted<number>([[1, 80], [2, 16], [3, 4]])
    const vehicles: PoolVehicle[] = []
    for (let k = 0; k < nVeh; k++) {
      const cls = rng.weighted(CLASS_SHARES)
      const vid = w.ctx.seq("veh")
      vehicle(vid, id, cls, at)
      vehicles.push({ id: vid, cls })
    }
    retail.push({ partyId: id, nameEn: name.en, vehicles, area })
  }

  // Vendors.
  VENDORS.forEach((v, i) => {
    const at = at0 - 20_000 + i
    const row = bag.put("parties", v.id, at, {
      code: "",
      isCustomer: false,
      isVendor: true,
      type: "company",
      nameEn: v.nameEn,
      nameBn: v.nameBn,
      segment: v.segment,
      phone: phone(rng),
      email: `billing@${v.nameEn.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 18)}.example`,
      addresses: [{ label: "Office", line: `Holding ${rng.int(3, 140)}, Road ${rng.int(1, 30)}`, area: v.area, city: "Dhaka" }],
      contacts: [{ name: personName(rng).en, designation: "Sales and accounts", phone: phone(rng) }],
      bin: `00${rng.int(1000000, 9999999)}-0${rng.int(101, 109)}`,
      tin: String(rng.int(100000000000, 999999999999)),
      tradeLicense: `TRAD/DNCC/${rng.int(10000, 99999)}/${rng.int(2012, 2022)}`,
      creditLimitP: 0,
      paymentTermsDays: v.terms,
      vendorTaxCategory: v.category,
      deductsVds: false,
      deductsAit: false,
      status: "active",
      smsConsent: false,
      avatarSeed: v.id,
      notes: v.notesEn,
    }, USR.nusrat)
    w.number("V", {}, at, (no) => {
      row.code = no
    })
    partyName.set(v.id, v.nameEn)
  })

  return { retail, fleets, partyName }
}
