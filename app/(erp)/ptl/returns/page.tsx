"use client"

import * as React from "react"

import { ReturnsScreen } from "@/modules/ptl/components/returns"

/** /ptl/returns: purchase returns and debit notes (implementation_plan.md §9); reads `?grn=` and `?id=`, so it sits in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <ReturnsScreen />
    </React.Suspense>
  )
}
