"use client"

import * as React from "react"

import { VehicleRegistry } from "@/modules/par/components/vehicle-registry"

/** /par/vehicles: the vehicle registry (plan §9). `?id=` reads the URL, so it sits in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <VehicleRegistry />
    </React.Suspense>
  )
}
