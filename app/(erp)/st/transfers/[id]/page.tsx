import { TransferDetail } from "@/modules/st/components/transfer-detail"

/** /st/transfers/[id]: a transfer with its Mushak 6.5 challan (implementation_plan.md §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TransferDetail id={decodeURIComponent(id)} />
}
