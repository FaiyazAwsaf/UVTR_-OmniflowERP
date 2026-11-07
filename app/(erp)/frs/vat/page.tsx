"use client"

import * as React from "react"

import { VatPage } from "@/modules/frs/components/vat-page"

/** /frs/vat (plan §9). `?month=`, `?id=` (return) and `?deposit=` are read in Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <VatPage />
    </React.Suspense>
  )
}
