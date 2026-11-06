/** SAC strings, English. Every key also lives in bn.ts. */
export const sacEn = {
  sac: {
    name: "User Security",
    description: "Users, sessions, policy and the audit trail",
    pages: {
      home: "Users",
      user: "User",
      sessions: "Active sessions",
      loginHistory: "Login history",
      policy: "Security policy",
      audit: "Audit trail",
    },
    perm: {
      app_view: "Open User Security",
      audit_view: "View the audit trail",
      user_create: "Create users",
      user_edit: "Edit, unlock and reset users",
      session_end: "End sessions",
      policy_configure: "Configure the security policy",
    },
    events: {
      SignedIn: "{user} signed in",
      SignInFailed: "Failed sign-in for {user}",
      UserLocked: "{user} locked",
      UserUnlocked: "{user} unlocked",
      SignedOut: "{user} signed out",
      SessionEnded: "Session of {user} ended",
      UserCreated: "User {user} created",
      UserUpdated: "User {user} updated",
      PasswordReset: "Password reset for {user}",
      PasswordChanged: "{user} changed their password",
      PolicyChanged: "Security policy changed",
    },
  },
}
