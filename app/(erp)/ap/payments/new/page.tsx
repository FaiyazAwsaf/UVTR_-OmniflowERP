"use client"

import * as React from "react"

import { PaymentForm } from "@/modules/ap/components/payment-form"

/** /ap/payments/new: a vendor payment (`?party=` and `?bill=` prefill it). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <PaymentForm />
    </React.Suspense>
  )
}
