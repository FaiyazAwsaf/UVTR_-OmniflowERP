"use client"

import * as React from "react"

import { QuoteEditor } from "@/modules/stl/components/quote-editor"

/** /stl/orders/new: book an order directly, with an optional deposit. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <QuoteEditor mode="order" />
    </React.Suspense>
  )
}
