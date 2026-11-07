import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { readSetting } from "@/core/db/settings"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { runReport } from "@/core/reports/runner"
import { endSession, signIn } from "@/core/security/signin"
import { resetPassword, saveUser, savePolicy, setUserStatus, unlockUser } from "@/modules/sac/commands"
import { sacDatasetLoaders } from "@/modules/sac/datasets"
import { tempPasswordFor } from "@/modules/sac/temp-password"

import { foundationDb, signedIn } from "../helpers/foundation"

/** Any signed-in user may run it: proves the actor's session and status are still good. */
const ping = defineCommand({
  name: "test.ping",
  permission: "authenticated",
  input: z.object({}),
  async run() {
    return { ok: true }
  },
})

let db: OmniflowDb
let tahmid: Actor
beforeEach(async () => {
  db = await foundationDb("sac")
  tahmid = await signedIn(db, "tahmid")
})
afterEach(async () => {
  await db.delete()
})

function passwordSignIn(username: string, password: string) {
  return commit(signIn, { username, password, windowId: `of-test-${username}`, method: "password" }, { db, actor: SYSTEM_ACTOR })
}

const newUser = {
  username: "nadia",
  nameEn: "Nadia Rahman",
  nameBn: "নাদিয়া রহমান",
  designationEn: "Wash lead",
  designationBn: "ওয়াশ লিড",
  email: "nadia@example.com",
  phone: "01711-000111",
  employeeNo: "AM-2001",
  homeLocationId: "loc_gul",
  locationIds: ["loc_gul"],
  mfaEnabled: false,
  sex: "F" as const,
}

describe("sac.saveUser", () => {
  it("creates a user with a one-time temporary password that must be changed", async () => {
    const { result, events } = await commit(saveUser, newUser, { db, actor: tahmid })
    expect(result.tempPassword).toMatch(/^[A-Z][a-z]{4}-\d{4}$/)
    const user = await db.users.get(result.userId)
    expect(user).toMatchObject({ username: "nadia", status: "active", mustChangePassword: true, failedAttempts: 0 })
    expect(events.map((e) => e.type)).toEqual(["UserCreated"])
    // The temporary password signs in; a wrong one does not.
    expect((await passwordSignIn("nadia", "demo1234")).result.status).toBe("failed")
    expect((await passwordSignIn("nadia", result.tempPassword!)).result.status).toBe("ok")
  })

  it("needs sac.user.create for a new user and sac.user.edit for an edit", async () => {
    const mahbub = await signedIn(db, "mahbub")
    await expect(commit(saveUser, newUser, { db, actor: mahbub })).rejects.toMatchObject({ kind: "denied" })
    const blocked = await db.audit.where("action").equals("blocked").toArray()
    expect(blocked.some((r) => r.command === "sac.saveUser" && r.code === "PERMISSION_DENIED")).toBe(true)
  })

  it("edits with the row version, never changes the username and refuses a taken one", async () => {
    const shuvo = (await db.users.get("usr_shuvo"))!
    const edit = { ...newUser, username: "shuvo", nameEn: "Shuvo Das", id: shuvo.id, homeLocationId: "loc_utt", locationIds: ["loc_utt"] }
    await expect(commit(saveUser, { ...edit, expectedVersion: shuvo.version + 1 }, { db, actor: tahmid })).rejects.toMatchObject({
      kind: "conflict",
    })
    const { events } = await commit(saveUser, { ...edit, phone: "01999-000000", expectedVersion: shuvo.version }, { db, actor: tahmid })
    expect(events[0].type).toBe("UserUpdated")
    expect((await db.users.get(shuvo.id))!.phone).toBe("01999-000000")
    await expect(commit(saveUser, { ...edit, username: "shuvo2" }, { db, actor: tahmid })).rejects.toMatchObject({
      code: "SAC_USERNAME_FIXED",
    })
    await expect(commit(saveUser, { ...newUser, username: "nayeem" }, { db, actor: tahmid })).rejects.toMatchObject({
      code: "SAC_USERNAME_TAKEN",
    })
    await expect(
      commit(saveUser, { ...newUser, homeLocationId: "loc_utt", locationIds: ["loc_gul"] }, { db, actor: tahmid })
    ).rejects.toMatchObject({ code: "SAC_HOME_NOT_ALLOWED" })
  })
})

describe("lockout and unlock (E14)", () => {
  it("five wrong passwords lock Shuvo; sac.unlockUser brings him back with 0 attempts", async () => {
    for (let i = 0; i < 5; i++) await passwordSignIn("shuvo", `wrong-${i}`)
    expect((await db.users.get("usr_shuvo"))!).toMatchObject({ status: "locked", failedAttempts: 5 })
    expect((await passwordSignIn("shuvo", "demo1234")).result).toMatchObject({ status: "failed", reason: "locked" })

    const { events } = await commit(unlockUser, { userId: "usr_shuvo", reason: "Called the helpdesk" }, { db, actor: tahmid })
    expect(events.map((e) => e.type)).toEqual(["UserUnlocked"])
    expect((await db.users.get("usr_shuvo"))!).toMatchObject({ status: "active", failedAttempts: 0 })
    const audit = await db.audit.where("entityId").equals("usr_shuvo").reverse().sortBy("seq")
    expect(audit[0]).toMatchObject({ command: "sac.unlockUser", reason: "Called the helpdesk", action: "update" })
    expect((await passwordSignIn("shuvo", "demo1234")).result.status).toBe("ok")

    await expect(commit(unlockUser, { userId: "usr_shuvo" }, { db, actor: tahmid })).rejects.toMatchObject({ code: "SAC_NOT_LOCKED" })
  })

  it("only holders of sac.user.edit unlock", async () => {
    const farzana = await signedIn(db, "farzana")
    await expect(commit(unlockUser, { userId: "usr_polash" }, { db, actor: farzana })).rejects.toMatchObject({ kind: "denied" })
  })
})

describe("sac.resetPassword", () => {
  it("replaces the password with a temporary one and flags mustChangePassword", async () => {
    const { result, events } = await commit(resetPassword, { userId: "usr_sabbir" }, { db, actor: tahmid })
    expect(events.map((e) => e.type)).toEqual(["PasswordReset"])
    expect((await db.users.get("usr_sabbir"))!.mustChangePassword).toBe(true)
    expect((await passwordSignIn("sabbir", "demo1234")).result.status).toBe("failed")
    expect((await passwordSignIn("sabbir", result.tempPassword)).result.status).toBe("ok")
    // The hash never appears in clear: the temporary password is only in the result.
    const audit = await db.audit.where("entityId").equals("usr_sabbir").toArray()
    expect(JSON.stringify(audit)).not.toContain(result.tempPassword)
  })

  it("refuses resetting your own password", async () => {
    await expect(commit(resetPassword, { userId: tahmid.userId }, { db, actor: tahmid })).rejects.toMatchObject({ code: "SAC_OWN_RESET" })
  })

  it("derives readable temporary passwords that meet the policy", () => {
    for (const seed of ["cm_a", "cm_b", "cm_c"]) {
      const value = tempPasswordFor(seed)
      expect(value.length).toBeGreaterThanOrEqual(8)
      expect(value).toMatch(/\d/)
    }
    expect(tempPasswordFor("cm_same")).toBe(tempPasswordFor("cm_same"))
  })
})

describe("sac.setUserStatus and forced sign-out", () => {
  it("disabling a user ends their open sessions and refuses their next commit", async () => {
    const nayeem = await signedIn(db, "nayeem")
    expect((await commit(ping, {}, { db, actor: nayeem })).result.ok).toBe(true)
    const { result, events } = await commit(setUserStatus, { userId: "usr_nayeem", status: "disabled", reason: "Left the company" }, { db, actor: tahmid })
    expect(result.sessionsEnded).toBe(1)
    expect(events.map((e) => e.type).sort()).toEqual(["SessionEnded", "UserUpdated"])
    const session = await db.sessions.get(nayeem.sessionId!)
    expect(session).toMatchObject({ endedReason: "forced", endedBy: tahmid.userId })
    await expect(commit(ping, {}, { db, actor: nayeem })).rejects.toMatchObject({ code: "USER_DISABLED" })
    expect((await passwordSignIn("nayeem", "demo1234")).result).toMatchObject({ status: "failed", reason: "disabled" })

    await commit(setUserStatus, { userId: "usr_nayeem", status: "active" }, { db, actor: tahmid })
    expect((await passwordSignIn("nayeem", "demo1234")).result.status).toBe("ok")
  })

  it("never disables yourself, and a locked user is unlocked rather than enabled", async () => {
    await expect(commit(setUserStatus, { userId: tahmid.userId, status: "disabled" }, { db, actor: tahmid })).rejects.toMatchObject({
      code: "SAC_OWN_STATUS",
    })
    await expect(commit(setUserStatus, { userId: "usr_polash", status: "active" }, { db, actor: tahmid })).rejects.toMatchObject({
      code: "SAC_USE_UNLOCK",
    })
  })

  it("sac.endSession (core) signs the other window out: its next commit is refused", async () => {
    const nayeem = await signedIn(db, "nayeem")
    const { events } = await commit(endSession, { sessionId: nayeem.sessionId!, reason: "Demo" }, { db, actor: tahmid })
    expect(events.map((e) => e.type)).toEqual(["SessionEnded"])
    await expect(commit(ping, {}, { db, actor: nayeem })).rejects.toMatchObject({ code: "SESSION_ENDED" })
  })
})

describe("sac.savePolicy", () => {
  it("changes the lockout threshold for the next sign-in and turns MFA on for required roles", async () => {
    const before = await readSetting(db, "security")
    const row = await db.settings.get("security")
    const { result, events } = await commit(
      savePolicy,
      { ...before, lockoutThreshold: 3, mfaRequiredRoles: ["SYS_ADMIN", "ACCOUNTANT"], expectedVersion: row?.version },
      { db, actor: tahmid }
    )
    expect(events.map((e) => e.type)).toEqual(["PolicyChanged"])
    expect(result.changed).toEqual(expect.arrayContaining(["lockoutThreshold", "mfaRequiredRoles"]))
    expect(result.mfaTurnedOn).toBe(1)
    expect((await db.users.get("usr_mahbub"))!.mfaEnabled).toBe(true)
    for (let i = 0; i < 3; i++) await passwordSignIn("arif", `bad-${i}`)
    expect((await db.users.get("usr_arif"))!.status).toBe("locked")
  })

  it("refuses values out of range and users without sac.policy.configure", async () => {
    const before = await readSetting(db, "security")
    await expect(commit(savePolicy, { ...before, lockoutThreshold: 1 }, { db, actor: tahmid })).rejects.toMatchObject({
      kind: "validation",
    })
    const rashed = await signedIn(db, "rashed")
    await expect(commit(savePolicy, before, { db, actor: rashed })).rejects.toMatchObject({ kind: "denied" })
  })
})

describe("SAC datasets (plan §3.19.1)", () => {
  it("sac.logins lists today's sign-ins and failures; sac.audit lists the audit rows", async () => {
    await passwordSignIn("mahbub", "nope")
    const today = dhakaDate(now())
    const logins = await sacDatasetLoaders["sac.logins"](db, { from: today, to: today })
    expect(logins.some((r) => r.username === "tahmid" && r.result === "success")).toBe(true)
    expect(logins.some((r) => r.username === "mahbub" && r.result === "bad-password" && r.user === "Mahbub Alam")).toBe(true)

    await commit(unlockUser, { userId: "usr_polash" }, { db, actor: tahmid })
    const audit = await sacDatasetLoaders["sac.audit"](db, { from: today, to: today })
    expect(audit.some((r) => r.entity === "users" && r.action === "update" && r.user === "Tahmid Hasan" && r.app === "sac")).toBe(true)

    const report = await runReport(db, { dataset: "sac.logins", columns: ["date", "user", "result"], filters: [], groupBy: ["user"], totals: [] }, { from: today, to: today })
    expect(report.groups?.length).toBeGreaterThan(0)
    expect(report.rowCount).toBe(logins.length)
  })
})
