"use client"

import * as React from "react"

import { BalanceSheetPage } from "@/modules/frs/components/balance-sheet"

/** /frs/balance-sheet (plan §9). `?asOf=` is read in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <BalanceSheetPage />
    </React.Suspense>
  )
}
