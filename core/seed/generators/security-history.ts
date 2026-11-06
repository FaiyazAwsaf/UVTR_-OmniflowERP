import { SEED_USERS } from "@/core/security/seed-users"

import { PLANT, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { dhakaAt, isoAddDays, isoWeekday, MINUTE } from "../time"

/**
 * Login history and sessions (seed_data.md §2.4): 30 days of sign-ins for
 * every user on their working days (studio staff 08:30 to 10:00, head office
 * 09:00 to 10:00), a few failed attempts, Polash's five failures yesterday
 * (locked), and Rashed's session from another device yesterday that ended by
 * timeout. Every other session ended with a sign-out the same evening.
 */
export function seedLoginHistory(w: World): void {
  const { bag } = w.ctx
  const rng = w.rng("logins")
  const { today, yesterday } = w.cal
  const office = new Set(["HQ", "CST"])
  SEED_USERS.forEach((u, index) => {
    let last = 0
    for (let back = 30; back >= 1; back--) {
      const day = isoAddDays(today, -back)
      const wd = isoWeekday(day)
      const atOffice = office.has(u.home)
      if (u.username === "shamima" && wd !== 1 && wd !== 3) continue
      if (atOffice && (wd === 5 || wd === 6)) continue
      if (!atOffice && wd === (index % 7)) continue
      const windowId = `of-hist-${u.username}-${day}`
      if (u.username === "polash" && day === yesterday) {
        for (let k = 0; k < 5; k++) {
          const at = dhakaAt(day, "08:41") + k * 70_000
          bag.put("loginEvents", w.ctx.seq("lgn"), at, { username: u.username, userId: u.id, at, result: "bad-password", method: "password", windowId })
        }
        continue
      }
      const start = atOffice ? dhakaAt(day, "09:00") : dhakaAt(day, "08:30")
      const at = start + rng.int(0, atOffice ? 60 : 90) * MINUTE
      if (rng.bool(0.03)) {
        bag.put("loginEvents", w.ctx.seq("lgn"), at - 2 * MINUTE, { username: u.username, userId: u.id, at: at - 2 * MINUTE, result: "bad-password", method: "password", windowId })
      }
      bag.put("loginEvents", w.ctx.seq("lgn"), at, { username: u.username, userId: u.id, at, result: "success", method: u.mfaEnabled ? "mfa" : "password", windowId })
      const ended = dhakaAt(day, `${rng.int(17, 21)}:${rng.pick(["05", "20", "35", "50"])}`)
      bag.put("sessions", w.ctx.seq("ses"), at, {
        userId: u.id,
        windowId,
        locationId: `loc_${u.home.toLowerCase()}`,
        startedAt: at,
        lastActivityRealAt: ended - 10 * MINUTE,
        endedAt: ended,
        endedReason: "sign-out",
        endedBy: u.id,
        method: "password",
      }, u.id)
      last = at
    }
    // Rashed, from another device last night: ended by the idle timeout (480 minutes).
    if (u.id === USR.rashed) {
      const at = dhakaAt(yesterday, "20:10")
      bag.put("loginEvents", w.ctx.seq("lgn"), at, { username: u.username, userId: u.id, at, result: "success", method: "password", windowId: "of-device-2" })
      bag.put("sessions", PLANT.rashedTimeoutSession, at, {
        userId: u.id,
        windowId: "of-device-2",
        locationId: "loc_hq",
        startedAt: at,
        lastActivityRealAt: at + 25 * MINUTE,
        endedAt: at + (25 + 480) * MINUTE,
        endedReason: "timeout",
        endedBy: "system",
        method: "password",
      }, u.id)
      last = Math.max(last, at)
    }
    const user = bag.get("users", u.id)
    if (last) user.lastLoginAt = last
  })
}
