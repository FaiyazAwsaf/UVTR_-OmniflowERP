"use client"

import * as React from "react"

import { Cheques } from "@/modules/cab/components/cheques"

/** /cab/cheques: the cheque register (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Cheques />
    </React.Suspense>
  )
}
