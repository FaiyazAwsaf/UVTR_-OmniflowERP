import * as React from "react"

import { Builder } from "@/modules/irt/components/builder"

/** /irt/builder: the report builder (`?id=` edits a saved report, `?from=` copies one, so Suspense). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Builder />
    </React.Suspense>
  )
}
