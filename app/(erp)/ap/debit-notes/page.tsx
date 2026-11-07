"use client"

import * as React from "react"

import { DebitNotes } from "@/modules/ap/components/debit-notes"

/** /ap/debit-notes: debit notes (Mushak 6.8) from purchase returns (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <DebitNotes />
    </React.Suspense>
  )
}
