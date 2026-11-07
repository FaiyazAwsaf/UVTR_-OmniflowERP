"use client"

import { AgingView } from "@/modules/ar/components/aging"

/** /ar/aging: customer aging by days past due, tied to AR_CONTROL (plan §9). */
export default function Page() {
  return <AgingView side="ar" />
}
