import * as React from "react"

import { EffectiveScreen } from "@/modules/rbac/components/effective"

/** /rbac/effective: the effective permissions checker (`?user=&key=` preselect, so Suspense). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <EffectiveScreen />
    </React.Suspense>
  )
}
