import * as React from "react"

import { EffectiveScreen } from "@/modules/rbac/components/effective"

/** /rbac/effective: the effective permissions checker (`?for=<username>&key=` preselect; never `?user=`, which is the quick sign-in, so Suspense). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <EffectiveScreen />
    </React.Suspense>
  )
}
