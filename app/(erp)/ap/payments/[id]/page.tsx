"use client"

import { useParams } from "next/navigation"

import { PaymentView } from "@/modules/ap/components/payment-view"

/** /ap/payments/[id]: one payment with its certificates and prints (plan §9). */
export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <PaymentView key={id} paymentId={id} />
}
