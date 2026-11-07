"use client"

import * as React from "react"

import { ReceiptList } from "@/modules/ar/components/receipt-list"

/** /ar/receipts: receipts; `?id=` opens one, so it reads the URL inside Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <ReceiptList />
    </React.Suspense>
  )
}
