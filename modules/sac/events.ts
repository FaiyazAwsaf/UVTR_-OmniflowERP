import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by SAC (implementation_plan.md §3.10). */
export const sacEvents: EventCatalog = {
  SignedIn: {
    module: "sac",
    labelKey: "sac.events.SignedIn",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "info",
  },
  SignInFailed: {
    module: "sac",
    labelKey: "sac.events.SignInFailed",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "warning",
  },
  UserLocked: {
    module: "sac",
    labelKey: "sac.events.UserLocked",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "critical",
  },
  UserUnlocked: {
    module: "sac",
    labelKey: "sac.events.UserUnlocked",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "success",
  },
  SignedOut: {
    module: "sac",
    labelKey: "sac.events.SignedOut",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "info",
  },
  SessionEnded: {
    module: "sac",
    labelKey: "sac.events.SessionEnded",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "warning",
  },
  UserCreated: {
    module: "sac",
    labelKey: "sac.events.UserCreated",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "success",
  },
  UserUpdated: {
    module: "sac",
    labelKey: "sac.events.UserUpdated",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "info",
  },
  PasswordReset: {
    module: "sac",
    labelKey: "sac.events.PasswordReset",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "warning",
  },
  PasswordChanged: {
    module: "sac",
    labelKey: "sac.events.PasswordChanged",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "info",
  },
  PolicyChanged: {
    module: "sac",
    labelKey: "sac.events.PolicyChanged",
    consumers: ["consumers.security", "consumers.audit"],
    severity: "warning",
  },
}
