import { ReceiveForm } from "@/modules/grn/components/receive-form"

/** /grn/receive/[poId]: receive goods against a PO (implementation_plan.md §9). */
export default async function Page({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params
  return <ReceiveForm poId={decodeURIComponent(poId)} />
}
