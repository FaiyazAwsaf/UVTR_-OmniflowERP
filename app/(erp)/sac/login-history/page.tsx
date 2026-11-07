import * as React from "react"

import { LoginHistory } from "@/modules/sac/components/login-history"

/** /sac/login-history: every sign-in attempt (`?for=<username>` preselects a user, so it sits in Suspense). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <LoginHistory />
    </React.Suspense>
  )
}
