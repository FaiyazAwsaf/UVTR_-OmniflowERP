"use client"

import * as React from "react"

import { InvoiceNew } from "@/modules/si/components/invoice-new"

/** /si/new: invoices from delivered orders and consolidated invoices (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <InvoiceNew />
    </React.Suspense>
  )
}
