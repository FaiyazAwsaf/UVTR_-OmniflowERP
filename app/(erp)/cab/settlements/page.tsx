"use client"

import * as React from "react"

import { Settlements } from "@/modules/cab/components/settlements"

/** /cab/settlements: card and MFS settlements (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Settlements />
    </React.Suspense>
  )
}
