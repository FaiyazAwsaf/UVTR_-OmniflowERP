"use client"

import * as React from "react"

import { CashFlowPage } from "@/modules/frs/components/cash-flow"

/** /frs/cash-flow (plan §9). `?month=` is read in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <CashFlowPage />
    </React.Suspense>
  )
}
