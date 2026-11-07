"use client"

import * as React from "react"

import { WithholdingPage } from "@/modules/frs/components/withholding-page"

/** /frs/withholding (plan §9). `?month=` is read in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <WithholdingPage />
    </React.Suspense>
  )
}
