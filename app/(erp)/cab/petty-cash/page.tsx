"use client"

import * as React from "react"

import { PettyCash } from "@/modules/cab/components/petty-cash"

/** /cab/petty-cash: petty cash vouchers and imprest (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <PettyCash />
    </React.Suspense>
  )
}
