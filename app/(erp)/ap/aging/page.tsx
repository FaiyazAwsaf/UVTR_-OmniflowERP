"use client"

import { AgingView } from "@/modules/ar/components/aging"

/** /ap/aging: vendor aging by days past due, tied to AP_CONTROL (plan §9). */
export default function Page() {
  return <AgingView side="ap" />
}
