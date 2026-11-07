import * as React from "react"

import { Assignments } from "@/modules/rbac/components/assignments"

/** /rbac/assignments: user-role assignment (`?user=` searches, so it sits in Suspense). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Assignments />
    </React.Suspense>
  )
}
