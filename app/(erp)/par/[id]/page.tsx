"use client"

import { useParams } from "next/navigation"

import { Party360 } from "@/modules/par/components/party-360"

/** /par/[id]: the party 360 (plan §9). */
export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <Party360 key={id} partyId={id} />
}
