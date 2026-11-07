import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { ConflictError, PermissionDenied } from "@/core/engine/errors"
import { SYSTEM_ACTOR, type Actor, type CommandDef } from "@/core/engine/types"
import { trialBalance } from "@/core/ledger/statements"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { endSession, signIn } from "@/core/security/signin"
import { roleId } from "@/core/security/types"
import { seedDatabase } from "@/core/seed"
import { PTY } from "@/core/seed/content/seed-refs"
import { dhakaAt } from "@/core/seed/time"
import { saveReport } from "@/modules/irt/commands"
import { createParty, partyFields, updateParty } from "@/modules/par/commands"
import { setLimit, setPermission } from "@/modules/rbac/commands"
import { unlockUser } from "@/modules/sac/commands"

import { freshDb, signedIn } from "../helpers/foundation"

/**
 * The main agent's scenario launchers E13 to E16 (plan §10), each run twice
 * in a row on the small seed, with the presenter's key action after each run
 * through the real commands.
 */
let db: OmniflowDb
const today = dhakaDate(now())
const ADVISOR = roleId("ADVISOR")

async function as(username: string): Promise<Actor> {
  return signedIn(db, username)
}
async function act<S extends z.ZodType, O>(def: CommandDef<S, O>, input: z.input<S>, actor: Actor): Promise<O> {
  return (await commit(def, input, { db, actor })).result
}
const launch = (id: string) => runScenario(SCENARIOS.find((s) => s.id === id)!, db)
const newCustomer = (n: number) => ({
  isCustomer: true,
  isVendor: false,
  type: "individual" as const,
  nameEn: `E13 Test Customer ${n}`,
  segment: "retail" as const,
  phone: `01999-1000${n}`,
})

beforeAll(async () => {
  db = await freshDb("main-launchers")
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
  applyClockOffset(atDhaka(today, "10:30") - Date.now())
}, 180_000)
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("E13 live permission revoke", () => {
  it("restores the advisor's grants and limits each run; the revoke and the 0% limit bite", async () => {
    for (let run = 1; run <= 2; run++) {
      const out = await launch("E13")
      expect(out.route).toBe(`/rbac/roles/${ADVISOR}`)
      expect(out.companionRoute).toBe("/stl/quotations/new")
      const grant = await db.rolePermissions.where("roleId").equals(ADVISOR).filter((r) => r.permission === "par.customer.create").first()
      expect(grant?.scope).toBe("all")
      const limit = await db.approvalLimits.where("[roleId+kind]").equals([ADVISOR, "discount-pct"]).first()
      expect(limit?.value).toBe(5)
      // Nayeem can create a customer before the revoke.
      const nayeem = await as("nayeem")
      await act(createParty, newCustomer(run * 2), nayeem)
      // The presenter revokes the key and sets the limit to 0%.
      const tahmid = await as("tahmid")
      await act(setPermission, { roleId: ADVISOR, changes: [{ permission: "par.customer.create", scope: null }] }, tahmid)
      await act(setLimit, { roleId: ADVISOR, kind: "discount-pct", value: 0 }, tahmid)
      await expect(act(createParty, newCustomer(run * 2 + 1), nayeem)).rejects.toBeInstanceOf(PermissionDenied)
      expect((await db.approvalLimits.where("[roleId+kind]").equals([ADVISOR, "discount-pct"]).first())?.value).toBe(0)
    }
  })
})

describe("E14 lockout and forced sign-out", () => {
  it("starts with Shuvo unlocked each run; five wrong passwords lock him, unlock works, Nayeem's session ends", async () => {
    for (let run = 1; run <= 2; run++) {
      const out = await launch("E14")
      expect(out.route).toBe("/sac")
      const [shuvo] = await db.users.where("username").equals("shuvo").toArray()
      expect(shuvo.status).toBe("active")
      expect(shuvo.failedAttempts).toBe(0)
      for (let i = 0; i < 5; i++) {
        await commit(signIn, { username: "shuvo", password: `wrong-${i}`, windowId: `of-e14-${run}-${i}`, method: "password" }, { db, actor: SYSTEM_ACTOR })
      }
      expect((await db.users.get(shuvo.id))?.status).toBe("locked")
      const tahmid = await as("tahmid")
      if (run === 1) await act(unlockUser, { userId: shuvo.id }, tahmid)
      // On the second run Shuvo stays locked: the next launch must unlock him itself.
      const nayeem = await as("nayeem")
      await act(endSession, { sessionId: nayeem.sessionId!, reason: "E14 forced sign-out" }, tahmid)
      expect((await db.sessions.get(nayeem.sessionId!))?.endedAt).toBeTruthy()
    }
    await launch("E14")
    const [shuvo] = await db.users.where("username").equals("shuvo").toArray()
    expect(shuvo.status).toBe("active")
  })
})

describe("E15 concurrent edit", () => {
  it("each run opens Greenway in two panes and the second stale save conflicts", async () => {
    for (let run = 1; run <= 2; run++) {
      const out = await launch("E15")
      expect(out.route).toBe(`/par/${PTY.greenway}`)
      expect(out.companionRoute).toBe(`/par/${PTY.greenway}`)
      const party = (await db.parties.get(PTY.greenway))!
      const fields = partyFields.parse(party)
      const farzana = await as("farzana")
      const mahbub = await as("mahbub")
      await act(updateParty, { partyId: party.id, expectedVersion: party.version, fields: { ...fields, phone: String(out.outcome.params?.first) } }, farzana)
      await expect(
        act(updateParty, { partyId: party.id, expectedVersion: party.version, fields: { ...fields, phone: String(out.outcome.params?.second) } }, mahbub)
      ).rejects.toBeInstanceOf(ConflictError)
      expect((await db.parties.get(PTY.greenway))?.phone).toBe(out.outcome.params?.first)
    }
  })
})

describe("E16 report builder", () => {
  it("needs no setup; each run saves a new report of Rashed's", async () => {
    const numbers: string[] = []
    for (let run = 1; run <= 2; run++) {
      const out = await launch("E16")
      expect(out.route).toBe("/irt/builder")
      const saved = await act(
        saveReport,
        {
          nameEn: "Revenue by service category and studio",
          nameBn: "সেবার বিভাগ ও স্টুডিও অনুযায়ী আয়",
          dataset: "si.invoiceLines",
          columns: ["category", "location", "netP"],
          groupBy: ["category", "location"],
          totals: ["netP"],
          chart: { kind: "bar", x: "category", y: "netP", series: "location" },
          dateRange: { field: "date", lastDays: 30 },
          shared: true,
        },
        await as("rashed")
      )
      numbers.push(String((saved as { code?: string }).code ?? (saved as { reportId?: string }).reportId))
    }
    expect(new Set(numbers).size).toBe(2)
  })
})

describe("after every main launcher", () => {
  it("the books tie", async () => {
    const tb = trialBalance(await db.accounts.toArray(), await db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" })
    expect(tb.balanced).toBe(true)
  })
})
