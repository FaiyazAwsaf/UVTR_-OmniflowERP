"use client"

import { useParams } from "next/navigation"

import { AccountBookView } from "@/modules/cab/components/account-book"

/** /cab/accounts/[id]: cash or bank book (plan §9). */
export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <AccountBookView key={id} accountId={id} />
}
