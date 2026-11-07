"use client"

import * as React from "react"

import { Reconciliation } from "@/modules/cab/components/reconciliation"

/** /cab/reconciliation: bank reconciliation (plan §9, E7). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Reconciliation />
    </React.Suspense>
  )
}
