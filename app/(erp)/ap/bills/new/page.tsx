"use client"

import * as React from "react"

import { BillForm } from "@/modules/ap/components/bill-form"

/** /ap/bills/new: goods bill with the three-way match, or an expense bill (`?vendor=`, `?grn=` and `?ref=` prefill it). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <BillForm />
    </React.Suspense>
  )
}
