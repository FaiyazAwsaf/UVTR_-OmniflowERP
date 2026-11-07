"use client"

import * as React from "react"

import { RecurringPage } from "@/modules/fa/components/recurring-page"

/** /fa/recurring: recurring templates and "post for period" (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <RecurringPage />
    </React.Suspense>
  )
}
