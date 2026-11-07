"use client"

import * as React from "react"

import { Transfers } from "@/modules/cab/components/transfers"

/** /cab/transfers: contra transfers (plan §9). Reads `?id=` and `?new=`, so it sits in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Transfers />
    </React.Suspense>
  )
}
