import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import type { OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Actor } from "@/core/engine/types"
import { resolveSecurity } from "@/core/security/resolve"
import { roleId } from "@/core/security/types"
import { assignRole, saveRole, saveSodRule, setLimit, setPermission } from "@/modules/rbac/commands"
import { rbacDatasetLoaders } from "@/modules/rbac/datasets"
import { explainPermission, limitSources } from "@/modules/rbac/effective"
import { cellState, diffGrants, keysFor, MATRIX_APPS, rowScope } from "@/modules/rbac/matrix"
import { conflictsReport, newHits, sodHits } from "@/modules/rbac/sod"

import { foundationDb, signedIn } from "../helpers/foundation"

/** A stand-in for PAR's customer creation: guarded by the same key. */
const createCustomer = defineCommand({
  name: "par.testCreateCustomer",
  permission: "par.customer.create",
  input: z.object({}),
  async run() {
    return { ok: true }
  },
})

/** Reads the actor's live discount limit inside a commit (as STL does). */
const discountLimit = defineCommand({
  name: "stl.testDiscountLimit",
  permission: "authenticated",
  input: z.object({}),
  async run(tx) {
    return tx.limit("discount-pct")
  },
})

const ADVISOR = roleId("ADVISOR")
let db: OmniflowDb
let tahmid: Actor
beforeEach(async () => {
  db = await foundationDb("rbac")
  tahmid = await signedIn(db, "tahmid")
})
afterEach(async () => {
  await db.delete()
})

async function keysOf(role: string): Promise<Map<string, string>> {
  return new Map((await db.rolePermissions.where("roleId").equals(role).toArray()).map((r) => [r.permission, r.scope]))
}

describe("rbac.setPermission (E13)", () => {
  it("revoking the advisor's par.customer.create stops Nayeem's very next commit; granting it back restores it", async () => {
    const nayeem = await signedIn(db, "nayeem")
    expect((await commit(createCustomer, {}, { db, actor: nayeem })).result.ok).toBe(true)

    const revoked = await commit(
      setPermission,
      { roleId: ADVISOR, changes: [{ permission: "par.customer.create", scope: null }], reason: "E13" },
      { db, actor: tahmid }
    )
    expect(revoked.result.revoked).toEqual(["par.customer.create"])
    expect(revoked.events.map((e) => [e.type, e.refs.roleId])).toEqual([["PermissionRevoked", ADVISOR]])
    expect((await resolveSecurity(db, "usr_nayeem")).grants.has("par.customer.create")).toBe(false)
    await expect(commit(createCustomer, {}, { db, actor: nayeem })).rejects.toMatchObject({ kind: "denied" })

    const granted = await commit(
      setPermission,
      { roleId: ADVISOR, changes: [{ permission: "par.customer.create", scope: "all" }] },
      { db, actor: tahmid }
    )
    expect(granted.events.map((e) => e.type)).toEqual(["PermissionGranted"])
    expect((await commit(createCustomer, {}, { db, actor: nayeem })).result.ok).toBe(true)
  })

  it("changes a grant's scope in place and ignores no-op changes", async () => {
    const { result } = await commit(
      setPermission,
      {
        roleId: ADVISOR,
        changes: [
          { permission: "stl.quote.create", scope: "all" },
          { permission: "par.vendor.create", scope: null },
        ],
      },
      { db, actor: tahmid }
    )
    expect(result).toMatchObject({ granted: ["stl.quote.create"], revoked: [] })
    expect((await keysOf(ADVISOR)).get("stl.quote.create")).toBe("all")
  })

  it("needs rbac.role.edit, refuses unknown keys and a role the editor holds", async () => {
    const shamima = await signedIn(db, "shamima")
    const change = { roleId: ADVISOR, changes: [{ permission: "par.customer.create", scope: null }] }
    await expect(commit(setPermission, change, { db, actor: shamima })).rejects.toMatchObject({ kind: "denied" })
    await expect(
      commit(setPermission, { roleId: ADVISOR, changes: [{ permission: "par.nothing", scope: "all" }] }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "RBAC_UNKNOWN_KEY" })
    await expect(
      commit(setPermission, { roleId: roleId("SYS_ADMIN"), changes: [{ permission: "fa.app.view", scope: "all" }] }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "RBAC_OWN_ROLE" })
  })

  it("segregation of duties: a block rule refuses (SOD-02), a warn rule flags (SOD-01)", async () => {
    await expect(
      commit(setPermission, { roleId: roleId("PROCUREMENT"), changes: [{ permission: "ap.payment.approve", scope: "all" }] }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "SOD_BLOCKED", params: { rule: "SOD-02" } })
    expect((await keysOf(roleId("PROCUREMENT"))).has("ap.payment.approve")).toBe(false)

    const { result, events } = await commit(
      setPermission,
      { roleId: roleId("ACCOUNTANT"), changes: [{ permission: "fa.journal.approve", scope: "all" }] },
      { db, actor: tahmid }
    )
    expect(result.flagged).toEqual(["SOD-01"])
    expect(events.map((e) => e.type)).toEqual(["PermissionGranted", "SodConflictFlagged"])
  })
})

describe("rbac.assignRole", () => {
  it("assigns and removes a role, flagging new warn conflicts of the combined roles", async () => {
    const assigned = await commit(assignRole, { userId: "usr_nayeem", roleId: roleId("STUDIO_MGR"), assign: true }, { db, actor: tahmid })
    expect(assigned.result.changed).toBe(true)
    expect(assigned.result.flagged).toEqual(expect.arrayContaining(["SOD-05", "SOD-06"]))
    expect(assigned.events.map((e) => e.type)).toContain("RoleAssigned")
    expect((await resolveSecurity(db, "usr_nayeem")).roleCodes).toEqual(expect.arrayContaining(["ADVISOR", "STUDIO_MGR"]))

    const again = await commit(assignRole, { userId: "usr_nayeem", roleId: roleId("STUDIO_MGR"), assign: true }, { db, actor: tahmid })
    expect(again.result.changed).toBe(false)

    const removed = await commit(assignRole, { userId: "usr_nayeem", roleId: roleId("STUDIO_MGR"), assign: false }, { db, actor: tahmid })
    expect(removed.events.map((e) => [e.type, e.refs.userId])).toEqual([["RoleUnassigned", "usr_nayeem"]])
  })

  it("refuses SOD-04 (role assignment with an approve key) and changing your own roles", async () => {
    await expect(
      commit(assignRole, { userId: "usr_farzana", roleId: roleId("SYS_ADMIN"), assign: true }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "SOD_BLOCKED", params: { rule: "SOD-04" } })
    await expect(
      commit(assignRole, { userId: tahmid.userId, roleId: roleId("AUDITOR"), assign: true }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "RBAC_OWN_ASSIGNMENT" })
  })
})

describe("rbac.setLimit (E13)", () => {
  it("sets the advisor discount limit to 0% and back; the engine reads it on the next commit", async () => {
    const nayeem = await signedIn(db, "nayeem")
    expect((await commit(discountLimit, {}, { db, actor: nayeem })).result).toBe(5)
    const { events } = await commit(setLimit, { roleId: ADVISOR, kind: "discount-pct", value: 0 }, { db, actor: tahmid })
    expect(events.map((e) => [e.type, e.params.kind])).toEqual([["LimitChanged", "Discount"]])
    expect((await commit(discountLimit, {}, { db, actor: nayeem })).result).toBe(0)
    await commit(setLimit, { roleId: ADVISOR, kind: "discount-pct", value: 5 }, { db, actor: tahmid })
    expect((await commit(discountLimit, {}, { db, actor: nayeem })).result).toBe(5)
  })

  it("accepts -1 as unlimited and refuses invalid values and your own role", async () => {
    await commit(setLimit, { roleId: roleId("STUDIO_MGR"), kind: "payment", value: -1 }, { db, actor: tahmid })
    expect((await resolveSecurity(db, "usr_shahriar")).limits.payment).toBe(Infinity)
    await expect(commit(setLimit, { roleId: ADVISOR, kind: "discount-pct", value: 120 }, { db, actor: tahmid })).rejects.toMatchObject({
      code: "RBAC_LIMIT_INVALID",
    })
    await expect(commit(setLimit, { roleId: ADVISOR, kind: "credit-override", value: 2 }, { db, actor: tahmid })).rejects.toMatchObject({
      code: "RBAC_LIMIT_INVALID",
    })
    await expect(
      commit(setLimit, { roleId: roleId("SYS_ADMIN"), kind: "journal", value: 100 }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "RBAC_OWN_LIMIT" })
  })
})

describe("rbac.saveRole and rbac.saveSodRule", () => {
  it("creates a role from an existing one (grants and limits copied) and keeps system codes fixed", async () => {
    const { result, events } = await commit(
      saveRole,
      { code: "wash_lead", nameEn: "Wash Lead", nameBn: "ওয়াশ লিড", copyFrom: ADVISOR },
      { db, actor: tahmid }
    )
    expect(events.map((e) => e.type)).toEqual(["RoleSaved"])
    const role = (await db.roles.get(result.roleId))!
    expect(role).toMatchObject({ code: "WASH_LEAD", isSystem: false, active: true })
    expect([...(await keysOf(role.id)).keys()].sort()).toEqual([...(await keysOf(ADVISOR)).keys()].sort())
    const limits = await db.approvalLimits.where("roleId").equals(role.id).toArray()
    expect(limits).toHaveLength(8)
    expect(limits.find((l) => l.kind === "discount-pct")?.value).toBe(5)

    await expect(commit(saveRole, { code: "WASH_LEAD", nameEn: "Again", nameBn: "আবার" }, { db, actor: tahmid })).rejects.toMatchObject({
      code: "RBAC_ROLE_CODE_TAKEN",
    })
    const advisor = (await db.roles.get(ADVISOR))!
    await expect(
      commit(saveRole, { id: ADVISOR, code: "ADV", nameEn: advisor.nameEn, nameBn: advisor.nameBn }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "RBAC_SYSTEM_ROLE_CODE" })
  })

  it("saves a new SoD rule and refuses unknown keys", async () => {
    const { events } = await commit(
      saveSodRule,
      {
        code: "SOD-07",
        permissionA: "grn.receive.create",
        permissionB: "ap.bill.create",
        mode: "warn",
        descriptionEn: "Receiving goods and recording the bill",
        descriptionBn: "পণ্য গ্রহণ ও বিল লিপিবদ্ধ",
      },
      { db, actor: tahmid }
    )
    expect(events.map((e) => e.type)).toEqual(["SodRuleSaved"])
    expect(await db.sodRules.where("code").equals("SOD-07").count()).toBe(1)
    await expect(
      commit(
        saveSodRule,
        { code: "SOD-08", permissionA: "nope.key", permissionB: "*.approve", mode: "block", descriptionEn: "x y", descriptionBn: "ক" },
        { db, actor: tahmid }
      )
    ).rejects.toMatchObject({ code: "RBAC_UNKNOWN_KEY" })
  })
})

describe("RBAC pure model", () => {
  it("matrix cells: the advisor's PAR create cell is indeterminate (customer yes, vendor no)", async () => {
    const grants = await keysOf(ADVISOR)
    const keys = keysFor("par", "create")
    expect(keys).toEqual(["par.customer.create", "par.vendor.create"])
    expect(cellState(keys, (k) => grants.has(k))).toBe("indeterminate")
    expect(cellState(keysFor("par", "view"), (k) => grants.has(k))).toBe("checked")
    expect(cellState(keysFor("fa", "approve"), (k) => grants.has(k))).toBe("unchecked")
    expect(cellState(keysFor("sac", "approve"), () => true)).toBe("none")
    expect(rowScope("stl", (k) => (grants.get(k) as "all" | "own-location") ?? null)).toBe("own-location")
    expect(MATRIX_APPS).toContain("dashboard")
    expect(diffGrants(new Map([["a.b.c", "all"]]), new Map([["a.b.c", "all"]]))).toEqual([])
  })

  it("SoD: *.approve matches any approve-column key; the seeded roles break only warn rules", async () => {
    const rules = await db.sodRules.toArray()
    expect(sodHits(["rbac.assign.edit", "fa.journal.approve"], rules).map((h) => h.rule.code)).toEqual(["SOD-04"])
    expect(sodHits(["rbac.assign.edit", "sac.user.edit"], rules)).toEqual([])
    expect(newHits(["fa.journal.create"], ["fa.journal.create", "fa.journal.approve"], rules).map((h) => h.rule.code)).toEqual(["SOD-01"])

    const [roles, grants, userRoles] = await Promise.all([db.roles.toArray(), db.rolePermissions.toArray(), db.userRoles.toArray()])
    const keysByRole = new Map<string, Set<string>>()
    for (const g of grants) keysByRole.set(g.roleId, (keysByRole.get(g.roleId) ?? new Set()).add(g.permission))
    const rolesByUser = new Map<string, string[]>()
    for (const ur of userRoles) rolesByUser.set(ur.userId, [...(rolesByUser.get(ur.userId) ?? []), ur.roleId])
    const report = conflictsReport({ rules, roles, keysByRole, rolesByUser })
    const byRole = report.map((r) => `${r.subjectId}:${r.hit.rule.code}`).sort()
    expect(byRole).toEqual(
      [
        `${roleId("ACC_MGR")}:SOD-01`,
        `${roleId("ACC_MGR")}:SOD-03`,
        `${roleId("STUDIO_MGR")}:SOD-05`,
        `${roleId("STUDIO_MGR")}:SOD-06`,
      ].sort()
    )
    expect(report.every((r) => r.hit.rule.mode === "warn")).toBe(true)
  })

  it("effective permissions explain grants, scope, status and limits", async () => {
    const [roles, rolePermissions, limits] = await Promise.all([db.roles.toArray(), db.rolePermissions.toArray(), db.approvalLimits.toArray()])
    const nayeem = (await db.users.get("usr_nayeem"))!
    const yes = explainPermission({ user: nayeem, heldRoleIds: [ADVISOR], roles, rolePermissions, key: "par.customer.create" })
    expect(yes).toMatchObject({ granted: true, allowed: true, scope: "all", sources: [{ roleId: ADVISOR, scope: "all" }] })

    const elsewhere = explainPermission({ user: nayeem, heldRoleIds: [ADVISOR], roles, rolePermissions, key: "stl.quote.create", locationId: "loc_utt" })
    expect(elsewhere).toMatchObject({ granted: true, allowed: false, scope: "own-location", inScope: false })

    const no = explainPermission({ user: nayeem, heldRoleIds: [ADVISOR], roles, rolePermissions, key: "fa.journal.approve" })
    expect(no.granted).toBe(false)
    expect(no.otherRoles.sort()).toEqual([roleId("ACC_MGR"), roleId("OWNER")].sort())

    const polash = (await db.users.get("usr_polash"))!
    const locked = explainPermission({ user: polash, heldRoleIds: [roleId("TECHNICIAN")], roles, rolePermissions, key: "stl.job.work" })
    expect(locked).toMatchObject({ granted: true, allowed: false, status: "locked" })

    const sources = limitSources({ heldRoleIds: [ADVISOR, roleId("STUDIO_MGR")], roles, limits })
    expect(sources.find((s) => s.kind === "discount-pct")).toMatchObject({ value: 15, roleId: roleId("STUDIO_MGR") })
  })

  it("rbac.access lists one row per user, role and key, narrowed by location", async () => {
    const rows = await rbacDatasetLoaders["rbac.access"](db, {})
    expect(rows.some((r) => r.username === "nayeem" && r.permission === "par.customer.create" && r.column === "create" && r.scope === "all")).toBe(true)
    expect(rows.some((r) => r.username === "tahmid" && r.role === "System Administrator")).toBe(true)
    const utt = await rbacDatasetLoaders["rbac.access"](db, { locationId: "loc_utt" })
    expect(utt.some((r) => r.username === "nayeem")).toBe(false)
    expect(utt.some((r) => r.username === "shuvo")).toBe(true)
  })
})
