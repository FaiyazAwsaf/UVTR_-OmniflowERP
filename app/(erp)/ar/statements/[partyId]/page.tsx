"use client"

import { useParams } from "next/navigation"

import { CustomerStatement } from "@/modules/ar/components/statement"

/** /ar/statements/[partyId]: the customer statement and its print (plan §9). */
export default function Page() {
  const { partyId } = useParams<{ partyId: string }>()
  return <CustomerStatement key={partyId} partyId={partyId} />
}
