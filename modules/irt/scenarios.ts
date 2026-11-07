import type { ScenarioDef } from "@/core/scenarios/types"

/**
 * IRT scenario launchers (implementation_plan.md §10).
 * E16: the report builder. Rashed builds "revenue by service category and
 * studio" for the last 30 days with a bar chart, saves it, runs and exports
 * it. No data to prepare: every run saves a new report of his own.
 */
export const irtScenarios: ScenarioDef[] = [
  {
    id: "E16",
    kind: "scenario",
    module: "irt",
    titleKey: "irt.scenarios.E16.title",
    summaryKey: "irt.scenarios.E16.summary",
    user: "rashed",
    route: () => "/irt/builder",
    cueKeys: ["irt.scenarios.E16.cue1", "irt.scenarios.E16.cue2", "irt.scenarios.E16.cue3", "irt.scenarios.E16.cue4", "irt.scenarios.E16.cue5"],
  },
]
