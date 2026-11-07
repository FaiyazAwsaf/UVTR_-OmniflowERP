"use client"

import * as React from "react"

import { AdjustmentsScreen } from "@/modules/st/components/adjustments"

/** /st/adjustments: stock adjustments (implementation_plan.md §9); reads `?id=` and `?new=`, so it sits in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <AdjustmentsScreen />
    </React.Suspense>
  )
}
