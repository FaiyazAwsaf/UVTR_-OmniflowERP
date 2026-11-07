"use client"

import * as React from "react"

import { PendingDeliveries } from "@/modules/sd/components/pending"

/** /sd: pending deliveries (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <PendingDeliveries />
    </React.Suspense>
  )
}
