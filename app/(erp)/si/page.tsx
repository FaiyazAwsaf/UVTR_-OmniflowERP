"use client"

import * as React from "react"

import { InvoiceList } from "@/modules/si/components/invoice-list"

/** /si: invoices (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <InvoiceList />
    </React.Suspense>
  )
}
