"use client"

import * as React from "react"

import { PeriodsPage } from "@/modules/fa/components/periods-page"

/** /fa/periods: fiscal years, months and the close checklist (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <PeriodsPage />
    </React.Suspense>
  )
}
