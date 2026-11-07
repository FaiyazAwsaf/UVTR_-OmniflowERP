"use client"

import * as React from "react"

import { TrialBalancePage } from "@/modules/frs/components/trial-balance"

/** /frs/trial-balance (plan §9). `?month=` is read in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <TrialBalancePage />
    </React.Suspense>
  )
}
