"use client"

import * as React from "react"

import { DeliveryHistory } from "@/modules/sd/components/deliveries"

/** /sd/deliveries: delivery history with returns (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <DeliveryHistory />
    </React.Suspense>
  )
}
