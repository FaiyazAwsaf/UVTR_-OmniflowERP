"use client"

import * as React from "react"

import { Counter } from "@/modules/si/components/counter"

/** /si/counter: counter checkout (plan §9). */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <Counter />
    </React.Suspense>
  )
}
