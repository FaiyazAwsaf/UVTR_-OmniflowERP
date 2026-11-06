import type { EventCatalog } from "@/core/events/types"

/** Platform events: engine refusals, approvals and the demo controls (plan §3.10). */
export const demoEvents: EventCatalog = {
  RuleViolationBlocked: {
    module: "engine",
    labelKey: "demo.events.ruleViolationBlocked",
    consumers: ["consumers.audit"],
    severity: "warning",
  },
  PermissionDeniedBlocked: {
    module: "engine",
    labelKey: "demo.events.permissionDeniedBlocked",
    consumers: ["consumers.audit", "consumers.security"],
    severity: "warning",
  },
  ConflictDetected: {
    module: "engine",
    labelKey: "demo.events.conflictDetected",
    consumers: ["consumers.audit"],
    severity: "warning",
  },
  ApprovalRequested: {
    module: "core",
    labelKey: "demo.events.approvalRequested",
    consumers: ["consumers.approverInbox", "consumers.audit"],
    severity: "warning",
  },
  ApprovalDecided: {
    module: "core",
    labelKey: "demo.events.approvalDecided",
    consumers: ["consumers.approverInbox", "consumers.audit"],
    severity: "success",
  },
  DemoReset: {
    module: "demo",
    labelKey: "demo.events.demoReset",
    consumers: ["consumers.allWindows"],
    severity: "info",
  },
  ClockAdvanced: {
    module: "demo",
    labelKey: "demo.events.clockAdvanced",
    consumers: ["consumers.allWindows", "consumers.timers"],
    severity: "info",
  },
  ClockReset: {
    module: "demo",
    labelKey: "demo.events.clockReset",
    consumers: ["consumers.allWindows", "consumers.timers"],
    severity: "info",
  },
  ScenarioLaunched: {
    module: "demo",
    labelKey: "demo.events.scenarioLaunched",
    consumers: ["consumers.presenter", "consumers.audit"],
    severity: "info",
  },
}
