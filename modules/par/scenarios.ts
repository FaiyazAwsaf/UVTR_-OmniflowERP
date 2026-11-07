import type { ScenarioDef } from "@/core/scenarios/types"
import { PTY } from "@/core/seed/content/seed-refs"

/**
 * PAR scenario launchers (implementation_plan.md §10).
 * E15: a concurrent edit. Farzana (this pane) and Mahbub (the companion, the
 * next Demo Wall pane) open Greenway's party; both edit the contact phone;
 * the second save gets the conflict dialog with who changed it and when
 * (per-record versions, plan §3.3). Nothing to prepare: each run edits the
 * party afresh, so it works any number of times.
 */
export const parScenarios: ScenarioDef[] = [
  {
    id: "E15",
    kind: "scenario",
    module: "par",
    titleKey: "par.scenarios.E15.title",
    summaryKey: "par.scenarios.E15.summary",
    user: "farzana",
    async setup(kit) {
      const party = await kit.db.parties.get(PTY.greenway)
      const stamp = String(kit.now() % 1_000_000).padStart(6, "0")
      return {
        refs: { partyId: PTY.greenway },
        params: {
          party: party?.nameEn ?? "",
          phone: party?.phone ?? "",
          first: `01711-${stamp}`,
          second: `01811-${stamp}`,
        },
      }
    },
    route: () => `/par/${PTY.greenway}`,
    cueKeys: ["par.scenarios.E15.cue1", "par.scenarios.E15.cue2", "par.scenarios.E15.cue3", "par.scenarios.E15.cue4"],
    companion: { user: "mahbub", route: () => `/par/${PTY.greenway}` },
  },
]
