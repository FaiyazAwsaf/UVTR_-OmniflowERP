"use client"

import * as React from "react"

import { JournalsList } from "@/modules/fa/components/journals-list"

/** /fa/journals: every voucher (plan §9). Filters read the URL, so the list sits in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <JournalsList />
    </React.Suspense>
  )
}
