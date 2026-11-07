"use client"

import * as React from "react"

import { LedgerPage } from "@/modules/fa/components/ledger-page"

/** /fa/ledger: general and account ledger (plan §9). `?account=&from=&to=` are read in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <LedgerPage />
    </React.Suspense>
  )
}
