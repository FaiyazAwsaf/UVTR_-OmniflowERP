"use client"

import * as React from "react"

import { ProfitLossPage } from "@/modules/frs/components/profit-loss"

/** /frs/profit-loss (plan §9). `?month=&view=` are read in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <ProfitLossPage />
    </React.Suspense>
  )
}
