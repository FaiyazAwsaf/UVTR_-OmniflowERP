import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { createDb, type OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { signIn } from "@/core/security/signin"
import { seedFoundation } from "@/core/seed"

let counter = 0

/** A fresh, empty database with a unique name (fake-indexeddb). */
export async function freshDb(prefix = "test"): Promise<OmniflowDb> {
  const db = createDb(`${prefix}-${++counter}-${Math.random().toString(36).slice(2, 8)}`)
  await db.open()
  return db
}

/** A fresh database with the seed foundation: locations, calendar, roles, grants, users. */
export async function foundationDb(prefix = "foundation"): Promise<OmniflowDb> {
  const db = await freshDb(prefix)
  const at = now()
  await seedFoundation(db, { now: at, today: dhakaDate(at), scale: "small" })
  return db
}

/** Signs a user in (quick demo sign-in) and returns their actor with a real session. */
export async function signedIn(
  db: OmniflowDb,
  username: string,
  locationId?: string
): Promise<Actor> {
  const result = await commit(
    signIn,
    { username, windowId: `of-test-${username}-${++counter}`, method: "demo-quick", locationId },
    { db, actor: SYSTEM_ACTOR }
  )
  const outcome = result.result
  if (outcome.status !== "ok") throw new Error(`sign-in failed for ${username}: ${outcome.status}`)
  const user = await db.users.get(outcome.userId)
  if (!user) throw new Error(`no user ${username}`)
  return {
    userId: user.id,
    username: user.username,
    name: user.nameEn,
    nameBn: user.nameBn,
    sessionId: outcome.sessionId,
    locationId: outcome.locationId,
    locationIds: user.locationIds,
  }
}
