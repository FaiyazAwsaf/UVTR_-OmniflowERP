"use client"

import * as React from "react"

import { TransfersList } from "@/modules/st/components/transfers"

/** /st/transfers: transfers (implementation_plan.md §9); reads the `?new=1&...` prefill, so it sits in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <TransfersList />
    </React.Suspense>
  )
}
