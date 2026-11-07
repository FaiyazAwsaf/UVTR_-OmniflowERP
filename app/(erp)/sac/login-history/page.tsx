import * as React from "react"

import { LoginHistory } from "@/modules/sac/components/login-history"

/** /sac/login-history: every sign-in attempt (`?user=` preselects a user, so it sits in Suspense). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <LoginHistory />
    </React.Suspense>
  )
}
