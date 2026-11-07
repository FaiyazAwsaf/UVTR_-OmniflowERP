"use client"

import * as React from "react"

import { QuoteEditor } from "@/modules/stl/components/quote-editor"

/** /stl/quotations/new: the quotation editor (`?id=` revises a draft). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <QuoteEditor mode="quote" />
    </React.Suspense>
  )
}
