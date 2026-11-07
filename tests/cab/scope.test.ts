import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { OmniflowDb } from "@/core/db/database"
import type { Id } from "@/core/db/schema"
import { grantAllows, resolveSecurity } from "@/core/security/resolve"
import { CBA } from "@/core/seed/content/seed-refs"
import { canSeeAccount, canSeeTransfer, type CanAt } from "@/modules/cab/lib"

import { foundationDb } from "../helpers/foundation"

/**
 * CAB list scoping (plan §3.9, Phase 2 open item): own-location roles see
 * their location's till and petty cash only; Head Office and all-scope roles
 * see every account; a till deposit shows to the studio and to Head Office.
 */
let db: OmniflowDb

beforeAll(async () => {
  db = await foundationDb("cab-scope")
}, 120_000)
afterAll(async () => {
  await db.delete()
})

/** A user's live permission check, as `usePermissions().can` builds it. */
async function canOf(username: string): Promise<CanAt> {
  const [user] = await db.users.where("username").equals(username).toArray()
  const security = await resolveSecurity(db, user.id)
  return (permission: string, locationId?: Id | null) => grantAllows(security, permission, user.locationIds, locationId)
}

async function visible(username: string): Promise<string[]> {
  const can = await canOf(username)
  return (await db.cashBankAccounts.toArray()).filter((a) => canSeeAccount(can, a)).map((a) => a.id).sort()
}

describe("CAB view scope", () => {
  it("shows a Gulshan cashier and studio manager Gulshan's till and petty cash only", async () => {
    expect(await visible("tania")).toEqual([CBA.PETTY_GUL, CBA.TILL_GUL].sort())
    expect(await visible("shahriar")).toEqual([CBA.PETTY_GUL, CBA.TILL_GUL].sort())
    expect(await visible("sabbir")).toEqual([CBA.PETTY_UTT, CBA.TILL_UTT].sort())
  })

  it("shows Head Office and all-scope roles every account", async () => {
    const all = (await db.cashBankAccounts.toArray()).map((a) => a.id).sort()
    for (const user of ["mahbub", "farzana", "rashed", "shamima"]) expect(await visible(user)).toEqual(all)
  })

  it("shows nothing to roles without the CAB view", async () => {
    expect(await visible("rakib")).toEqual([])
    expect(await visible("nayeem")).toEqual([])
  })

  it("lists a till deposit to the studio and to Head Office, not to the other studio", async () => {
    const accounts = new Map((await db.cashBankAccounts.toArray()).map((a) => [a.id, a]))
    const deposit = { fromAccountId: CBA.TILL_GUL, toAccountId: CBA.DBBL }
    expect(canSeeTransfer(await canOf("tania"), accounts, deposit)).toBe(true)
    expect(canSeeTransfer(await canOf("mahbub"), accounts, deposit)).toBe(true)
    expect(canSeeTransfer(await canOf("sabbir"), accounts, deposit)).toBe(false)
    expect(canSeeTransfer(await canOf("tania"), accounts, { fromAccountId: CBA.BRAC, toAccountId: CBA.PETTY_HQ })).toBe(false)
  })
})
