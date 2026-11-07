"use client"

import { useParams } from "next/navigation"

import { BillView } from "@/modules/ap/components/bill-view"

/** /ap/bills/[id]: one bill (plan §9). */
export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <BillView key={id} billId={id} />
}
