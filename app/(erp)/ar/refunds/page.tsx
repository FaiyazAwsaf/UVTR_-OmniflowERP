"use client"

import * as React from "react"

import { Refunds } from "@/modules/ar/components/refunds"

/** /ar/refunds: refunds of customer advances (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Refunds />
    </React.Suspense>
  )
}
