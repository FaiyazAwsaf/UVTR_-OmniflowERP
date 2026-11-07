import type { ScenarioDef } from "@/core/scenarios/types"

import { setUserStatus, unlockUser } from "./commands"

/**
 * SAC scenario launchers (implementation_plan.md §10).
 * E14: lockout and forced sign-out. Shuvo starts unlocked with no failed
 * attempts; five wrong passwords in another window lock him (live in
 * Tahmid's user list); Tahmid unlocks him; then ends Nayeem's session and
 * Nayeem's window (the companion pane) returns to the sign-in screen.
 */
export const sacScenarios: ScenarioDef[] = [
  {
    id: "E14",
    kind: "scenario",
    module: "sac",
    titleKey: "sac.scenarios.E14.title",
    summaryKey: "sac.scenarios.E14.summary",
    user: "tahmid",
    async setup(kit) {
      for (const username of ["shuvo", "nayeem"]) {
        const [user] = await kit.db.users.where("username").equals(username).toArray()
        if (!user) continue
        if (user.status === "locked") {
          await kit.run(unlockUser, { userId: user.id, reason: "Demo setup: unlocked for the scenario" }, "tahmid")
        } else if (user.status === "disabled") {
          await kit.run(setUserStatus, { userId: user.id, status: "active", reason: "Demo setup: enabled for the scenario" }, "tahmid")
        }
        const fresh = (await kit.db.users.get(user.id))!
        if (fresh.failedAttempts > 0) {
          // No command clears failed attempts on an active user: an audited fixture does.
          await kit.fixture(`clear failed attempts of ${username}`, (tx) => tx.update("users", user.id, { failedAttempts: 0 }))
        }
      }
      return { params: { user: "shuvo", attempts: 5 } }
    },
    route: () => "/sac",
    cueKeys: ["sac.scenarios.E14.cue1", "sac.scenarios.E14.cue2", "sac.scenarios.E14.cue3", "sac.scenarios.E14.cue4", "sac.scenarios.E14.cue5"],
    companion: { user: "nayeem", route: () => "/stl/board" },
  },
]
