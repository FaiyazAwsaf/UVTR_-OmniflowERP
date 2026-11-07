"use client"

import * as React from "react"

import { ReceiptForm } from "@/modules/ar/components/receipt-form"

/** /ar/receipts/new: a customer receipt (`?party=` prefills the customer). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <ReceiptForm />
    </React.Suspense>
  )
}
