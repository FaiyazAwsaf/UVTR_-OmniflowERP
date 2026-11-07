import * as React from "react"

import { Runner } from "@/modules/irt/components/runner"

/** /irt/run/[code]: run a report with parameters (`?from=&to=&loc=` from the history, so Suspense). */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return (
    <React.Suspense fallback={null}>
      <Runner code={decodeURIComponent(code)} />
    </React.Suspense>
  )
}
