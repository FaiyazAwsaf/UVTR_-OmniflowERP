import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { verifyChain } from "@/core/audit/verify"
import type { OmniflowDb } from "@/core/db/database"
import type { PartyRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import {
  ConflictError,
  PermissionDenied,
  RuleViolation,
  ValidationError,
} from "@/core/engine/errors"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { endSession, signIn, verifyMfa } from "@/core/security/signin"
import { roleId } from "@/core/security/types"

import { foundationDb, signedIn } from "../helpers/foundation"

let db: OmniflowDb
let advisor: Actor // nayeem, ADVISOR at GUL
let cashier: Actor // tania, CASHIER at GUL

beforeEach(async () => {
  db = await foundationDb("engine")
  advisor = await signedIn(db, "nayeem")
  cashier = await signedIn(db, "tania")
})
afterEach(async () => {
  await db.delete()
})

type PartyData = Omit<PartyRow, "id" | "version" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "origin">

function partyData(code: string, over: Partial<PartyData> = {}): PartyData {
  return {
    code,
    isCustomer: true,
    isVendor: false,
    type: "individual",
    nameEn: "Test Customer",
    nameBn: "পরীক্ষা গ্রাহক",
    segment: "retail",
    phone: "01711-000001",
    addresses: [],
    contacts: [],
    creditLimitP: 0,
    paymentTermsDays: 0,
    deductsVds: false,
    deductsAit: false,
    status: "active",
    smsConsent: true,
    avatarSeed: code,
    ...over,
  }
}

const createCustomer = defineCommand({
  name: "par.testCreate",
  permission: "par.customer.create",
  input: z.object({ id: z.string(), code: z.string() }),
  async run(tx, input) {
    const row = tx.insert("parties", { id: input.id, ...partyData(input.code) })
    tx.emit("PartyCreated", { refs: { partyId: row.id }, params: { code: row.code, name: row.nameEn } })
    return row.id
  },
})

const updatePhone = defineCommand({
  name: "par.testPhone",
  permission: "par.customer.edit",
  input: z.object({
    partyId: z.string(),
    phone: z.string().regex(/^01\d{3}-\d{6}$/),
    expectedVersion: z.number().int(),
  }),
  async run(tx, input) {
    const row = await tx.update(
      "parties",
      input.partyId,
      { phone: input.phone },
      { expectedVersion: input.expectedVersion }
    )
    tx.emit("PartyUpdated", { refs: { partyId: row.id }, params: { code: row.code } })
    return row.version
  },
})

const insertThenFail = defineCommand({
  name: "par.testFail",
  permission: "par.customer.create",
  input: z.object({}),
  async run(tx) {
    tx.insert("parties", { id: "p_fail", ...partyData("C-999999") })
    tx.reject("TEST_FAILURE")
  },
})

const bump = defineCommand({
  name: "par.testBump",
  permission: "authenticated",
  input: z.object({ idempotencyKey: z.string().optional() }),
  async run(tx) {
    return tx.nextNumber("test-bump")
  },
})

describe("Atomicity", () => {
  it("writes nothing when a command fails after buffering writes", async () => {
    await expect(commit(insertThenFail, {}, { db, actor: advisor })).rejects.toBeInstanceOf(
      RuleViolation
    )
    expect(await db.parties.get("p_fail")).toBeUndefined()
  })

  it("commits rows, events and audit together, recording the user and session", async () => {
    const out = await commit(createCustomer, { id: "p1", code: "C-000001" }, { db, actor: advisor })
    expect(out.result).toBe("p1")
    expect((await db.parties.get("p1"))?.createdBy).toBe(advisor.userId)
    const events = await db.events.where("commitId").equals(out.commitId).toArray()
    expect(events.map((e) => e.type)).toEqual(["PartyCreated"])
    expect(events[0].actor.userId).toBe(advisor.userId)
    expect(events[0].consumers.length).toBeGreaterThan(0)
    expect(events[0].locationId).toBe("loc_gul")
    const audit = await db.audit.where("commitId").equals(out.commitId).toArray()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: "insert",
      entity: "parties",
      docNo: "C-000001",
      app: "par",
    })
    expect(audit[0].actor.sessionId).toBe(advisor.sessionId)
  })

  it("never writes audit rows for the sessions platform table", async () => {
    const sessionAudits = await db.audit.where("entity").equals("sessions").count()
    expect(sessionAudits).toBe(0)
  })
})

describe("Consistency", () => {
  it("keeps posted documents immutable except their mutable fields (INV-06)", async () => {
    const plant = defineCommand({
      name: "stl.testPlant",
      permission: "system",
      input: z.object({}),
      async run(tx) {
        tx.insert("quotations", {
          id: "qt1",
          quoteNo: "QT-GUL-2627-00001",
          locationId: "loc_gul",
          partyId: "p1",
          advisorId: advisor.userId,
          priceListId: "pl_retail",
          discountPct: 0,
          status: "accepted",
          validUntil: tx.today(),
          inspectionNotes: "",
          subtotalP: 100,
          discountP: 0,
          vatP: 15,
          totalP: 115,
        })
      },
    })
    await commit(plant, {}, { db, actor: SYSTEM_ACTOR })
    const edit = defineCommand({
      name: "stl.testEdit",
      permission: "system",
      input: z.object({ field: z.enum(["notes", "status"]) }),
      async run(tx, input) {
        if (input.field === "notes") await tx.update("quotations", "qt1", { inspectionNotes: "changed" })
        else await tx.update("quotations", "qt1", { status: "rejected" })
      },
    })
    await expect(commit(edit, { field: "notes" }, { db, actor: SYSTEM_ACTOR })).rejects.toMatchObject({
      code: "IMMUTABLE_DOCUMENT",
    })
    const blocked = await db.audit.where("action").equals("blocked").toArray()
    expect(blocked.some((r) => r.code === "IMMUTABLE_DOCUMENT")).toBe(true)
    // status is a declared mutable field
    await commit(edit, { field: "status" }, { db, actor: SYSTEM_ACTOR })
    expect((await db.quotations.get("qt1"))?.status).toBe("rejected")
  })

  it("validates input before running", async () => {
    await commit(createCustomer, { id: "p1", code: "C-000001" }, { db, actor: advisor })
    await expect(
      commit(updatePhone, { partyId: "p1", phone: "1", expectedVersion: 1 }, { db, actor: advisor })
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("Isolation", () => {
  it("gives the second writer of the same version a conflict naming the first", async () => {
    await commit(createCustomer, { id: "p1", code: "C-000001" }, { db, actor: advisor })
    await commit(updatePhone, { partyId: "p1", phone: "01711-111111", expectedVersion: 1 }, { db, actor: advisor })
    const second = commit(
      updatePhone,
      { partyId: "p1", phone: "01711-222222", expectedVersion: 1 },
      { db, actor: advisor }
    )
    await expect(second).rejects.toBeInstanceOf(ConflictError)
    await expect(second).rejects.toMatchObject({ actualVersion: 2, updatedBy: advisor.userId })
  })

  it("serialises concurrent commits through the lock", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => commit(bump, {}, { db, actor: cashier }))
    )
    expect(results.map((r) => r.result).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1)
    )
  })
})

describe("Durability and idempotency", () => {
  it("applies an action once even if submitted twice", async () => {
    const first = await commit(bump, { idempotencyKey: "k-1" }, { db, actor: cashier })
    const again = await commit(bump, { idempotencyKey: "k-1" }, { db, actor: cashier })
    expect(again.deduplicated).toBe(true)
    expect(again.result).toBe(first.result)
    expect((await db.counters.get("test-bump"))?.value).toBe(1)
  })

  it("survives closing and reopening the database", async () => {
    await commit(bump, {}, { db, actor: cashier })
    db.close()
    await db.open()
    expect((await db.counters.get("test-bump"))?.value).toBe(1)
  })
})

describe("Permissions (live, plan §3.3)", () => {
  it("denies a user without the key, and audits the attempt", async () => {
    const technician = await signedIn(db, "rakib")
    await expect(
      commit(createCustomer, { id: "p9", code: "C-000009" }, { db, actor: technician })
    ).rejects.toBeInstanceOf(PermissionDenied)
    const blocked = await db.audit.where("action").equals("blocked").toArray()
    expect(blocked.at(-1)).toMatchObject({ code: "PERMISSION_DENIED", command: "par.testCreate" })
    const events = await db.events.where("type").equals("PermissionDeniedBlocked").count()
    expect(events).toBe(1)
  })

  it("applies an RBAC revoke on the very next commit", async () => {
    await commit(createCustomer, { id: "p1", code: "C-000001" }, { db, actor: advisor })
    await db.rolePermissions.delete("rp_advisor_par.customer.create")
    await expect(
      commit(createCustomer, { id: "p2", code: "C-000002" }, { db, actor: advisor })
    ).rejects.toBeInstanceOf(PermissionDenied)
  })

  it("refuses a locked user and an ended session", async () => {
    await db.users.update(advisor.userId, { status: "locked" })
    await expect(commit(bump, {}, { db, actor: advisor })).rejects.toMatchObject({ code: "USER_LOCKED" })
    await db.users.update(advisor.userId, { status: "active" })

    const admin = await signedIn(db, "tahmid")
    await commit(endSession, { sessionId: advisor.sessionId! }, { db, actor: admin })
    await expect(commit(bump, {}, { db, actor: advisor })).rejects.toMatchObject({ code: "SESSION_ENDED" })
  })

  it("accepts a scenario session only from the runner", async () => {
    const scenarioActor = { ...advisor, sessionId: "scenario:run_1" }
    await expect(commit(bump, {}, { db, actor: scenarioActor })).rejects.toMatchObject({
      code: "SESSION_ENDED",
    })
    const ok = await commit(bump, {}, { db, actor: scenarioActor, scenarioSession: true })
    expect(ok.result).toBe(1)
  })

  it("scopes own-location grants (tx.requireLocation) and resolves limits (tx.limit)", async () => {
    const probe = defineCommand({
      name: "ar.testScope",
      permission: "ar.receipt.create",
      input: z.object({ locationId: z.string() }),
      async run(tx, input) {
        tx.requireLocation(input.locationId)
        return { pettyCash: tx.limit("petty-cash"), discount: tx.limit("discount-pct") }
      },
    })
    const ok = await commit(probe, { locationId: "loc_gul" }, { db, actor: cashier })
    expect(ok.result).toEqual({ pettyCash: 100_000, discount: 0 })
    await expect(commit(probe, { locationId: "loc_utt" }, { db, actor: cashier })).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    })
    // The accounts manager holds the key for every location, with her own limits.
    const farzana = await signedIn(db, "farzana")
    const am = await commit(probe, { locationId: "loc_utt" }, { db, actor: farzana })
    expect(am.result).toEqual({ pettyCash: 2_000_000, discount: 15 })
    const owner = await signedIn(db, "rashed")
    await expect(commit(probe, { locationId: "loc_utt" }, { db, actor: owner })).rejects.toBeInstanceOf(
      PermissionDenied
    )
  })

  it("uses the highest limit across a user's roles", async () => {
    await db.userRoles.add({
      id: "ur_extra",
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      createdBy: "system",
      updatedBy: "system",
      origin: "central",
      userId: cashier.userId,
      roleId: roleId("STUDIO_MGR"),
      grantedBy: "system",
      grantedAt: 0,
    })
    const probe = defineCommand({
      name: "ar.testLimit",
      permission: "authenticated",
      input: z.object({}),
      async run(tx) {
        return tx.limit("discount-pct")
      },
    })
    expect((await commit(probe, {}, { db, actor: cashier })).result).toBe(15)
  })
})

describe("Sign-in (plan §3.8)", () => {
  const ctx = () => ({ db, actor: SYSTEM_ACTOR })

  it("signs in with the demo password and records the login", async () => {
    const out = await commit(
      signIn,
      { username: "mahbub", password: "demo1234", windowId: "of-w1", method: "password" },
      ctx()
    )
    expect(out.result.status).toBe("ok")
    const events = await db.loginEvents.where("username").equals("mahbub").toArray()
    expect(events.at(-1)?.result).toBe("success")
  })

  it("locks a user after five wrong passwords", async () => {
    for (let i = 1; i <= 4; i += 1) {
      const out = await commit(
        signIn,
        { username: "shuvo", password: "wrong", windowId: "of-w2", method: "password" },
        ctx()
      )
      expect(out.result).toMatchObject({ status: "failed", reason: "bad-credentials", attemptsLeft: 5 - i })
    }
    const fifth = await commit(
      signIn,
      { username: "shuvo", password: "wrong", windowId: "of-w2", method: "password" },
      ctx()
    )
    expect(fifth.result).toMatchObject({ status: "failed", reason: "locked" })
    expect((await db.users.get("usr_shuvo"))?.status).toBe("locked")
    const right = await commit(
      signIn,
      { username: "shuvo", password: "demo1234", windowId: "of-w2", method: "password" },
      ctx()
    )
    expect(right.result).toMatchObject({ status: "failed", reason: "locked" })
    expect(await db.events.where("type").equals("UserLocked").count()).toBe(1)
  })

  it("asks the administrator for the simulated MFA code", async () => {
    const first = await commit(
      signIn,
      { username: "tahmid", password: "demo1234", windowId: "of-w3", method: "password" },
      ctx()
    )
    expect(first.result).toMatchObject({ status: "mfa", userId: "usr_tahmid" })
    const wrong = await commit(verifyMfa, { userId: "usr_tahmid", code: "000000", windowId: "of-w3" }, ctx())
    expect(wrong.result).toMatchObject({ status: "failed", reason: "mfa-failed" })
    const right = await commit(verifyMfa, { userId: "usr_tahmid", code: "123456", windowId: "of-w3" }, ctx())
    expect(right.result.status).toBe("ok")
  })

  it("keeps the seeded lock on Polash", async () => {
    const out = await commit(signIn, { username: "polash", windowId: "of-w4", method: "demo-quick" }, ctx())
    expect(out.result).toMatchObject({ status: "failed", reason: "locked" })
  })
})

describe("Audit hash chain", () => {
  it("verifies an intact chain and detects tampering", async () => {
    await commit(createCustomer, { id: "p1", code: "C-000001" }, { db, actor: advisor })
    for (const [i, phone] of ["01711-000002", "01711-000003"].entries()) {
      await commit(updatePhone, { partyId: "p1", phone, expectedVersion: i + 1 }, { db, actor: advisor })
    }
    const intact = await verifyChain(db)
    expect(intact.ok).toBe(true)
    const middle = await db.audit.orderBy("seq").offset(1).first()
    await db.audit.update(middle!.seq, { at: middle!.at - 1 })
    const broken = await verifyChain(db)
    expect(broken).toMatchObject({ ok: false, brokenAt: middle!.seq })
  })

  it("orders events by a gap-free sequence", async () => {
    await commit(createCustomer, { id: "p1", code: "C-000001" }, { db, actor: advisor })
    for (let i = 1; i <= 3; i += 1) {
      await commit(updatePhone, { partyId: "p1", phone: `01700-00000${i}`, expectedVersion: i }, { db, actor: advisor })
    }
    const seqs = (await db.events.orderBy("seq").toArray()).map((e) => e.seq)
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1))
  })
})
