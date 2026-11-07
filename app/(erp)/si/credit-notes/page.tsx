"use client"

import * as React from "react"

import { CreditNoteList } from "@/modules/si/components/credit-notes"

/** /si/credit-notes: credit notes, Mushak 6.7 (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <CreditNoteList />
    </React.Suspense>
  )
}
